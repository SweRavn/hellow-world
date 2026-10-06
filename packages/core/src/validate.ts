import { COMPONENTS, type PropDef } from "./catalog.js";
import { ITERATOR_ARGS, OPERATORS, asCall } from "./expr.js";
import { COLOR_TOKENS, LIMITS, SPEC_VERSION, type Expr, type Json, type Manifest, type WidgetNode, type WidgetSpec } from "./types.js";

export type ValidationResult = { ok: true; spec: WidgetSpec } | { ok: false; errors: string[] };

const RESERVED = new Set(["item", "index"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Statically validates an untrusted widget spec against the manifest and component catalog.
 * Generators should feed `errors` back to the model to repair the spec.
 */
export function validateSpec(input: unknown, manifest: Manifest): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.length < 50 && errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { ok: false, errors: ["spec: must be an object"] };
  const spec = input as Partial<WidgetSpec> & Record<string, unknown>;

  if (spec.specVersion !== SPEC_VERSION) err("specVersion", `unsupported specVersion ${String(spec.specVersion)}; expected ${SPEC_VERSION}`);
  if (typeof spec.id !== "string" || !spec.id) err("id", "must be a non-empty string");
  if (typeof spec.title !== "string" || !spec.title) err("title", "must be a non-empty string");
  if (typeof spec.slot !== "string" || !(spec.slot in manifest.slots)) {
    err("slot", `unknown slot "${String(spec.slot)}"; available: ${Object.keys(manifest.slots).join(", ")}`);
  }

  // Root scope grows as bindings are declared, so bindings can only reference earlier ones.
  const known = new Set(Object.keys(manifest.dataSources));

  // Widget-local state: named, literal initial values that inputs read and write.
  const state = isObj(spec.state) ? (spec.state as Record<string, Json>) : undefined;
  if (spec.state !== undefined) {
    if (!state) err("state", "must be an object of name -> initial value");
    else {
      const names = Object.keys(state);
      if (names.length > LIMITS.maxStateEntries) err("state", `at most ${LIMITS.maxStateEntries} state entries`);
      for (const name of names) {
        const v = state[name];
        if (!IDENT.test(name)) err(`state.${name}`, "state names must be identifiers");
        if (!(v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= LIMITS.maxTextLength))) {
          err(`state.${name}`, "initial value must be a literal string, number, boolean or null");
        }
      }
      if ("state" in manifest.dataSources) err("state", 'conflicts with a data source named "state"');
      known.add("state");
    }
  }

  function checkExpr(e: Expr, path: string, inIter: boolean): void {
    if (Array.isArray(e)) return e.forEach((x, i) => checkExpr(x, `${path}[${i}]`, inIter));
    if (!isObj(e)) return;
    const call = asCall(e);
    if (!call) {
      err(path, "object literals are not allowed; an expression object must have exactly one operator key (use `object` to build objects)");
      return;
    }
    const [op, args] = call;
    const arity = OPERATORS[op];
    if (!arity) {
      err(path, `unknown operator "${op}"`);
      return;
    }
    if (args.length < arity[0] || args.length > arity[1]) {
      err(path, `"${op}" takes ${arity[0]}${arity[1] === arity[0] ? "" : arity[1] === Infinity ? "+" : `-${arity[1]}`} arguments, got ${args.length}`);
      return;
    }
    if (op === "var") {
      const p = args[0];
      if (typeof p !== "string") {
        err(path, "var path must be a string literal");
        return;
      }
      const head = p.split(".")[0]!;
      const ok = RESERVED.has(head) ? inIter : known.has(head);
      if (!ok) {
        const avail = [...known, ...(inIter ? RESERVED : [])].join(", ");
        err(path, `unknown variable "${head}"; available here: ${avail}`);
      }
      if (args[1] !== undefined) checkExpr(args[1], `${path}.var[1]`, inIter);
      return;
    }
    const iterArgs = ITERATOR_ARGS[op] ?? [];
    args.forEach((x, i) => checkExpr(x, `${path}.${op}[${i}]`, inIter || iterArgs.includes(i)));
  }

  const bindings = spec.bindings;
  if (bindings !== undefined) {
    if (!isObj(bindings)) err("bindings", "must be an object");
    else {
      const names = Object.keys(bindings);
      if (names.length > LIMITS.maxBindings) err("bindings", `at most ${LIMITS.maxBindings} bindings`);
      for (const name of names) {
        if (RESERVED.has(name) || name === "state" || name in manifest.dataSources || !IDENT.test(name)) {
          err(`bindings.${name}`, "invalid binding name (must be an identifier, not a data source name, item, index or state)");
        }
        checkExpr(bindings[name] as Expr, `bindings.${name}`, false);
        known.add(name);
      }
    }
  }

  let nodes = 0;
  function checkProp(def: PropDef, value: unknown, path: string, inIter: boolean, depth: number): void {
    const k = def.kind;
    if (k === "children") {
      if (!Array.isArray(value)) return void err(path, "must be an array of nodes");
      value.forEach((c, i) => checkNode(c, `${path}[${i}]`, inIter, depth + 1));
    } else if (k === "node") {
      checkNode(value, path, inIter || !!def.iterates, depth + 1);
    } else if (k === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) err(path, "must be a non-negative number literal");
    } else if (k === "signed") {
      if (typeof value !== "number" || !Number.isFinite(value)) err(path, "must be a number literal");
    } else if (k === "bool") {
      if (typeof value !== "boolean") err(path, "must be true or false");
    } else if (k === "stateRef") {
      if (typeof value !== "string" || !state || !(value in state)) {
        err(path, `must name a declared state entry; declared: ${state ? Object.keys(state).join(", ") || "none" : "none (add a top-level \"state\" object)"}`);
      }
    } else if (k === "color") {
      if (typeof value === "string") {
        if (!(COLOR_TOKENS as readonly string[]).includes(value)) err(path, `color must be one of ${COLOR_TOKENS.join(", ")}`);
      } else checkExpr(value as Json, path, inIter);
    } else if (typeof k === "object") {
      if (typeof value !== "string" || !k.enum.includes(value)) err(path, `must be one of ${k.enum.join(", ")}`);
    } else {
      checkExpr(value as Json, path, inIter);
    }
  }

  function checkNode(n: unknown, path: string, inIter: boolean, depth: number): void {
    if (++nodes > LIMITS.maxNodes) {
      if (nodes === LIMITS.maxNodes + 1) err(path, `too many nodes (max ${LIMITS.maxNodes})`);
      return;
    }
    if (depth > LIMITS.maxDepth) return void err(path, `max depth ${LIMITS.maxDepth} exceeded`);
    if (!isObj(n) || typeof n.type !== "string") return void err(path, "node must be an object with a string `type`");
    const def = COMPONENTS[n.type];
    if (!def) return void err(path, `unknown component "${n.type}"; available: ${Object.keys(COMPONENTS).join(", ")}`);
    for (const [prop, value] of Object.entries(n)) {
      if (prop === "type") continue;
      const pd = def.props[prop];
      if (!pd) {
        err(`${path}.${prop}`, `unknown prop for ${n.type}`);
        continue;
      }
      checkProp(pd, value, `${path}.${prop}`, inIter, depth);
    }
    for (const [prop, pd] of Object.entries(def.props)) {
      if (pd.required && !(prop in n)) err(`${path}.${prop}`, `required prop "${prop}" missing on ${n.type}`);
    }
    if (n.type === "list" && typeof n.limit === "number" && n.limit > LIMITS.maxListLimit) {
      err(`${path}.limit`, `limit must be <= ${LIMITS.maxListLimit}`);
    }
    if (n.type === "input") checkInput(n, path, inIter);
  }

  /** Cross-prop rules for inputs: per-kind required props and state value types. */
  function checkInput(n: Record<string, unknown>, path: string, inIter: boolean): void {
    if (inIter) err(path, "inputs cannot be inside list templates");
    const kind = n.kind as string;
    const initial = typeof n.bind === "string" && state ? state[n.bind] : undefined;
    const numeric = kind === "number" || kind === "slider";
    for (const p of ["min", "max", "step"]) if (p in n && !numeric) err(`${path}.${p}`, `only applies to number and slider inputs`);
    if ("placeholder" in n && kind !== "text" && kind !== "number") err(`${path}.placeholder`, "only applies to text and number inputs");
    if ("multiline" in n && kind !== "text") err(`${path}.multiline`, "only applies to text inputs");
    if ("options" in n !== (kind === "select")) err(`${path}.options`, kind === "select" ? "select inputs need options" : "only applies to select inputs");
    if (kind === "slider" && (typeof n.min !== "number" || typeof n.max !== "number")) err(path, "slider inputs need min and max");
    if (typeof n.min === "number" && typeof n.max === "number" && n.min > n.max) err(`${path}.min`, "min must be <= max");
    if (typeof n.step === "number" && n.step <= 0) err(`${path}.step`, "step must be > 0");
    if (initial === undefined) return;
    const ok =
      kind === "toggle" ? typeof initial === "boolean"
      : kind === "slider" ? typeof initial === "number"
      : kind === "number" ? initial === null || typeof initial === "number"
      : kind === "date" ? initial === null || (typeof initial === "string" && ISO_DATE.test(initial))
      : kind === "select" ? initial === null || typeof initial === "string" || typeof initial === "number"
      : initial === null || typeof initial === "string";
    if (!ok) {
      const want = { toggle: "a boolean", slider: "a number", number: "a number or null", date: '"YYYY-MM-DD" or null', select: "a string, number or null", text: "a string or null" }[kind];
      err(`${path}.bind`, `state "${String(n.bind)}" must start as ${want ?? "a compatible value"} for a ${kind} input`);
    }
  }

  if (spec.root === undefined) err("root", "missing");
  else checkNode(spec.root, "root", false, 1);

  return errors.length ? { ok: false, errors } : { ok: true, spec: spec as WidgetSpec };
}

export function isWidgetNode(v: unknown): v is WidgetNode {
  return isObj(v) && typeof v.type === "string";
}
