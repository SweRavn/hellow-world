# Graft Widget Spec — v1

This document is the **normative contract** shared by every Graft SDK (web,
Android, iOS) and by every generator backend. A generator turns an end-user's
natural-language request into a *Widget Spec* (JSON). An SDK validates the spec
and renders it natively, binding it to live data the host app has exposed.

Specs are **data, not code**. Nothing in a spec is ever executed as
JavaScript/Kotlin/Swift. This keeps generated features sandboxed, makes them
portable across platforms, and keeps mobile apps within app-store rules on
downloaded executable code.

---

## 1. Manifest (host app → generator)

The host app describes what the generator may use. The manifest is the *only*
thing about the app the LLM sees; live data never leaves the device unless the
developer puts it in `sample`.

```jsonc
{
  "app": { "name": "Budgetly", "description": "Personal expense tracker" },
  "dataSources": {
    "transactions": {
      "description": "The user's card transactions, newest first",
      "schema": {                         // Schema node, see below
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "amount":   { "type": "number", "description": "In account currency, positive = spend" },
            "category": { "type": "string" },
            "date":     { "type": "string", "format": "date-time" }
          }
        }
      },
      "sample": [ { "amount": 12.5, "category": "Food", "date": "2026-10-01T12:00:00Z" } ]
    }
  },
  "slots": {
    "home.top": { "description": "Top of the home screen, full width", "maxWidgets": 3 }
  },
  "theme": { "currency": "EUR", "locale": "sv-SE" }
}
```

**Schema node**: `{ "type": "string"|"number"|"integer"|"boolean"|"array"|"object", "description"?, "format"?, "items"? (array), "properties"? (object), "enum"? }`
— a small subset of JSON Schema.

**Slots** are explicit, named places in the host UI (`<graft-slot>`,
`GraftSlot(...)`, `GraftSlotView(...)`). Graft never patches arbitrary host UI;
it only renders inside slots the developer placed.

---

## 2. Widget Spec (generator → SDK)

```jsonc
{
  "specVersion": 1,
  "id": "w_3f9a",                 // unique, assigned by generator or SDK
  "title": "Food spend this month",
  "slot": "home.top",
  "prompt": "show how much I spent on food this month",   // original request
  "state": { },                   // optional widget-local input values, see §2.4
  "bindings": {                   // optional named, reusable expressions
    "foodThisMonth": { "filter": [ { "var": "transactions" },
      { "and": [ { "==": [ { "var": "item.category" }, "Food" ] },
                 { ">=": [ { "toTime": [ { "var": "item.date" } ] }, { "startOf": ["month"] } ] } ] } ] }
  },
  "root": {
    "type": "card",
    "children": [
      { "type": "metric",
        "label": "Food this month",
        "value": { "format": [ { "sum": [ { "var": "foodThisMonth" }, "amount" ] }, "currency" ] } }
    ]
  }
}
```

### 2.1 Components

Every node is `{ "type": <name>, ...props }`. Any prop marked *expr* accepts
either a literal value or an expression (§3). `children` is an array of nodes.

| type        | props                                                                                   |
|-------------|-----------------------------------------------------------------------------------------|
| `card`      | `title?` (expr string), `children`                                                      |
| `column`    | `gap?` (number, px/dp/pt), `children`                                                   |
| `row`       | `gap?`, `align?` (`start`\|`center`\|`end`\|`spaceBetween`), `children`                 |
| `text`      | `value` (expr), `style?` (`title`\|`body`\|`caption`), `color?` (expr, see §2.2)        |
| `metric`    | `label` (expr), `value` (expr), `caption?` (expr), `color?` (expr)                      |
| `progress`  | `value` (expr number), `max?` (expr number, default 1), `label?` (expr)                 |
| `list`      | `items` (expr array), `template` (node), `empty?` (expr string), `limit?` (number ≤100) |
| `barChart`  | `items` (expr array of `{label, value}`), `max?` (expr number)                          |
| `badge`     | `value` (expr), `color?` (expr)                                                         |
| `divider`   | —                                                                                       |
| `visible`   | `when` (expr boolean), `children` — renders children only when `when` is truthy         |
| `input`     | `kind`, `bind`, `label?` (expr), `placeholder?` (expr), `min?`/`max?`/`step?` (number literals), `options?` (expr), `multiline?` (boolean) — see §2.4 |

Inside a `list` `template`, the scope gains `item` (current element) and
`index` (0-based).

### 2.2 Colors

Semantic tokens only, so widgets follow the host theme: `default`, `muted`,
`accent`, `positive`, `negative`, `warning`.

### 2.3 Limits (enforced by every SDK validator)

