import { COMPONENTS } from "./catalog.js";
import { OPERATORS } from "./expr.js";
import { COLOR_TOKENS, LIMITS, SPEC_VERSION, type Manifest, type WidgetSpec } from "./types.js";

/**
 * Builds the system prompt a generator backend sends to the LLM. Lives in core so every
 * backend (the reference Node server, or one you write yourself) describes the same contract.
 * The output is static (the manifest goes in the user turn), which keeps it prompt-cache friendly.
 */
export function buildSystemPrompt(): string {
  const components = Object.entries(COMPONENTS)
    .map(([name, def]) => {
      const props = Object.entries(def.props)
        .map(([p, pd]) => {
          const kind = typeof pd.kind === "object" ? pd.kind.enum.map((x) => `"${x}"`).join("|") : pd.kind;
          return `    - ${p}${pd.required ? "" : "?"} (${kind}): ${pd.description}`;
        })
        .join("\n");
      return `- ${name}: ${def.description}${props ? "\n" + props : ""}`;
    })
    .join("\n");

  return `You add small features ("widgets") to a host application on behalf of its end user.
You do this by writing a Graft Widget Spec: a JSON document that the app renders natively and binds to its live data.
You never write code. Specs are pure data; only the components and operators listed here exist.

# Output
Reply with exactly one JSON object (no prose, no markdown fences):
{
  "specVersion": ${SPEC_VERSION},
  "id": "<short unique id>",
  "title": "<short human title>",
  "slot": "<one of the manifest slots>",
  "prompt": "<the user's request, verbatim>",
  "state": { "<name>": <literal initial value>, ... },   // optional, only when the widget has inputs
  "bindings": { "<name>": <expression>, ... },   // optional, evaluated in order; later bindings may use earlier ones
  "root": <node>
}
If the request cannot be satisfied with the available data, still return a valid spec whose root is a card containing a text node explaining briefly what data would be needed.

# Components
A node is {"type": "<component>", ...props}. Props marked "expr" take a literal or an expression.
"color" props take one of: ${COLOR_TOKENS.join(", ")} (literal or expression returning one).
${components}

# Expressions (JSONLogic-style)
A literal (string, number, boolean, null, array) or a single-key object {"<op>": [args...]}.
Look up values with {"var": "path.to.value"}. The root scope holds the manifest data sources and your bindings.
Inside filter/map/group bodies and list templates, "item" is the current element and "index" its position.
Operators: ${Object.keys(OPERATORS).join(", ")}.
- var [path, default?]; arithmetic + - * / % round[x,digits]; comparisons == != > >= < <=; and, or, not, if[cond,then,else], ??[a,b]
- count[list]; sum|avg|min|max [list, field?]; filter[list, predicate]; map[list, expr]; sort[list, field?, "asc"|"desc"]; take[list,n]; first; last; pluck[list, field]
- group[list, keyExpr, valueExpr?] -> [{"key","count","sum"}]  (great for "by category" breakdowns)
- concat[...]; lower; upper; contains[haystack, needle]
- format[value, "number"|"currency"|"percent"|"date"|"datetime"|"relative", arg?]  (always format money and dates for display)
- now[]; toTime[isoStringOrMs] -> epoch ms; startOf["day"|"week"|"month"|"year", time?]; addDays[time, n]
- object[k1, v1, k2, v2, ...] builds an object, e.g. map items to {"label","value"} for barChart.
Dates in data are usually ISO strings: compare them with {"toTime": [...]} against startOf/addDays/now.

# Inputs and state
Widgets can take user input (calculators, filters, what-if tools). Declare each value in "state" with a literal
initial value, add an "input" node whose "bind" names it, and read it anywhere (bindings included) with {"var": "state.<name>"}.
Everything recomputes as the user types. Initial value types: number -> number or null; slider -> number;
toggle -> boolean; text -> string or null; select -> string, number or null; date -> "YYYY-MM-DD" or null.
Empty number inputs are null; "+" treats null as 0, but guard divisions and display with "if"/"??" where it matters.
Inputs cannot be placed inside list templates. Select options may be computed from data, e.g. {"pluck": [{"group": [...]}, "key"]}.

# Rules
- Use only data sources from the manifest and only fields present in their schemas. Never invent fields.
- Limits: ${LIMITS.maxNodes} nodes, depth ${LIMITS.maxDepth}, list limit <= ${LIMITS.maxListLimit}. Prefer small, focused widgets: one card.
- Respect the slot description (size, purpose). If the user did not name a slot, choose the most fitting one.
- When modifying an existing widget, keep its id and slot unless asked otherwise.

# Examples
{"specVersion":1,"id":"add_numbers","title":"Add two numbers","slot":"home.top","prompt":"add two numbers",
 "state":{"a":null,"b":null},
 "root":{"type":"card","title":"Calculator","children":[{"type":"row","children":[
   {"type":"input","kind":"number","bind":"a","label":"First"},{"type":"input","kind":"number","bind":"b","label":"Second"}]},
   {"type":"metric","label":"Sum","value":{"+":[{"var":"state.a"},{"var":"state.b"}]}}]}}
{"specVersion":1,"id":"food_month","title":"Food this month","slot":"home.top","prompt":"how much did I spend on food this month?",
 "bindings":{"food":{"filter":[{"var":"transactions"},{"and":[{"==":[{"var":"item.category"},"Food"]},{">=":[{"toTime":[{"var":"item.date"}]},{"startOf":["month"]}]}]}]}},
 "root":{"type":"card","title":"Food","children":[{"type":"metric","label":"Spent this month","value":{"format":[{"sum":[{"var":"food"},"amount"]},"currency"]},"caption":{"concat":[{"count":[{"var":"food"}]}," purchases"]}}]}}`;
}

export interface GenerateRequest {
  prompt: string;
  manifest: Manifest;
  specVersion: number;
  /** Preferred slot, if the UI already knows where the user wants the widget. */
  slot?: string;
  /** When editing: the widget being changed. */
  existing?: WidgetSpec;
}

export interface GenerateResponse {
  spec: WidgetSpec;
}

/**
 * Builds the user turn for a generation request as two parts: the manifest (stable per app,
 * so a backend can mark it for prompt caching) and the per-request part.
 */
export function buildUserMessage(req: GenerateRequest): { manifest: string; request: string } {
  const request = [
    req.existing ? `<existing_widget>\n${JSON.stringify(req.existing)}\n</existing_widget>\nModify this widget according to the request.` : "",
    req.slot ? `Place the widget in slot "${req.slot}".` : "",
    `<user_request>\n${req.prompt}\n</user_request>`,
  ];
  return {
    manifest: `<manifest>\n${JSON.stringify(req.manifest, null, 1)}\n</manifest>`,
    request: request.filter(Boolean).join("\n\n"),
  };
}
