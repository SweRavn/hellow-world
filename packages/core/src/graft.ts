import { IntlFormatter } from "./format.js";
import { evaluate, resolveBindings, type EvalContext, type Formatter } from "./expr.js";
import type { GenerateRequest } from "./prompt.js";
import { SPEC_VERSION, type DataSourceInfo, type Expr, type Json, type Manifest, type SlotInfo, type WidgetSpec } from "./types.js";
import { validateSpec } from "./validate.js";
import { initialState } from "./input.js";
import { WidgetController, watchSlot, type SlotItem } from "./view.js";

/** A piece of app data the host exposes to generated widgets. */
export interface DataSource extends DataSourceInfo {
  /** Returns the current value. Called on render and whenever `subscribe` signals a change. */
  get(): Json | Promise<Json>;
  /** Optional: notify Graft when the data changes so widgets re-render. Returns an unsubscribe function. */
  subscribe?(onChange: () => void): () => void;
}

/** Turns a natural-language request into an (untrusted) widget spec. Usually a call to your backend. */
export interface Generator {
  generate(req: GenerateRequest): Promise<unknown>;
}

/** Persists accepted widgets. Swap in your own to sync per user through your backend. */
export interface WidgetStore {
  load(): Promise<unknown[]>;
  save(widgets: WidgetSpec[]): Promise<void>;
}

export class MemoryStore implements WidgetStore {
  private widgets: WidgetSpec[] = [];
  async load() {
    return structuredClone(this.widgets);
  }
  async save(widgets: WidgetSpec[]) {
    this.widgets = structuredClone(widgets);
  }
}

/** Calls a generator backend over HTTP (see server/ for the reference implementation). */
export class HttpGenerator implements Generator {
  constructor(
    private readonly url: string,
    private readonly opts: { headers?: () => Record<string, string> | Promise<Record<string, string>>; fetch?: typeof fetch } = {},
  ) {}

  async generate(req: GenerateRequest): Promise<unknown> {
    const f = this.opts.fetch ?? fetch;
    const res = await f(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await this.opts.headers?.()) },
      body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => ({}))) as { spec?: unknown; error?: string; details?: string[] };
    if (!res.ok || !body.spec) {
      throw new GraftError(body.error ?? `generator returned HTTP ${res.status}`, body.details ?? []);
    }
    return body.spec;
  }
}

export class GraftError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "GraftError";
  }
}

export interface GraftOptions {
  app: { name: string; description?: string };
  generator: Generator;
  store?: WidgetStore;
  theme?: { currency?: string; locale?: string };
  /** Override number/date formatting. Defaults to Intl with `theme.locale`/`theme.currency`. */
  formatter?: Formatter;
}

export type Listener = () => void;

/**
 * Platform-neutral Graft engine. Platform SDKs (web, Android, iOS) wrap it with renderers and UI.
 *
 *   const graft = new Graft({ app, generator: new HttpGenerator("/graft/generate") });
 *   graft.addDataSource("transactions", { description, schema, get: () => store.transactions });
 *   graft.addSlot("home.top", { description: "Top of the home screen" });
 *   await graft.init();
 *   const spec = await graft.propose("show my food spend this month");  // preview it, then:
 *   await graft.accept(spec);
 */
export class Graft {
  private readonly sources = new Map<string, DataSource>();
  private readonly slots = new Map<string, SlotInfo>();
  private readonly listeners = new Set<Listener>();
  private readonly unsubs: (() => void)[] = [];
  private widgetList: WidgetSpec[] = [];
  private readonly store: WidgetStore;
  readonly formatter: Formatter;

  constructor(private readonly opts: GraftOptions) {
    this.store = opts.store ?? new MemoryStore();
    this.formatter = opts.formatter ?? new IntlFormatter(opts.theme?.locale, opts.theme?.currency);
  }