- at most **200** nodes, depth at most **12**
- at most **20** state entries; text values at most **1000** characters
- at most **50** bindings; bindings may reference earlier-declared bindings only
- each expression evaluation is capped at **100 000** steps; exceeding it is a runtime error rendered as an error placeholder, never a crash

### 2.4 State and inputs

A widget can take user input. It declares named values with literal initial values in `state`; each
`input` node names one of them in `bind`; formulas read the current value with `{"var": "state.<name>"}`
(in bindings and props alike). Every change re-evaluates the widget. State is local to one rendered
widget and is not persisted in v1.

```jsonc
"state": { "a": null, "b": null },
"root": { "type": "card", "children": [
  { "type": "input", "kind": "number", "bind": "a", "label": "First number" },
  { "type": "input", "kind": "number", "bind": "b", "label": "Second number" },
  { "type": "metric", "label": "Sum", "value": { "+": [ { "var": "state.a" }, { "var": "state.b" } ] } }
] }
```

| `kind`   | control (web / Android / iOS)                       | state value                      | props |
|----------|-----------------------------------------------------|----------------------------------|-------|
| `text`   | text field / OutlinedTextField / TextField          | string or `null`                 | `placeholder`, `multiline` |
| `number` | number field (decimal keyboard)                     | number, or `null` when empty or invalid | `placeholder`, `min`, `max`, `step` |
| `slider` | range / Slider / Slider                             | number, clamped to `min..max` and snapped to `step` | `min`, `max` (required), `step` |
| `toggle` | switch                                              | boolean                          | — |
| `select` | dropdown; first entry "—" means `null`              | the chosen option's `value`      | `options` (required) |
| `date`   | date picker                                         | `"YYYY-MM-DD"` or `null`         | — |

`options` is an expression yielding an array of strings/numbers or `{label, value}` objects, so options
can come from data (e.g. distinct categories via `group` + `pluck`).

Rules (validator): `bind` must name a declared state entry; the initial value must suit the kind (as in the
table; `slider` needs a number and `toggle` a boolean); props only for the kinds listed; `min <= max`,
`step > 0`; inputs may not appear inside `list` templates; `state` is reserved and cannot be a binding or
data source name.

Raw control values are converted identically on every platform (`coerce`): numbers accept a decimal comma
(`"1,5"` → 1.5) and are not clamped while typing; text is truncated to 1000 characters; dates keep the
`YYYY-MM-DD` prefix of a date-time. See `conformance/inputs.json`.

---

## 3. Expressions

JSON, JSONLogic-style: an expression is either a literal (`string`, `number`,
`boolean`, `null`, or an array of expressions) or a **single-key object** whose
key is an operator and whose value is the argument array (a single non-array
argument is treated as a one-element array).

Evaluation scope (lookup order): `item`/`index` (inside `filter`/`map`/`sort`/
`group`/list templates) → bindings → data sources.

| op | args | result |
|---|---|---|
| `var` | `path` (dot-separated, numeric segments index arrays), `default?` | value at path, or `default`/`null` |
| `+` `*` | n numbers | sum / product (`null` treated as 0 for `+`, result `null` for `*`) |
| `-` | a, b? | a − b, or −a |
| `/` | a, b | a ÷ b; `null` when b = 0 |
| `%` | a, b | remainder; `null` when b = 0 |
| `round` | x, digits? | round half away from zero |
| `==` `!=` | a, b | strict equality (numbers compared numerically; no type coercion) |
| `>` `>=` `<` `<=` | a, b | numeric or string comparison; `false` if either is `null`/mismatched |
| `and` `or` | n | short-circuit, returns boolean |
| `not` | a | boolean negation of truthiness |
| `if` | cond, then, else? | |
| `??` | a, b | a unless `null`, else b |
| `count` | list | length (`0` for non-list) |
| `sum` `avg` `min` `max` | list, field? | aggregate of numeric elements (or `item[field]`); `avg`/`min`/`max` of empty → `null`, `sum` → `0` |
| `filter` | list, predicate | elements for which predicate (with `item`) is truthy |
| `map` | list, expr | `expr` evaluated per `item` |
| `sort` | list, field?, `"asc"`\|`"desc"` | stable sort by `item[field]` (or by element) |
| `take` | list, n | first n elements |
| `first` `last` | list | element or `null` |
| `group` | list, keyExpr, valueExpr? | `[{ "key", "count", "sum" }]` in first-seen key order; `sum` sums `valueExpr` (0 if omitted) |
| `pluck` | list, field | `item[field]` for each element |
| `concat` | n | string concatenation (`null` → `""`, numbers via shortest round-trip) |
| `lower` `upper` | s | |
| `contains` | haystack, needle | substring (strings) or membership (lists) |
| `format` | value, kind, arg? | localized string; kind ∈ `number` (arg = fraction digits, default 0..2), `currency` (arg = ISO code, default manifest `theme.currency`), `percent` (value 0.25 → "25%"), `date`, `datetime`, `relative` |
| `now` | — | current time, epoch ms |
| `toTime` | value | ISO-8601 string or epoch ms → epoch ms; `null` if unparseable |
| `startOf` | unit, time? | epoch ms at start of `day`\|`week` (Monday)\|`month`\|`year`, device local time zone |
| `addDays` | time, n | epoch ms |
| `object` | k1, v1, k2, v2, … | builds an object (use in `map` to make `barChart` items) |

