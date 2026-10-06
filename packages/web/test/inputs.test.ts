import { beforeEach, describe, expect, it } from "vitest";
import { Graft, mountSlot, type Generator } from "../src/index.js";

const calc = {
  specVersion: 1,
  id: "calc",
  title: "Calculator",
  slot: "home.top",
  state: { a: null, b: 2, people: 2, tip: false, cat: null, day: "2026-10-04", note: "" },
  bindings: { sum: { "+": [{ var: "state.a" }, { var: "state.b" }] } },
  root: {
    type: "card",
    children: [
      { type: "input", kind: "number", bind: "a", label: "First", placeholder: "0" },
      { type: "input", kind: "number", bind: "b", label: "Second" },
      { type: "metric", label: "Sum", value: { var: "sum" } },
      { type: "input", kind: "slider", bind: "people", min: 1, max: 10, step: 1 },
      { type: "input", kind: "toggle", bind: "tip", label: "Tip" },
      { type: "input", kind: "select", bind: "cat", options: { pluck: [{ group: [{ var: "tx" }, { var: "item.category" }] }, "key"] } },
      { type: "input", kind: "date", bind: "day" },
      { type: "input", kind: "text", bind: "note", multiline: true },
      { type: "text", value: { concat: [{ if: [{ var: "state.tip" }, "tip", "no tip"] }, " / ", { "??": [{ var: "state.cat" }, "none"] }, " / ", { var: "state.people" }] } },
    ],
  },
};

let tx = [{ category: "Food" }, { category: "Fun" }];
let notify = () => {};
async function mount() {
  const generator: Generator = { generate: async () => structuredClone(calc) };
  const graft = new Graft({ app: { name: "T" }, generator })
    .addDataSource("tx", { description: "", schema: { type: "array" }, get: () => tx, subscribe: (cb) => ((notify = cb), () => {}) })
    .addSlot("home.top", { description: "" });
  const host = document.createElement("div");
  document.body.append(host);
  mountSlot(graft, host, "home.top");
  await graft.accept(await graft.propose("calc"));
  await flush();
  return host;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const type = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, event = "input") => {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
};

describe("inputs", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    tx = [{ category: "Food" }, { category: "Fun" }];
  });

  it("recomputes formulas as the user types, keeping focus and the control", async () => {
    const host = await mount();
    const metric = () => host.querySelector(".graft-metric-value")!.textContent;
    expect(metric()).toBe("2"); // null + 2
    const first = host.querySelectorAll<HTMLInputElement>("input[type=number]")[0]!;
    expect(first.placeholder).toBe("0");
    first.focus();
    type(first, "1,5");
    expect(metric()).toBe("3.5");
    const again = host.querySelectorAll<HTMLInputElement>("input[type=number]")[0]!;
    expect(again).toBe(first); // same element: text and cursor survive
    expect(again.value).toBe("1,5");
    expect(document.activeElement).toBe(first);
    type(first, "");
    expect(metric()).toBe("2");
  });

  it("supports slider, toggle, select from data, date and text", async () => {
    const host = await mount();
    const summary = () => [...host.querySelectorAll(".graft-text")].at(-1)!.textContent;
    expect(summary()).toBe("no tip / none / 2");

    const slider = host.querySelector<HTMLInputElement>("input[type=range]")!;
    type(slider, "7");
    expect(summary()).toBe("no tip / none / 7");
    expect(host.querySelector(".graft-input-value")!.textContent).toBe("7");

    const toggle = host.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(toggle.getAttribute("role")).toBe("switch");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    expect(summary()).toBe("tip / none / 7");

    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["—", "Food", "Fun"]);
    select.selectedIndex = 2;
    select.dispatchEvent(new Event("change"));
    expect(summary()).toBe("tip / Fun / 7");

    expect(host.querySelector<HTMLInputElement>("input[type=date]")!.value).toBe("2026-10-04");
    expect(host.querySelector("textarea")).not.toBeNull();
  });

  it("keeps input state when app data changes and refreshes data-driven options", async () => {
    const host = await mount();
    const first = host.querySelectorAll<HTMLInputElement>("input[type=number]")[0]!;
    type(first, "5");
    tx = [...tx, { category: "Rent" }];
    notify();
    await flush();
    expect(host.querySelector(".graft-metric-value")!.textContent).toBe("7");
    expect(host.querySelectorAll<HTMLInputElement>("input[type=number]")[0]).toBe(first);
    expect([...host.querySelector("select")!.options].map((o) => o.textContent)).toEqual(["—", "Food", "Fun", "Rent"]);
  });
});
