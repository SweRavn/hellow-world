import { COLOR_TOKENS, LIMITS, isWidgetNode, truthy, type BoundWidget, type Json, type WidgetNode } from "@graft/core";

type Scope = { item: Json; index: number } | undefined;

function str(v: Json): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function num(v: Json): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function colorClass(v: Json): string {
  return typeof v === "string" && (COLOR_TOKENS as readonly string[]).includes(v) ? `graft-c-${v}` : "graft-c-default";
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text; // textContent only: generated text can never inject HTML
  return e;
}

/** Renders a bound widget spec to DOM. Throws EvalError if an expression exceeds its budget. */
export function renderWidget(w: BoundWidget): HTMLElement {
  const ev = (expr: unknown, scope: Scope) => (expr === undefined ? null : w.eval(expr as Json, scope));

  function children(n: WidgetNode, parent: HTMLElement, scope: Scope) {
    for (const c of n.children ?? []) parent.appendChild(node(c, scope));
    return parent;
  }

  function node(n: WidgetNode, scope: Scope): HTMLElement {
    switch (n.type) {
      case "card": {
        const card = el("section", "graft-card");
        const title = ev(n.title, scope);
        if (title !== null) card.appendChild(el("h3", "graft-card-title", str(title)));
        return children(n, card, scope);
      }
      case "column":
      case "row": {
        const box = el("div", `graft-${n.type}`);
        if (typeof n.gap === "number") box.style.gap = `${n.gap}px`;
        if (n.type === "row" && typeof n.align === "string") box.dataset.align = n.align;
        return children(n, box, scope);
      }
      case "text": {
        const style = typeof n.style === "string" ? n.style : "body";
        return el("p", `graft-text graft-text-${style} ${colorClass(ev(n.color, scope))}`, str(ev(n.value, scope)));
      }
      case "metric": {
        const m = el("div", "graft-metric");
        m.appendChild(el("div", "graft-metric-label", str(ev(n.label, scope))));
        m.appendChild(el("div", `graft-metric-value ${colorClass(ev(n.color, scope))}`, str(ev(n.value, scope))));
        const cap = ev(n.caption, scope);
        if (cap !== null && cap !== "") m.appendChild(el("div", "graft-metric-caption", str(cap)));
        return m;
      }
      case "progress": {
        const box = el("div", "graft-progress");
        const label = ev(n.label, scope);
        if (label !== null) box.appendChild(el("div", "graft-progress-label", str(label)));
        const value = num(ev(n.value, scope)) ?? 0;
        const max = num(ev(n.max, scope)) ?? 1;
        const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
        const track = el("div", "graft-progress-track");
        const bar = el("div", `graft-progress-bar${value > max ? " graft-over" : ""}`);
        bar.style.width = `${pct}%`;
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-valuenow", String(Math.round(pct)));
        track.appendChild(bar);
        box.appendChild(track);
        return box;
      }
      case "list": {
        const items = ev(n.items, scope);
        const arr = Array.isArray(items) ? items : [];
        const limit = Math.min(typeof n.limit === "number" ? n.limit : LIMITS.maxListLimit, LIMITS.maxListLimit);
        const ul = el("ul", "graft-list");
        if (arr.length === 0) {
          const empty = ev(n.empty, scope);
          if (empty !== null) ul.appendChild(el("li", "graft-list-empty", str(empty)));
        }
        arr.slice(0, limit).forEach((item, index) => {
          const li = el("li", "graft-list-item");
          if (isWidgetNode(n.template)) li.appendChild(node(n.template, { item, index }));
          ul.appendChild(li);
        });
        return ul;
      }
      case "barChart": {
        const items = ev(n.items, scope);
        const rows = (Array.isArray(items) ? items : [])
          .slice(0, LIMITS.maxListLimit)
          .map((it) => (it && typeof it === "object" && !Array.isArray(it) ? it : {}))
          .map((it) => ({ label: str(it.label ?? null), value: num(it.value ?? null) ?? 0 }));
        const max = num(ev(n.max, scope)) ?? Math.max(0, ...rows.map((r) => r.value));
        const chart = el("div", "graft-bars");
        for (const r of rows) {
          const row = el("div", "graft-bar-row");
          row.appendChild(el("span", "graft-bar-label", r.label));
          const track = el("span", "graft-bar-track");
          const bar = el("span", "graft-bar");
          bar.style.width = `${max > 0 ? Math.max(0, Math.min(100, (r.value / max) * 100)) : 0}%`;
          track.appendChild(bar);
          row.appendChild(track);
          row.appendChild(el("span", "graft-bar-value", String(Math.round(r.value * 100) / 100)));
          chart.appendChild(row);
        }
        return chart;
      }
      case "badge":
        return el("span", `graft-badge ${colorClass(ev(n.color, scope))}`, str(ev(n.value, scope)));
      case "divider":
        return el("hr", "graft-divider");
      case "visible": {
        const box = el("div", "graft-visible");
        return truthy(ev(n.when, scope)) ? children(n, box, scope) : box;
      }
      default:
        // Unreachable for validated specs; render nothing rather than fail.
        return el("div", "graft-unknown");
    }
  }

  return node(w.spec.root, undefined);
}

