import { LIMITS, type Expr, type Json } from "./types.js";

/**
 * Operator table: name -> [minArgs, maxArgs]. Shared by the evaluator and the validator.
 * Keep in sync with spec/README.md §3.
 */
export const OPERATORS: Record<string, [number, number]> = {
  var: [1, 2],
  "+": [1, Infinity],
  "-": [1, 2],
  "*": [1, Infinity],
  "/": [2, 2],
  "%": [2, 2],
  round: [1, 2],
  "==": [2, 2],
  "!=": [2, 2],
  ">": [2, 2],
  ">=": [2, 2],
  "<": [2, 2],
  "<=": [2, 2],
  and: [1, Infinity],
  or: [1, Infinity],
  not: [1, 1],
  if: [2, 3],
  "??": [2, 2],
  count: [1, 1],
  sum: [1, 2],
  avg: [1, 2],
  min: [1, 2],
  max: [1, 2],
  filter: [2, 2],
  map: [2, 2],
  sort: [1, 3],
  take: [2, 2],
  first: [1, 1],
  last: [1, 1],
  group: [2, 3],
  pluck: [2, 2],
  concat: [1, Infinity],
  lower: [1, 1],
  upper: [1, 1],
  contains: [2, 2],
  format: [2, 3],
  now: [0, 0],
  toTime: [1, 1],
  startOf: [1, 2],
  addDays: [2, 2],
  object: [2, Infinity],
};

/** Operators whose argument at the given index is evaluated per element with `item`/`index` in scope. */
export const ITERATOR_ARGS: Record<string, number[]> = {
  filter: [1],
  map: [1],
  group: [1, 2],
};

export class EvalError extends Error {}

export interface Formatter {
  format(value: Json, kind: string, arg: Json): string | null;
}

export interface EvalContext {
  /** Root scope: data sources and bindings by name. */
  vars: Record<string, Json>;
  formatter?: Formatter;
  now?: () => number;
  maxSteps?: number;
  /** Set when evaluating inside a list template. */
  scope?: { item: Json; index: number };
}

interface Scope {
  item?: Json;
  index?: number;
  hasItem: boolean;
}

/** If `expr` is an operator call, returns [op, args]; otherwise null (it is a literal). */
export function asCall(expr: Expr): [string, Expr[]] | null {
  if (expr === null || typeof expr !== "object" || Array.isArray(expr)) return null;
  const keys = Object.keys(expr);
  if (keys.length !== 1) return null;
  const op = keys[0]!;
  const raw = expr[op] as Json;
  return [op, Array.isArray(raw) ? raw : [raw]];
}

export function truthy(v: Json | undefined): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: Json): number | null => (isNum(v) ? v : null);

function getPath(root: Json | undefined, segments: string[]): Json | undefined {
  let cur: Json | undefined = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg)) return undefined;
      cur = cur[Number(seg)];
    } else if (typeof cur === "object") {
      cur = Object.prototype.hasOwnProperty.call(cur, seg) ? cur[seg] : undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

function field(el: Json, f: Json | undefined): Json {
  if (f === undefined || f === null) return el;
  return getPath(el, String(f).split(".")) ?? null;
}

export function roundHalfAway(x: number, digits = 0): number {
  const m = Math.pow(10, digits);
  const v = Math.abs(x) * m;
  // Nudge by a relative epsilon so 2.345 (stored as 2.34499999...) rounds like a human expects.
  const r = Math.floor(v + 0.5 + v * Number.EPSILON * 4) / m;
  return x < 0 ? -r : r;
}

/** Shortest round-trip number formatting, identical across platforms ("2", "2.5"). */
export function numberToString(n: number): string {
  return String(n);
}

function stringify(v: Json): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numberToString(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

function compare(a: Json, b: Json): number | null {
  if (isNum(a) && isNum(b)) return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]!));
  }
  if (typeof a === "object" && typeof b === "object" && !Array.isArray(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k]!, b[k]!));
  }
  return false;
}

export function toTime(v: Json): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function startOf(unit: string, t: number): number | null {
  const d = new Date(t);
  switch (unit) {
    case "day":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case "week": {
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
    }
    case "month":
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    case "year":
      return new Date(d.getFullYear(), 0, 1).getTime();
    default:
      return null;
  }
}

