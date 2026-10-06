/** Version of the widget spec this SDK understands. See spec/README.md. */
export const SPEC_VERSION = 1;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A literal value or a single-key operator object, e.g. `{ "sum": [{ "var": "tx" }, "amount"] }`. */
export type Expr = Json;

export interface SchemaNode {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  format?: string;
  enum?: Json[];
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
}

export interface DataSourceInfo {
  description: string;
  schema: SchemaNode;
  /** Optional, developer-curated example data sent to the generator. Keep it small and non-sensitive. */
  sample?: Json;
}

export interface SlotInfo {
  description: string;
  maxWidgets?: number;
}

/** What the host app exposes to the generator. Never contains live data unless put in `sample`. */
export interface Manifest {
  app: { name: string; description?: string };
  dataSources: Record<string, DataSourceInfo>;
  slots: Record<string, SlotInfo>;
  theme?: { currency?: string; locale?: string };
}

export type ColorToken = "default" | "muted" | "accent" | "positive" | "negative" | "warning";
export const COLOR_TOKENS: readonly ColorToken[] = ["default", "muted", "accent", "positive", "negative", "warning"];

export interface WidgetNode {
  type: string;
  children?: WidgetNode[];
  template?: WidgetNode;
  [prop: string]: Json | WidgetNode | WidgetNode[] | undefined;
}

export interface WidgetSpec {
  specVersion: number;
  id: string;
  title: string;
  slot: string;
  prompt?: string;
  /** Widget-local state written by `input` nodes; read with {"var": "state.<name>"}. Literal initial values. */
  state?: Record<string, Json>;
  bindings?: Record<string, Expr>;
  root: WidgetNode;
}

export const LIMITS = {
  maxNodes: 200,
  maxDepth: 12,
  maxBindings: 50,
  maxListLimit: 100,
  maxSteps: 100_000,
  maxStateEntries: 20,
  maxTextLength: 1000,
} as const;
