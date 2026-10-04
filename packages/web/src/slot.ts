import { EvalError, type Graft, type Json, type WidgetSpec } from "@graft/core";
import { renderWidget } from "./render.js";
import { injectStyles } from "./styles.js";
import { openVibePanel, type VibePanelOptions } from "./panel.js";

export interface SlotOptions {
  /** Show edit/remove controls on hover. Default true. */
  editable?: boolean;
  panel?: Omit<VibePanelOptions, "slot" | "edit">;
}

/** Renders one widget spec into a self-contained element, with an error placeholder on failure. */
export function renderSpec(graft: Graft, spec: WidgetSpec, data: Record<string, Json>): HTMLElement {
  try {
    return renderWidget(graft.bind(spec, data));
  } catch (e) {
    const box = document.createElement("div");
    box.className = "graft-error";
    box.textContent = `“${spec.title}” could not be shown${e instanceof EvalError ? " (too much data to compute)" : ""}.`;
    return box;
  }
}

/**
 * Renders the widgets of `slotId` into `host` and keeps them live as data or widgets change.
 * Returns an unmount function.
 */
export function mountSlot(graft: Graft, host: HTMLElement, slotId: string, opts: SlotOptions = {}): () => void {
  injectStyles(host.ownerDocument);
  host.classList.add("graft-root", "graft-slot");
  host.dataset.graftSlot = slotId;
  let version = 0;

  const draw = async () => {
    const v = ++version;
    const widgets = graft.widgets(slotId);
    const data = widgets.length ? await graft.snapshot() : {};
    if (v !== version) return; // a newer render started while we awaited data
    host.replaceChildren(
      ...widgets.map((spec) => {
        const wrap = document.createElement("div");
        wrap.className = "graft-widget";
        wrap.dataset.graftWidget = spec.id;
        wrap.appendChild(renderSpec(graft, spec, data));
        if (opts.editable !== false) wrap.appendChild(menu(spec));
        return wrap;
      }),
    );
  };

  const menu = (spec: WidgetSpec) => {
    const m = document.createElement("div");
    m.className = "graft-widget-menu";
    const btn = (label: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "graft-icon-btn";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", `${title}: ${spec.title}`);
      b.addEventListener("click", onClick);
      m.appendChild(b);
    };
    btn("Edit", "Change this widget", () => openVibePanel(graft, { ...opts.panel, slot: slotId, edit: spec }));
    btn("✕", "Remove this widget", () => {
      if (host.ownerDocument.defaultView?.confirm(`Remove “${spec.title}”?`) ?? true) void graft.remove(spec.id);
    });
    return m;
  };

  const off = graft.onChange(() => void draw());
  void draw();
  return () => {
    off();
    version++;
    host.replaceChildren();
  };
}
