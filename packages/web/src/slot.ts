import type { Graft, Json, SlotItem, WidgetController, WidgetSpec } from "@graft/core";
import { renderView } from "./render.js";
import { injectStyles } from "./styles.js";
import { openVibePanel, type VibePanelOptions } from "./panel.js";

export interface SlotOptions {
  /** Show edit/remove controls on hover. Default true. */
  editable?: boolean;
  panel?: Omit<VibePanelOptions, "slot" | "edit">;
}

/**
 * Mounts a headless widget controller into a DOM element and re-renders it on every change, keeping
 * input focus and cursor. Returns the element and an unmount function.
 */
export function mountController(controller: WidgetController): { element: HTMLElement; unmount(): void } {
  const element = document.createElement("div");
  element.className = "graft-live";
  const controls = new Map<string, HTMLElement>();

  const render = () => {
    const doc = element.ownerDocument;
    const active = doc.activeElement as HTMLInputElement | null;
    let selection: [number | null, number | null] | null = null;
    try {
      selection = active ? [active.selectionStart, active.selectionEnd] : null;
    } catch {
      /* not a text control */
    }
    const view = controller.view;
    if (view) element.replaceChildren(renderView(view, { controls }));
    else {
      const box = doc.createElement("div");
      box.className = "graft-error";
      box.textContent = `“${controller.spec.title}” could not be shown (${controller.error}).`;
      element.replaceChildren(box);
    }
    // Reused controls were moved into the new tree, which blurs them: restore focus and cursor.
    if (active && active !== doc.activeElement && element.contains(active)) {
      active.focus({ preventScroll: true });
      try {
        if (selection && selection[0] !== null) active.setSelectionRange(selection[0], selection[1]);
      } catch {
        /* number/date inputs have no selection API */
      }
    }
  };

  const off = controller.subscribe(render);
  render();
  return { element, unmount: off };
}

/** Renders one widget spec into a self-contained, interactive element. */
export function renderSpec(graft: Graft, spec: WidgetSpec, data: Record<string, Json>): HTMLElement {
  return mountController(graft.controller(spec, data)).element;
}

/**
 * Renders the widgets of `slotId` into `host` and keeps them live as data or widgets change.
 * Returns an unmount function.
 */
export function mountSlot(graft: Graft, host: HTMLElement, slotId: string, opts: SlotOptions = {}): () => void {
  injectStyles(host.ownerDocument);
  host.classList.add("graft-root", "graft-slot");
  host.dataset.graftSlot = slotId;
  // DOM per controller: watchSlot reuses controllers across data changes, so elements (and the
  // user's focus and input state) survive; an edited widget gets a new controller and element.
  let mounted = new Map<WidgetController, { wrap: HTMLElement; unmount(): void }>();

  const draw = (items: SlotItem[]) => {
    const next = new Map<WidgetController, { wrap: HTMLElement; unmount(): void }>();
    for (const { spec, controller } of items) {
      let m = mounted.get(controller);
      if (!m) {
        const { element, unmount } = mountController(controller);
        const wrap = document.createElement("div");
        wrap.className = "graft-widget";
        wrap.dataset.graftWidget = spec.id;
        wrap.appendChild(element);
        if (opts.editable !== false) wrap.appendChild(menu(spec));
        m = { wrap, unmount };
      }
      next.set(controller, m);
    }
    mounted.forEach((m, c) => next.has(c) || m.unmount());
    mounted = next;
    host.replaceChildren(...[...next.values()].map((m) => m.wrap));
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

  const stop = graft.watchSlot(slotId, draw);
  return () => {
    stop();
    mounted.forEach((m) => m.unmount());
    mounted.clear();
    host.replaceChildren();
  };
}
