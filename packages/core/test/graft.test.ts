import { describe, expect, it } from "vitest";
import { evaluate, EvalError, Graft, GraftError, MemoryStore, buildSystemPrompt, type Generator } from "../src/index.js";

const spec = (over: Record<string, unknown> = {}) => ({
  specVersion: 1,
  id: "total",
  title: "Total",
  slot: "home.top",
  bindings: { total: { sum: [{ var: "tx" }, "amount"] } },
  root: { type: "metric", label: "Total", value: { format: [{ var: "total" }, "currency"] } },
  ...over,
});

function setup(generated: unknown) {
  const calls: unknown[] = [];
  const generator: Generator = { generate: async (req) => (calls.push(req), generated) };
  let tx = [{ amount: 5 }, { amount: 7 }];
  let notify = () => {};
  const graft = new Graft({ app: { name: "Test" }, generator, theme: { currency: "EUR", locale: "en-US" } })
    .addDataSource("tx", {
      description: "transactions",
      schema: { type: "array", items: { type: "object", properties: { amount: { type: "number" } } } },
      sample: [{ amount: 1 }],
      get: () => tx,
      subscribe: (cb) => ((notify = cb), () => {}),
    })
    .addSlot("home.top", { description: "top", maxWidgets: 2 });
  return { graft, calls, setTx: (v: typeof tx) => ((tx = v), notify()) };
}

describe("Graft", () => {
  it("proposes, accepts and renders a widget", async () => {
    const { graft, calls } = setup(spec());
    await graft.init();
    const proposed = await graft.propose("total spend");
    expect(calls[0]).toMatchObject({ prompt: "total spend", specVersion: 1, manifest: { dataSources: { tx: { sample: [{ amount: 1 }] } } } });
    expect(graft.widgets("home.top")).toHaveLength(0);
    await graft.accept(proposed);
    expect(graft.widgets("home.top")).toHaveLength(1);
    const bound = graft.bind(proposed, await graft.snapshot());
    expect(bound.eval({ var: "total" })).toBe(12);
    expect(bound.eval((proposed.root as { value: never }).value)).toBe("€12.00");
  });

  it("rejects invalid generator output with details", async () => {
    const { graft } = setup(spec({ root: { type: "script", src: "evil.js" } }));
    await expect(graft.propose("x")).rejects.toBeInstanceOf(GraftError);
    await expect(graft.propose("x")).rejects.toMatchObject({ details: [expect.stringContaining("unknown component")] });
  });

  it("emits on data change and persists across instances", async () => {
    const store = new MemoryStore();
    const { graft, setTx } = setup(spec());
    const g = new Graft({ app: { name: "T" }, generator: { generate: async () => spec() }, store })
      .addDataSource("tx", { description: "", schema: { type: "array" }, get: () => [] })
      .addSlot("home.top", { description: "" });
    await g.accept(await g.propose("x"));
    const g2 = new Graft({ app: { name: "T" }, generator: { generate: async () => null }, store })
      .addDataSource("tx", { description: "", schema: { type: "array" }, get: () => [] })
      .addSlot("home.top", { description: "" });
    await g2.init();
    expect(g2.widgets()).toHaveLength(1);

    let n = 0;
    graft.onChange(() => n++);
    setTx([]);
    expect(n).toBe(1);
  });

  it("drops stored widgets that no longer validate", async () => {
    const store = new MemoryStore();
    await store.save([spec() as never]);
    const g = new Graft({ app: { name: "T" }, generator: { generate: async () => null }, store }).addSlot("home.top", { description: "" });
    await g.init();
    expect(g.widgets()).toHaveLength(0);
  });

  it("keeps id when editing and dedupes ids for new widgets", async () => {
    const { graft } = setup(spec());
    await graft.accept(await graft.propose("a"));
    const second = await graft.propose("b");
    expect(second.id).not.toBe("total");
    const edited = await graft.propose("c", { edit: "total" });
    expect(edited.id).toBe("total");
  });

  it("enforces the step budget", () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const expr = { map: [big, { map: [big, { "+": [{ var: "item" }, 1] }] }] };
    expect(() => evaluate(expr, { vars: {} })).toThrow(EvalError);
  });

  it("system prompt mentions every component", () => {
    const p = buildSystemPrompt();
    for (const c of ["card", "metric", "barChart", "list", "visible"]) expect(p).toContain(`- ${c}:`);
  });

  it("binds widget state and recomputes bindings from it", async () => {
    const calc = spec({
      id: "calc",
      state: { a: null, b: 4 },
      bindings: { sum: { "+": [{ var: "state.a" }, { var: "state.b" }] } },
      root: { type: "column", children: [
        { type: "input", kind: "number", bind: "a" },
        { type: "input", kind: "number", bind: "b" },
        { type: "metric", label: "Sum", value: { var: "sum" } },
      ] },
    });
    const { graft } = setup(calc);
    const s = await graft.propose("add two numbers");
    const data = await graft.snapshot();
    expect(graft.bind(s, data).eval({ var: "sum" })).toBe(4);
    expect(graft.bind(s, data, { a: 1.5, b: 4 }).eval({ var: "sum" })).toBe(5.5);
    expect(graft.bind(s, data).state).toEqual({ a: null, b: 4 });
  });

  it("rejects a data source named state", () => {
    const { graft } = setup(spec());
    expect(() => graft.addDataSource("state", { description: "", schema: { type: "object" }, get: () => null })).toThrow(GraftError);
  });
});
