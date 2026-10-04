import { beforeEach, describe, expect, it } from "vitest";
import { Graft, mountSlot, openVibePanel, type Generator } from "../src/index.js";

const tx = [
  { amount: 12.5, category: "Food", merchant: "Cafe <b>Nero</b>" },
  { amount: 40, category: "Transport", merchant: "SJ" },
  { amount: 7.5, category: "Food", merchant: "ICA" },
];

const spec = {
  specVersion: 1,
  id: "by_cat",
  title: "By category",
  slot: "home.top",
  bindings: { groups: { group: [{ var: "tx" }, { var: "item.category" }, { var: "item.amount" }] } },
  root: {
    type: "card",
    title: "Spend by category",
    children: [
      { type: "metric", label: "Total", value: { format: [{ sum: [{ var: "tx" }, "amount"] }, "currency"] }, color: "accent" },
      { type: "barChart", items: { map: [{ var: "groups" }, { object: ["label", { var: "item.key" }, "value", { var: "item.sum" }] }] } },
      { type: "progress", value: { sum: [{ var: "tx" }, "amount"] }, max: 100, label: "Budget" },
      { type: "visible", when: { ">": [{ count: [{ var: "tx" }] }, 100] }, children: [{ type: "text", value: "hidden" }] },
      {
        type: "list", items: { var: "tx" }, limit: 2,
        template: { type: "row", align: "spaceBetween", children: [
          { type: "text", value: { var: "item.merchant" } },
          { type: "badge", value: { var: "index" }, color: { if: [{ ">": [{ var: "item.amount" }, 20] }, "negative", "positive"] } },
        ] },
      },
    ],
  },
};

function makeGraft(generated: unknown = spec) {
  const generator: Generator = { generate: async () => structuredClone(generated) };
  return new Graft({ app: { name: "Test" }, generator, theme: { currency: "USD", locale: "en-US" } })
    .addDataSource("tx", { description: "transactions", schema: { type: "array" }, get: () => tx })
    .addSlot("home.top", { description: "top" });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("web renderer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders accepted widgets into a slot, safely and live", async () => {
    const graft = makeGraft();
    const host = document.createElement("div");
    document.body.append(host);
    mountSlot(graft, host, "home.top");
    await graft.accept(await graft.propose("spend by category"));
    await flush();

    expect(host.querySelector(".graft-card-title")?.textContent).toBe("Spend by category");
    expect(host.querySelector(".graft-metric-value")?.textContent).toBe("$60.00");
    expect(host.querySelector(".graft-metric-value")?.className).toContain("graft-c-accent");
    expect([...host.querySelectorAll(".graft-bar-label")].map((e) => e.textContent)).toEqual(["Food", "Transport"]);
    expect((host.querySelector(".graft-progress-bar") as HTMLElement).style.width).toBe("60%");
    expect(host.textContent).not.toContain("hidden");
    expect(host.querySelectorAll(".graft-list-item")).toHaveLength(2);
    // generated text is never interpreted as HTML
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("Cafe <b>Nero</b>");
    expect([...host.querySelectorAll(".graft-badge")].map((e) => e.className)).toEqual([
      "graft-badge graft-c-positive",
      "graft-badge graft-c-negative",
    ]);

    await graft.remove("by_cat");
    await flush();
    expect(host.querySelector(".graft-card")).toBeNull();
  });

  it("vibe panel previews then adds a widget", async () => {
    const graft = makeGraft();
    openVibePanel(graft, { slot: "home.top" });
    const panel = document.querySelector(".graft-panel")!;
    (panel.querySelector("textarea") as HTMLTextAreaElement).value = "spend by category";
    const [, generate, accept] = [...panel.querySelectorAll("button")] as HTMLButtonElement[];
    generate!.click();
    await flush();
    await flush();
    expect(panel.querySelector(".graft-preview .graft-card")).not.toBeNull();
    expect(graft.widgets()).toHaveLength(0);
    expect(accept!.hidden).toBe(false);
    accept!.click();
    await flush();
    expect(graft.widgets()).toHaveLength(1);
    expect(document.querySelector(".graft-panel")).toBeNull();
  });

  it("shows an error when generation is invalid", async () => {
    const graft = makeGraft({ ...spec, root: { type: "iframe" } });
    openVibePanel(graft);
    const panel = document.querySelector(".graft-panel")!;
    (panel.querySelector("textarea") as HTMLTextAreaElement).value = "x";
    (panel.querySelectorAll("button")[1] as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(panel.querySelector(".graft-status")?.textContent).toContain("invalid");
  });
});
