import type { InputKind } from "./catalog.js";
import { EvalError, numberToString, truthy } from "./expr.js";
import type { BoundWidget, Graft } from "./graft.js";
import { coerceInput, initialState, selectOptions } from "./input.js";
import { COLOR_TOKENS, LIMITS, type ColorToken, type Json, type WidgetNode, type WidgetSpec } from "./types.js";

/*
 * Headless view layer. Graft evaluates a widget into a tree of plain, display-ready nodes; any UI
 * framework renders that tree with its own components. Input nodes carry a getter (`value`) and a
 * setter (`set`): connect them to whatever control you use. The DOM, Compose and SwiftUI renderers
 * shipped with Graft are optional adapters over exactly this API. Canonical shape: spec/README.md §7.
 */

interface Base {
  /** Stable identity (the node's path in the spec). Use it as the key in your UI framework. */
  key: string;
}

export type ViewNode =
  | (Base & { type: "card"; title: string | null; children: ViewNode[] })
  | (Base & { type: "column"; gap: number | null; children: ViewNode[] })
  | (Base & { type: "row"; gap: number | null; align: "start" | "center" | "end" | "spaceBetween"; children: ViewNode[] })
  | (Base & { type: "text"; text: string; style: "title" | "body" | "caption"; color: ColorToken })
  | (Base & { type: "metric"; label: string; value: string; caption: string | null; color: ColorToken })
  | (Base & { type: "progress"; label: string | null; value: number; max: number; fraction: number })
  | (Base & { type: "list"; items: ViewNode[]; empty: string | null })
  | (Base & { type: "barChart"; bars: { label: string; value: number; fraction: number }[] })
  | (Base & { type: "badge"; text: string; color: ColorToken })
  | (Base & { type: "divider" })
  | InputViewNode;

export interface InputViewNode extends Base {
  type: "input";
  kind: InputKind;
  /** Name of the state entry this input edits. */
  name: string;
  label: string | null;
  placeholder: string | null;
  min: number | null;
  max: number | null;
  step: number | null;
  multiline: boolean;
  /** Choices for `select`; empty for other kinds. */
  options: { label: string; value: string | number }[];
  /** Getter: the current (coerced) value. */
  value: Json;
  /** Setter: pass the raw value from your control; Graft coerces it, updates state and recomputes. */
  set(raw: Json): void;
}

/** Display text for any value: null → "", numbers in shortest form, objects as JSON. */
export function displayText(v: Json): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numberToString(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

const num = (v: Json): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const color = (v: Json): ColorToken => (typeof v === "string" && (COLOR_TOKENS as readonly string[]).includes(v) ? (v as ColorToken) : "default");
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const optText = (v: Json): string | null => (v === null ? null : displayText(v));

/**
 * Evaluates a bound widget into a view tree. `onSet` receives (state name, coerced value) from input
 * setters; without it, setters do nothing. Expression errors inside a prop degrade to null.
 */
export function resolveView(w: BoundWidget, onSet?: (name: string, value: Json) => void): ViewNode {
  type Scope = { item: Json; index: number } | undefined;
  const ev = (expr: unknown, scope: Scope): Json => {
    if (expr === undefined) return null;
    try {
      return w.eval(expr as Json, scope);
    } catch {
      return null;
    }
  };

  // `visible` has no node of its own: when true its children are spliced into the parent.
  function many(n: WidgetNode, scope: Scope, key: string): ViewNode[] {
    if (n.type === "visible") {
      if (!truthy(ev(n.when, scope))) return [];
      return (n.children ?? []).flatMap((c, i) => many(c, scope, `${key}.${i}`));
    }
    return [one(n, scope, key)];
  }

  const kids = (n: WidgetNode, scope: Scope, key: string) => (n.children ?? []).flatMap((c, i) => many(c, scope, `${key}.${i}`));

  function one(n: WidgetNode, scope: Scope, key: string): ViewNode {
    switch (n.type) {
      case "card":
        return { type: "card", key, title: optText(ev(n.title, scope)), children: kids(n, scope, key) };
      case "column":
        return { type: "column", key, gap: num((n.gap as Json) ?? null), children: kids(n, scope, key) };
      case "row":
        return {
          type: "row",
          key,
          gap: num((n.gap as Json) ?? null),
          align: (typeof n.align === "string" ? n.align : "start") as "start",
          children: kids(n, scope, key),
        };
      case "text":
        return {
          type: "text",
          key,
          text: displayText(ev(n.value, scope)),
          style: (typeof n.style === "string" ? n.style : "body") as "body",
          color: color(ev(n.color, scope)),
        };
      case "metric": {
        const caption = ev(n.caption, scope);
        return {
          type: "metric",
          key,
          label: displayText(ev(n.label, scope)),
          value: displayText(ev(n.value, scope)),
          caption: caption === null || caption === "" ? null : displayText(caption),
          color: color(ev(n.color, scope)),
        };
      }
      case "progress": {
        const value = num(ev(n.value, scope)) ?? 0;
        const max = num(ev(n.max, scope)) ?? 1;
        return { type: "progress", key, label: optText(ev(n.label, scope)), value, max, fraction: max > 0 ? clamp01(value / max) : 0 };
      }
      case "list": {
        const raw = ev(n.items, scope);
        const arr = Array.isArray(raw) ? raw : [];
        const limit = Math.min(typeof n.limit === "number" ? n.limit : LIMITS.maxListLimit, LIMITS.maxListLimit);
        const template = n.template as WidgetNode;
        return {
          type: "list",
          key,
          items: arr.slice(0, limit).flatMap((item, index) => many(template, { item, index }, `${key}.${index}`)),
          empty: arr.length === 0 ? optText(ev(n.empty, scope)) : null,
        };
      }
      case "barChart": {
        const raw = ev(n.items, scope);
        const rows = (Array.isArray(raw) ? raw : []).slice(0, LIMITS.maxListLimit).map((it) => {
          const o = it && typeof it === "object" && !Array.isArray(it) ? it : {};
          return { label: displayText(o.label ?? null), value: num(o.value ?? null) ?? 0 };
        });
        const max = num(ev(n.max, scope)) ?? Math.max(0, ...rows.map((r) => r.value));
        return { type: "barChart", key, bars: rows.map((r) => ({ ...r, fraction: max > 0 ? clamp01(r.value / max) : 0 })) };
      }
      case "badge":
        return { type: "badge", key, text: displayText(ev(n.value, scope)), color: color(ev(n.color, scope)) };
      case "divider":
        return { type: "divider", key };
      case "input": {
        const kind = n.kind as InputKind;
        const name = n.bind as string;
        const bounds = {
          ...(typeof n.min === "number" && { min: n.min }),
          ...(typeof n.max === "number" && { max: n.max }),
          ...(typeof n.step === "number" && { step: n.step }),
        };
        return {
          type: "input",
          key,
          kind,
          name,
          label: optText(ev(n.label, scope)),
          placeholder: optText(ev(n.placeholder, scope)),
          min: bounds.min ?? null,
          max: bounds.max ?? null,
          step: bounds.step ?? null,
          multiline: n.multiline === true,
          options: kind === "select" ? selectOptions(ev(n.options, scope)) : [],
          value: w.state[name] ?? null,
          set: (raw: Json) => onSet?.(name, coerceInput(kind, raw, bounds)),
        };
      }
      default:
        // Unreachable for validated specs.
        return { type: "column", key, gap: null, children: [] };
    }
  }

  const roots = many(w.spec.root, undefined, "root");
  return roots.length === 1 ? roots[0]! : { type: "column", key: "root", gap: null, children: roots };
}

/** Canonical JSON form of a view tree (setters dropped), as used by the conformance vectors. */
export function viewToJson(node: ViewNode): Json {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "function") continue;
    out[k] = k === "children" || k === "items" ? (v as ViewNode[]).map(viewToJson) : (v as Json);
  }
  return out;
}

