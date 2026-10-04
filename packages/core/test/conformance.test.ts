import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coerceInput, evaluate, resolveBindings, selectOptions, validateSpec, type InputKind, type Json, type Manifest } from "../src/index.js";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../../spec/conformance/${f}`, import.meta.url), "utf8"));

describe("expression conformance", () => {
  const { data, cases } = load("expressions.json");
  for (const c of cases as { name: string; expr: Json; expect: Json; bindings?: Record<string, Json> }[]) {
    it(c.name, () => {
      const vars = resolveBindings(c.bindings, data);
      expect(evaluate(c.expr, { vars })).toEqual(c.expect);
    });
  }
});

describe("validation conformance", () => {
  const { manifest, cases } = load("validation.json") as {
    manifest: Manifest;
    cases: { name: string; valid: boolean; error?: string; spec: unknown }[];
  };
  for (const c of cases) {
    it(c.name, () => {
      const r = validateSpec(c.spec, manifest);
      if (c.valid) expect(r).toMatchObject({ ok: true });
      else {
        expect(r.ok).toBe(false);
        if (!r.ok && c.error) expect(r.errors.join("\n").toLowerCase()).toContain(c.error.toLowerCase());
      }
    });
  }
});

describe("input conformance", () => {
  const { coerce, options } = load("inputs.json") as {
    coerce: { name: string; kind: InputKind; raw: Json; props?: { min?: number; max?: number; step?: number }; expect: Json }[];
    options: { name: string; options: Json; expect: Json }[];
  };
  for (const c of coerce) it(`coerce: ${c.name}`, () => expect(coerceInput(c.kind, c.raw, c.props)).toEqual(c.expect));
  for (const c of options) it(`options: ${c.name}`, () => expect(selectOptions(c.options)).toEqual(c.expect));
});
