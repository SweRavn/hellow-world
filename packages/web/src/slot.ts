import { EvalError, initialState, type Graft, type Json, type WidgetSpec } from "@graft/core";
import { renderWidget } from "./render.js";
import { injectStyles } from "./styles.js";
import { openVibePanel, type VibePanelOptions } from "./panel.js";

export interface SlotOptions {
  /** Show edit/remove controls on hover. Default true. */
  editable?: boolean;
  panel?: Omit<VibePanelOptions, "slot" | "edit">;
}

/** A rendered widget that owns its input state and recomputes as the user types or data changes. */
export interface LiveWidget {
  readonly element: HTMLElement;
  readonly state: Record<string, Json>;
  setData(data: Record<string, Json>): void;
}

/**
 * Renders a widget spec into a self-contained element. Inputs update the widget's state and every
 * formula is recomputed immediately; failures show an error placeholder instead of throwing.
 */
export function createLiveWidget(
  graft: Graft,
  spec: WidgetSpec,
  data: Record<string, Json>,
  options: { state?: Record<string, Json>; onState?(state: Record<string, Json>): void } = {},
): LiveWidget {
  const element = document.createElement("div");
  element.className = "graft-live";
  const controls = new Map<string, HTMLElement>();
  let state = options.state ?? initialState(spec);
  let current = data;

  const render = () => {
    const doc = element.ownerDocument;
    const active = doc.activeElement as HTMLInputElement | null;
    let selection: [number | null, number | null] | null = null;
    try {
      selection = active ? [active.selectionStart, active.selectionEnd] : null;
    } catch {
      /* not a text control */
    }
    let tree: HTMLElement;
    try {
      tree = renderWidget(graft.bind(spec, current, state), { controls, onInput });
    } catch (e) {
      tree = doc.createElement("div");
      tree.className = "graft-error";
      tree.textContent = `“${spec.title}” could not be shown${e instanceof EvalError ? " (too much data to compute)" : ""}.`;
    }
    element.replaceChildren(tree);
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

  const onInput = (name: string, value: Json) => {
    state = { ...state, [name]: value };
    options.onState?.(state);
    render();
  };

  render();
  return {
    element,
    get state() {
      return state;
    },
    setData(d) {
      current = d;
      render();
    },
  };
}

/** Renders one widget spec into a self-contained, interactive element. */
export function renderSpec(graft: Graft, spec: WidgetSpec, data: Record<string, Json>): HTMLElement {
  return createLiveWidget(graft, spec, data).element;
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
  // Live widgets by id. Reusing them across redraws keeps input state, focus and cursor
  // when data changes; an edited spec (new object) starts fresh.
  let live = new Map<string, { spec: WidgetSpec; widget: LiveWidget; wrap: HTMLElement }>();

  const draw = async () => {
    const v = ++version;
    const widgets = graft.widgets(slotId);
    const data = widgets.length ? await graft.snapshot() : {};
    if (v !== version) return; // a newer render started while we awaited data
    const next = new Map<string, { spec: WidgetSpec; widget: LiveWidget; wrap: HTMLElement }>();
    for (const spec of widgets) {
      const prev = live.get(spec.id);
      if (prev && prev.spec === spec) {
        prev.widget.setData(data);
        next.set(spec.id, prev);
        continue;
      }
      const widget = createLiveWidget(graft, spec, data);
      const wrap = document.createElement("div");
      wrap.className = "graft-widget";
      wrap.dataset.graftWidget = spec.id;
      wrap.appendChild(widget.element);
      if (opts.editable !== false) wrap.appendChild(menu(spec));
      next.set(spec.id, { spec, widget, wrap });
    }
    live = next;
    // Only touch the DOM when the set or order of widgets changed, so focused inputs stay put.
    const wraps = [...next.values()].map((x) => x.wrap);
    if (wraps.length !== host.children.length || wraps.some((w, i) => host.children[i] !== w)) host.replaceChildren(...wraps);
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
    live.clear();
    host.replaceChildren();
  };
}
