import type { InputKind } from "./catalog.js";
import { truthy } from "./expr.js";
import { LIMITS, type Json, type WidgetSpec } from "./types.js";

/** The starting state of a widget: a copy of its declared `state` initial values. */
export function initialState(spec: WidgetSpec): Record<string, Json> {
  return { ...(spec.state ?? {}) };
}

/** Rounds away floating-point noise from step snapping (0.30000000000000004 -> 0.3). */
const clean = (x: number) => Math.round(x * 1e10) / 1e10;

function parseNumber(raw: Json): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(",", ".");
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts a raw value from a platform input control into the value stored in widget state.
 * Identical on every platform (see spec/conformance/inputs.json), so formulas see the same values.
 */
export function coerceInput(kind: InputKind, raw: Json, props: { min?: number; max?: number; step?: number } = {}): Json {
  switch (kind) {
    case "text": {
      if (raw === null) return null;
      const s = typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
      return s.slice(0, LIMITS.maxTextLength);
    }
    case "number":
      return parseNumber(raw);
    case "slider": {
      let n = parseNumber(raw);
      const min = props.min ?? 0;
      const max = props.max ?? 1;
      if (n === null) n = min;
      if (props.step) n = min + Math.round((n - min) / props.step) * props.step;
      return clean(Math.min(max, Math.max(min, n)));
    }
    case "toggle":
      return typeof raw === "boolean" ? raw : truthy(raw);
    case "select":
      return typeof raw === "string" || (typeof raw === "number" && Number.isFinite(raw)) ? raw : null;
    case "date": {
      if (typeof raw !== "string") return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
      if (!m) return null;
      const month = Number(m[2]);
      const day = Number(m[3]);
      return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? m[0] : null;
    }
  }
}

/** Normalizes select options: strings/numbers become {label, value}; objects need a value. */
export function selectOptions(options: Json): { label: string; value: string | number }[] {
  if (!Array.isArray(options)) return [];
  const out: { label: string; value: string | number }[] = [];
  for (const o of options.slice(0, LIMITS.maxListLimit)) {
    if (typeof o === "string" || (typeof o === "number" && Number.isFinite(o))) out.push({ label: String(o), value: o });
    else if (o && typeof o === "object" && !Array.isArray(o)) {
      const v = o.value;
      if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) {
        const l = o.label;
        out.push({ label: typeof l === "string" || typeof l === "number" ? String(l) : String(v), value: v });
      }
    }
  }
  return out;
}