**Truthiness**: `false`, `null`, `0`, `""`, and `[]` are falsy; everything else truthy.

**Errors**: unknown operator or wrong arity is a *validation* error (caught
before render). Type mismatches at runtime yield `null`, never throw.

---

## 4. Conformance

`conformance/expressions.json` holds evaluation vectors
(`{ name, data, expr, expect }`), `conformance/validation.json` holds specs
that must be accepted or rejected, and `conformance/inputs.json` holds input
coercion and select-option vectors, and `conformance/views.json` holds view-tree vectors (§6). Every SDK runs them in its test suite;
`format`/`now`/`startOf` are locale/clock dependent and are excluded from the
shared vectors.

## 5. Versioning

`specVersion` increments only for breaking changes. SDKs must reject specs with
a higher version than they support (the generator is told the SDK's version in
the request).

## 6. Headless view tree

SDKs don't require any particular UI toolkit. Their core evaluates a widget (spec + data snapshot +
input state) into a **view tree** of plain, display-ready nodes, and the host renders it with whatever
components it likes. The DOM, Compose and SwiftUI renderers shipped with Graft are optional adapters
over this tree. Every SDK produces the same tree for the same input (`conformance/views.json`).

Every node has `type` and `key` (its path in the spec, e.g. `root.0.1`, stable across recomputes:
use it as the component key). Values are already evaluated and formatted:

| type | fields |
|---|---|
| `card` | `title` (string or null), `children` |
| `column` | `gap` (number or null), `children` |
| `row` | `gap`, `align` (`start` default), `children` |
| `text` | `text`, `style` (`body` default), `color` (token, `default` if invalid) |
| `metric` | `label`, `value`, `caption` (null when empty), `color` |
| `progress` | `label` (or null), `value` (0 default), `max` (1 default), `fraction` (0..1) |
| `list` | `items` (the template resolved per element, up to `limit`), `empty` (text when there are no elements, else null) |
| `barChart` | `bars`: `[{ label, value, fraction }]` |
| `badge` | `text`, `color` |
| `divider` | — |
| `input` | `kind`, `name` (state entry), `label`, `placeholder`, `min`, `max`, `step` (null when unset), `multiline`, `options` (`[{label, value}]`, select only), `value` (**getter**), and `set(raw)` (**setter**) |

`visible` produces no node: when its condition holds, its children are spliced into the parent;
otherwise they are dropped. A root that expands to several nodes is wrapped in a `column` keyed `root`.

Display text: `null` → `""`, numbers in shortest form (`2`, `2.5`), other values as JSON.

An input's `set(raw)` takes the raw value from any control (a string from a text field, a number from a
slider, a boolean from a switch, an option's `value`), coerces it (§2.4), updates the widget's state and
recomputes the tree. A **widget controller** owns that state, accepts new data snapshots and notifies
subscribers with each new tree; this is the hook a UI layer connects to.

## 7. Reserved: general code (future)

The formula language stays the default because it is safe and acceptable to the app stores. A future
version will add an opt-in construct for running general code, for apps where that is acceptable
(web apps, internal or enterprise apps not distributed through public stores). Design constraints:

- **Off unless the host enables it.** The developer grants it in the manifest, for example
  `"policy": { "code": { "allowed": true, "runtime": "sandboxed-js", "timeoutMs": 50, "capabilities": [] } }`.
  Generators must not emit code when the manifest doesn't allow it, and validators reject it.
- **Sandboxed and capability-limited.** Code runs in an isolated runtime (a sandboxed iframe or Worker on the
  web, an embedded JS engine on mobile) with no network, storage or DOM access unless the policy grants a
  named capability. It receives the same scope as formulas (data sources, bindings, `state`) and returns JSON.
- **Pure value.** It plugs in where an expression goes, e.g. `{ "code": { "source": "...", "inputs": [...] } }`,
  so rendering, validation and limits stay as they are.
- **The names `code` and `policy` are reserved** for this and must not be used for operators, components,
  bindings or manifest fields.

