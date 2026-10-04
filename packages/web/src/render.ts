import type { InputViewNode, Json, ViewNode } from "@graft/core";

/*
 * Optional DOM adapter: renders Graft's headless view tree with plain DOM elements. Apps using React,
 * Vue, Svelte, etc. can skip this and render the view tree with their own components instead.
 */

export interface RenderOptions {
  /**
   * Input controls from the previous render, keyed by node key. Passing the same map on every
   * re-render reuses the controls, so the user's text, cursor and focus survive recomputation.
   */
  controls?: Map<string, HTMLElement>;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text; // textContent only: generated text can never inject HTML
  return e;
}

// Select option values by element, so number values round-trip as numbers.
const selectValues = new WeakMap<HTMLSelectElement, (string | number)[]>();
// The latest node per control, so a reused control's listener calls the current setter.
const controlNodes = new WeakMap<HTMLElement, InputViewNode>();

function control(n: InputViewNode, controls: Map<string, HTMLElement>): HTMLElement {
  const tag = n.kind === "select" ? "SELECT" : n.kind === "text" && n.multiline ? "TEXTAREA" : "INPUT";
  let c = controls.get(n.key);
  const fresh = !c || c.tagName !== tag;
  if (fresh) {
    c = document.createElement(tag.toLowerCase());
    c.className = "graft-control";
    if (c instanceof HTMLInputElement) {
      c.type = { text: "text", number: "number", slider: "range", toggle: "checkbox", date: "date", select: "text" }[n.kind];
      if (n.kind === "toggle") c.setAttribute("role", "switch");
      if (n.kind === "number") c.inputMode = "decimal";
      if (n.min !== null) c.min = String(n.min);
      if (n.max !== null) c.max = String(n.max);
      if (n.step !== null) c.step = String(n.step);
      else if (n.kind === "number") c.step = "any";
    }
    const e = c;
    const read = (): Json => {
      if (e instanceof HTMLSelectElement) return e.selectedIndex <= 0 ? null : selectValues.get(e)?.[e.selectedIndex - 1] ?? null;
      if (e instanceof HTMLInputElement && n.kind === "toggle") return e.checked;
      return (e as HTMLInputElement | HTMLTextAreaElement).value;
    };
    e.addEventListener(n.kind === "select" || n.kind === "toggle" ? "change" : "input", () => controlNodes.get(e)?.set(read()));
    controls.set(n.key, e);
  }
  const e = c!;
  controlNodes.set(e, n);
  if (e instanceof HTMLSelectElement) {
    // Options may depend on data, so they are refreshed on every render.
    selectValues.set(e, n.options.map((o) => o.value));
    const option = (label: string) => Object.assign(document.createElement("option"), { textContent: label });
    e.replaceChildren(option("—"), ...n.options.map((o) => option(o.label)));
    e.selectedIndex = n.options.findIndex((o) => o.value === n.value) + 1;
  } else if (e instanceof HTMLInputElement && n.kind === "toggle") {
    e.checked = n.value === true;
  } else if (fresh || n.kind === "slider") {
    // Text-like controls keep what the user typed ("1." stays "1."); only set them initially.
    (e as HTMLInputElement).value = n.value === null ? "" : String(n.value);
  }
  if (fresh && n.placeholder !== null && "placeholder" in e) (e as HTMLInputElement).placeholder = n.placeholder;
  return e;
}

/** Renders a view tree to DOM. */
export function renderView(view: ViewNode, opts: RenderOptions = {}): HTMLElement {
  const controls = opts.controls ?? new Map<string, HTMLElement>();
  const colorClass = (c: string) => `graft-c-${c}`;

  function node(n: ViewNode): HTMLElement {
    switch (n.type) {
      case "card": {
        const card = el("section", "graft-card");
        if (n.title !== null) card.appendChild(el("h3", "graft-card-title", n.title));
        card.append(...n.children.map(node));
        return card;
      }
      case "column":
      case "row": {
        const box = el("div", `graft-${n.type}`);
        if (n.gap !== null) box.style.gap = `${n.gap}px`;
        if (n.type === "row") box.dataset.align = n.align;
        box.append(...n.children.map(node));
        return box;
      }
      case "text":
        return el("p", `graft-text graft-text-${n.style} ${colorClass(n.color)}`, n.text);
      case "metric": {
        const m = el("div", "graft-metric");
        m.appendChild(el("div", "graft-metric-label", n.label));
        m.appendChild(el("div", `graft-metric-value ${colorClass(n.color)}`, n.value));
        if (n.caption !== null) m.appendChild(el("div", "graft-metric-caption", n.caption));
        return m;
      }
      case "progress": {
        const box = el("div", "graft-progress");
        if (n.label !== null) box.appendChild(el("div", "graft-progress-label", n.label));
        const track = el("div", "graft-progress-track");
        const bar = el("div", `graft-progress-bar${n.value > n.max ? " graft-over" : ""}`);
        bar.style.width = `${n.fraction * 100}%`;
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-valuenow", String(Math.round(n.fraction * 100)));
        track.appendChild(bar);
        box.appendChild(track);
        return box;
      }
      case "list": {
        const ul = el("ul", "graft-list");
        if (n.empty !== null) ul.appendChild(el("li", "graft-list-empty", n.empty));
        for (const item of n.items) {
          const li = el("li", "graft-list-item");
          li.appendChild(node(item));
          ul.appendChild(li);
        }
        return ul;
      }
      case "barChart": {
        const chart = el("div", "graft-bars");
        for (const b of n.bars) {
          const row = el("div", "graft-bar-row");
          row.appendChild(el("span", "graft-bar-label", b.label));
          const track = el("span", "graft-bar-track");
          const bar = el("span", "graft-bar");
          bar.style.width = `${b.fraction * 100}%`;
          track.appendChild(bar);
          row.appendChild(track);
          row.appendChild(el("span", "graft-bar-value", String(Math.round(b.value * 100) / 100)));
          chart.appendChild(row);
        }
        return chart;
      }
      case "badge":
        return el("span", `graft-badge ${colorClass(n.color)}`, n.text);
      case "divider":
        return el("hr", "graft-divider");
      case "input": {
        const wrap = el("label", `graft-input graft-input-${n.kind}`);
        if (n.label !== null) wrap.appendChild(el("span", "graft-input-label", n.label));
        wrap.appendChild(control(n, controls));
        if (n.kind === "slider") wrap.appendChild(el("span", "graft-input-value", n.value === null ? "" : String(n.value)));
        return wrap;
      }
    }
  }

  return node(view);
}