export type ViewListener = (view: ViewNode | null) => void;

/**
 * Headless controller for one widget: owns its input state, recomputes the view tree when the user
 * sets an input or the data changes, and notifies subscribers. This is the hook a UI layer binds to.
 *
 *     const c = graft.controller(spec, data);
 *     c.subscribe((view) => render(view));   // re-render with your UI framework
 *     // in your control's change handler:  inputNode.set(newValue)
 */
export class WidgetController {
  private listeners = new Set<ViewListener>();
  private _state: Record<string, Json>;
  private _view: ViewNode | null = null;
  private _error: string | null = null;

  constructor(
    private readonly graft: Graft,
    readonly spec: WidgetSpec,
    private data: Record<string, Json>,
    state?: Record<string, Json>,
  ) {
    this._state = state ?? initialState(spec);
    this.recompute();
  }

  /** The current view tree, or null when the widget can't be computed (see `error`). */
  get view(): ViewNode | null {
    return this._view;
  }
  get error(): string | null {
    return this._error;
  }
  get state(): Record<string, Json> {
    return this._state;
  }

  /** Sets an input value by state name (coerced the same way as an input node's setter). */
  set(name: string, value: Json): void {
    this._state = { ...this._state, [name]: value };
    this.recompute();
  }

  setData(data: Record<string, Json>): void {
    this.data = data;
    this.recompute();
  }

  /** Calls `listener` on every change. Returns an unsubscribe function. */
  subscribe(listener: ViewListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private recompute() {
    try {
      this._view = resolveView(this.graft.bind(this.spec, this.data, this._state), (name, value) => this.set(name, value));
      this._error = null;
    } catch (e) {
      this._view = null;
      this._error = e instanceof EvalError ? "too much data to compute" : "could not be computed";
    }
    this.listeners.forEach((l) => l(this._view));
  }
}

export interface SlotItem {
  spec: WidgetSpec;
  controller: WidgetController;
}

/**
 * Headless slot: keeps one controller per accepted widget in `slotId`, fetches data snapshots and
 * pushes them into the controllers, and reports the widget list whenever it changes. Controllers are
 * reused across data changes, so input state survives; an edited widget gets a fresh controller.
 */
export function watchSlot(graft: Graft, slotId: string, onItems: (items: SlotItem[]) => void): () => void {
  let items: SlotItem[] = [];
  let version = 0;
  let disposed = false;

  const refresh = async () => {
    const v = ++version;
    const specs = graft.widgets(slotId);
    const data = specs.length ? await graft.snapshot() : {};
    if (v !== version || disposed) return; // a newer refresh started while we awaited data
    const prev = new Map(items.map((i) => [i.spec.id, i]));
    const next = specs.map((spec) => {
      const old = prev.get(spec.id);
      if (old && old.spec === spec) {
        old.controller.setData(data);
        prev.delete(spec.id);
        return old;
      }
      return { spec, controller: new WidgetController(graft, spec, data) };
    });
    prev.forEach((i) => i.controller.dispose());
    const changed = next.length !== items.length || next.some((x, i) => x !== items[i]);
    items = next;
    if (changed) onItems(items);
  };

  const off = graft.onChange(() => void refresh());
  void refresh();
  return () => {
    disposed = true;
    off();
    items.forEach((i) => i.controller.dispose());
  };
}
