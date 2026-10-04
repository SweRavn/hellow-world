import { describe, expect, it } from "vitest";
import { Graft, MemoryStore, type InputViewNode, type SlotItem, type ViewNode } from "../src/index.js";

const calc = {
  specVersion: 1,
  id: "calc",
  title: "Calc",
  slot: "home.top",
  state: { a: null, b: 2 },
  root: { type: "column", children: [
    { type: "input", kind: "number", bind: "a" },
    { type: "input", kind: "number", bind: "b" },
    { type: "metric", label: "Sum", value: { "+": [{ var: "state.a" }, { var: "state.b" }] } },
  ] },
};

const children = (v: ViewNode | null) => (v && "children" in v ? v.children : []);
const input = (v: ViewNode | null, i: number) => children(v)[i] as InputViewNode;
const metric = (v: ViewNode | null) => (children(v)[2] as { value: string }).value;

function make() {
  let tx = [1, 2];
  let notify = () => {};
  const graft = new Graft({ app: { name: "T" }, generator: { generate: async () => structuredClone(calc) }, store: new MemoryStore() })
    .addDataSource("tx", { description: "", schema: { type: "array" }, get: () => tx, subscribe: (cb) => ((notify = cb), () => {}) })
    .addSlot("home.top", { description: "" });
  return { graft, setTx: (v: number[]) => ((tx = v), notify()) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("headless controller", () => {
  it("exposes getters and setters that recompute the view", async () => {
    const { graft } = make();
    const spec = await graft.propose("calc");
    const c = graft.controller(spec, await graft.snapshot());
    const seen: (ViewNode | null)[] = [];
    c.subscribe((v) => seen.push(v));
    expect(input(c.view, 0).value).toBeNull();
    expect(metric(c.view)).toBe("2");
    input(c.view, 0).set("1,5"); // raw value from any UI control
    expect(c.state).toEqual({ a: 1.5, b: 2 });
    expect(input(c.view, 0).value).toBe(1.5);
    expect(metric(c.view)).toBe("3.5");
    expect(seen).toHaveLength(1);
    input(c.view, 1).set("abc"); // invalid number -> null
    expect(metric(c.view)).toBe("1.5");
  });

  it("watchSlot keeps controllers (and input state) across data changes", async () => {
    const { graft, setTx } = make();
    const lists: SlotItem[][] = [];
    graft.watchSlot("home.top", (items) => lists.push(items));
    await graft.accept(await graft.propose("calc"));
    await flush();
    const c = lists.at(-1)![0]!.controller;
    input(c.view, 0).set(5);
    setTx([3]);
    await flush();
    expect(lists.at(-1)![0]!.controller).toBe(c);
    expect(metric(c.view)).toBe("7");
    await graft.remove("calc");
    await flush();
    expect(lists.at(-1)).toEqual([]);
  });

  it("reports an error instead of a view when bindings exceed the budget", async () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const { graft } = make();
    const spec = { ...calc, bindings: { x: { map: [big, { map: [big, { var: "item" }] }] } } };
    const c = graft.controller(spec as never, {});
    expect(c.view).toBeNull();
    expect(c.error).toBe("too much data to compute");
  });
});