  addDataSource(name: string, source: DataSource): this {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === "state") throw new GraftError(`invalid data source name "${name}"`);
    this.sources.set(name, source);
    if (source.subscribe) this.unsubs.push(source.subscribe(() => this.emit()));
    return this;
  }

  addSlot(id: string, info: SlotInfo): this {
    this.slots.set(id, info);
    return this;
  }

  /** Loads persisted widgets, dropping any that no longer validate (e.g. a data source was removed). */
  async init(): Promise<void> {
    const raw = await this.store.load();
    const manifest = this.manifest();
    this.widgetList = raw.flatMap((w) => {
      const r = validateSpec(w, manifest);
      return r.ok ? [r.spec] : [];
    });
    this.emit();
  }

  /** What the generator is allowed to know about this app. */
  manifest(): Manifest {
    const dataSources: Manifest["dataSources"] = {};
    for (const [name, s] of this.sources) {
      dataSources[name] = { description: s.description, schema: s.schema, ...(s.sample !== undefined && { sample: s.sample }) };
    }
    return {
      app: this.opts.app,
      dataSources,
      slots: Object.fromEntries(this.slots),
      ...(this.opts.theme && { theme: this.opts.theme }),
    };
  }

  /**
   * Generates and validates a widget for the user's request. Does not persist it:
   * show it as a preview and call `accept` when the user confirms.
   */
  async propose(prompt: string, options: { slot?: string; edit?: WidgetSpec | string } = {}): Promise<WidgetSpec> {
    const manifest = this.manifest();
    // `edit` refines either an accepted widget (by id) or an unaccepted preview (by spec).
    const existing = typeof options.edit === "string" ? this.widgetList.find((w) => w.id === options.edit) : options.edit;
    const raw = await this.opts.generator.generate({
      prompt,
      manifest,
      specVersion: SPEC_VERSION,
      ...(options.slot && { slot: options.slot }),
      ...(existing && { existing }),
    });
    // Never trust the generator: always validate on device too.
    const r = validateSpec(raw, manifest);
    if (!r.ok) throw new GraftError("The generated widget was invalid", r.errors);
    const spec = structuredClone(r.spec);
    if (existing) spec.id = existing.id;
    else if (this.widgetList.some((w) => w.id === spec.id)) spec.id = `${spec.id}_${Date.now().toString(36)}`;
    spec.prompt ??= prompt;
    return spec;
  }

  async accept(spec: WidgetSpec): Promise<void> {
    const r = validateSpec(spec, this.manifest());
    if (!r.ok) throw new GraftError("Widget is invalid", r.errors);
    const i = this.widgetList.findIndex((w) => w.id === spec.id);
    this.widgetList = i >= 0 ? this.widgetList.map((w, j) => (j === i ? spec : w)) : [...this.widgetList, spec];
    await this.store.save(this.widgetList);
    this.emit();
  }

  async remove(id: string): Promise<void> {
    this.widgetList = this.widgetList.filter((w) => w.id !== id);
    await this.store.save(this.widgetList);
    this.emit();
  }

  widgets(slot?: string): WidgetSpec[] {
    const list = slot ? this.widgetList.filter((w) => w.slot === slot) : this.widgetList;
    const max = slot ? this.slots.get(slot)?.maxWidgets : undefined;
    return max === undefined ? list : list.slice(-max);
  }

  slotIds(): string[] {
    return [...this.slots.keys()];
  }

  /** Called when widgets or any subscribed data source change. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fetches the current value of every data source. */
  async snapshot(): Promise<Record<string, Json>> {
    const entries = await Promise.all([...this.sources].map(async ([k, s]) => [k, (await s.get()) ?? null] as const));
    return Object.fromEntries(entries);
  }

  /**
   * Prepares a spec for rendering against a data snapshot and the widget's current input state
   * (defaults to its initial state): resolves bindings, returns an evaluator.
   */
  bind(spec: WidgetSpec, data: Record<string, Json>, state: Record<string, Json> = initialState(spec)): BoundWidget {
    const base: Omit<EvalContext, "vars"> = { formatter: this.formatter };
    const vars = resolveBindings(spec.bindings, spec.state ? { ...data, state } : data, base);
    return {
      spec,
      state,
      eval: (expr, scope) => evaluate(expr, { ...base, vars, ...(scope && { scope }) }),
    };
  }

  /** Headless controller for one widget: view tree + input getters/setters for any UI framework. */
  controller(spec: WidgetSpec, data: Record<string, Json>, state?: Record<string, Json>): WidgetController {
    return new WidgetController(this, spec, data, state);
  }

  /** Headless slot: reports the slot's widgets (each with a live controller) whenever they change. */
  watchSlot(slotId: string, onItems: (items: SlotItem[]) => void): () => void {
    return watchSlot(this, slotId, onItems);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.listeners.clear();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

export interface BoundWidget {
  spec: WidgetSpec;
  /** Current input values, by state name. */
  state: Record<string, Json>;
  eval(expr: Expr, scope?: { item: Json; index: number }): Json;
}