/**
 * Evaluates a Graft expression. Never throws on type mismatches (yields null);
 * throws EvalError only when the step budget is exhausted or an unknown operator
 * slipped past validation.
 */
export function evaluate(expr: Expr, ctx: EvalContext): Json {
  let steps = 0;
  const maxSteps = ctx.maxSteps ?? LIMITS.maxSteps;

  const list = (v: Json): Json[] => (Array.isArray(v) ? v : []);

  const aggregate = (op: string, args: Expr[], scope: Scope): Json => {
    const f = args[1] === undefined ? undefined : ev(args[1], scope);
    const nums = list(ev(args[0]!, scope))
      .map((el) => field(el, f))
      .filter(isNum);
    if (op === "sum") return nums.reduce((a, b) => a + b, 0);
    if (nums.length === 0) return null;
    if (op === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
    return op === "min" ? Math.min(...nums) : Math.max(...nums);
  };

  function ev(e: Expr, scope: Scope): Json {
    if (++steps > maxSteps) throw new EvalError("expression step budget exceeded");
    if (Array.isArray(e)) return e.map((x) => ev(x, scope));
    const call = asCall(e);
    if (!call) return e;
    const [op, args] = call;
    const a = (i: number): Json => (args[i] === undefined ? null : ev(args[i]!, scope));

    switch (op) {
      case "var": {
        const path = String(a(0) ?? "");
        const [head, ...rest] = path.split(".");
        let base: Json | undefined;
        if (head === "item" && scope.hasItem) base = scope.item;
        else if (head === "index" && scope.hasItem) base = scope.index ?? null;
        else if (Object.prototype.hasOwnProperty.call(ctx.vars, head!)) base = ctx.vars[head!];
        const v = getPath(base, rest);
        return v === undefined ? (args.length > 1 ? a(1) : null) : v;
      }
      case "+": {
        let s = 0;
        for (let i = 0; i < args.length; i++) {
          const v = a(i);
          if (v === null) continue;
          if (!isNum(v)) return null;
          s += v;
        }
        return s;
      }
      case "*": {
        let p = 1;
        for (let i = 0; i < args.length; i++) {
          const v = num(a(i));
          if (v === null) return null;
          p *= v;
        }
        return p;
      }
      case "-": {
        const x = num(a(0));
        if (args.length === 1) return x === null ? null : -x;
        const y = num(a(1));
        return x === null || y === null ? null : x - y;
      }
      case "/":
      case "%": {
        const x = num(a(0));
        const y = num(a(1));
        if (x === null || y === null || y === 0) return null;
        return op === "/" ? x / y : x % y;
      }
      case "round": {
        const x = num(a(0));
        const d = args.length > 1 ? num(a(1)) ?? 0 : 0;
        return x === null ? null : roundHalfAway(x, d);
      }
      case "==":
        return deepEqual(a(0), a(1));
      case "!=":
        return !deepEqual(a(0), a(1));
      case ">":
      case ">=":
      case "<":
      case "<=": {
        const c = compare(a(0), a(1));
        if (c === null) return false;
        return op === ">" ? c > 0 : op === ">=" ? c >= 0 : op === "<" ? c < 0 : c <= 0;
      }
      case "and":
        for (let i = 0; i < args.length; i++) if (!truthy(a(i))) return false;
        return true;
      case "or":
        for (let i = 0; i < args.length; i++) if (truthy(a(i))) return true;
        return false;
      case "not":
        return !truthy(a(0));
      case "if":
        return truthy(a(0)) ? a(1) : a(2);
      case "??": {
        const v = a(0);
        return v === null ? a(1) : v;
      }
      case "count": {
        const v = a(0);
        return Array.isArray(v) ? v.length : 0;
      }
      case "sum":
      case "avg":
      case "min":
      case "max":
        return aggregate(op, args, scope);
      case "filter": {
        const items = list(a(0));
        return items.filter((_, i) => truthy(ev(args[1]!, { item: items[i]!, index: i, hasItem: true })));
      }
      case "map":
        return list(a(0)).map((el, i) => ev(args[1]!, { item: el, index: i, hasItem: true }));
      case "sort": {
        const f = args.length > 1 ? a(1) : null;
        const dir = args.length > 2 ? a(2) : "asc";
        const sign = dir === "desc" ? -1 : 1;
        return list(a(0))
          .map((el, i) => ({ el, i, k: field(el, f) }))
          .sort((x, y) => {
            const c = compare(x.k, y.k);
            if (c === null) {
              // nulls/mismatched types sort last, stable
              const xn = x.k === null ? 1 : 0;
              const yn = y.k === null ? 1 : 0;
              return xn - yn || x.i - y.i;
            }
            return sign * Math.sign(c) || x.i - y.i;
          })
          .map((x) => x.el);
      }
      case "take": {
        const n = num(a(1));
        return n === null ? [] : list(a(0)).slice(0, Math.max(0, Math.floor(n)));
      }
      case "first": {
        const l = list(a(0));
        return l.length ? l[0]! : null;
      }
      case "last": {
        const l = list(a(0));
        return l.length ? l[l.length - 1]! : null;
      }
      case "group": {
        const groups = new Map<string, { key: Json; count: number; sum: number }>();
        list(a(0)).forEach((el, i) => {
          const s: Scope = { item: el, index: i, hasItem: true };
          const key = ev(args[1]!, s);
          const id = JSON.stringify(key);
          let g = groups.get(id);
          if (!g) groups.set(id, (g = { key, count: 0, sum: 0 }));
          g.count++;
          if (args[2] !== undefined) {
            const v = ev(args[2], s);
            if (isNum(v)) g.sum += v;
          }
        });
        return [...groups.values()].map((g) => ({ key: g.key, count: g.count, sum: g.sum }));
      }
      case "pluck": {
        const f = a(1);
        return list(a(0)).map((el) => field(el, f));
      }
      case "concat": {
        let s = "";
        for (let i = 0; i < args.length; i++) s += stringify(a(i));
        return s;
      }
      case "lower":
      case "upper": {
        const v = a(0);
        if (typeof v !== "string") return null;
        return op === "lower" ? v.toLowerCase() : v.toUpperCase();
      }
      case "contains": {
        const h = a(0);
        const n = a(1);
        if (typeof h === "string") return typeof n === "string" && h.includes(n);
        if (Array.isArray(h)) return h.some((x) => deepEqual(x, n));
        return false;
      }
      case "format": {
        const v = a(0);
        if (v === null) return "";
        const kind = String(a(1));
        return ctx.formatter?.format(v, kind, args.length > 2 ? a(2) : null) ?? stringify(v);
      }
      case "now":
        return (ctx.now ?? Date.now)();
      case "toTime":
        return toTime(a(0));
      case "startOf": {
        const t = args.length > 1 ? toTime(a(1)) : (ctx.now ?? Date.now)();
        return t === null ? null : startOf(String(a(0)), t);
      }
      case "addDays": {
        const t = toTime(a(0));
        const n = num(a(1));
        return t === null || n === null ? null : t + n * 86_400_000;
      }
      case "object": {
        const o: Record<string, Json> = {};
        for (let i = 0; i + 1 < args.length; i += 2) o[String(a(i))] = a(i + 1);
        return o;
      }
      default:
        throw new EvalError(`unknown operator "${op}"`);
    }
  }

  return ev(expr, ctx.scope ? { item: ctx.scope.item, index: ctx.scope.index, hasItem: true } : { hasItem: false });
}

/**
 * Evaluates spec bindings in declaration order, each seeing data sources and earlier bindings.
 * Returns the full root scope (data sources + bindings).
 */
export function resolveBindings(
  bindings: Record<string, Expr> | undefined,
  data: Record<string, Json>,
  opts: Omit<EvalContext, "vars"> = {},
): Record<string, Json> {
  const vars: Record<string, Json> = { ...data };
  for (const [name, expr] of Object.entries(bindings ?? {})) {
    vars[name] = evaluate(expr, { ...opts, vars });
  }
  return vars;
}
