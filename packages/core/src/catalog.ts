/**
 * Component catalog: the only UI building blocks a generated widget may use.
 * Every platform renderer implements exactly these. Keep in sync with spec/README.md §2.1.
 */
export type PropKind =
  | "expr" // literal or expression
  | "color" // color token literal or expression yielding one
  | "number" // literal number
  | "node" // a single child node
  | "children" // array of nodes
  | { enum: readonly string[] };

export interface PropDef {
  kind: PropKind;
  required?: boolean;
  /** For "node" props: the node is rendered with `item`/`index` in scope. */
  iterates?: boolean;
  description: string;
}

export interface ComponentDef {
  description: string;
  props: Record<string, PropDef>;
}

const children: PropDef = { kind: "children", description: "Child nodes" };
const color: PropDef = { kind: "color", description: "Semantic color token" };

export const COMPONENTS: Record<string, ComponentDef> = {
  card: {
    description: "Surface with padding and optional title; use as the outermost container.",
    props: { title: { kind: "expr", description: "Card heading" }, children },
  },
  column: {
    description: "Vertical stack.",
    props: { gap: { kind: "number", description: "Spacing between children" }, children },
  },
  row: {
    description: "Horizontal stack.",
    props: {
      gap: { kind: "number", description: "Spacing between children" },
      align: { kind: { enum: ["start", "center", "end", "spaceBetween"] }, description: "Main-axis alignment" },
      children,
    },
  },
  text: {
    description: "A line or paragraph of text.",
    props: {
      value: { kind: "expr", required: true, description: "Text to show" },
      style: { kind: { enum: ["title", "body", "caption"] }, description: "Typography" },
      color,
    },
  },
  metric: {
    description: "A big number with a label, e.g. a KPI.",
    props: {
      label: { kind: "expr", required: true, description: "What the number means" },
      value: { kind: "expr", required: true, description: "The number, usually formatted" },
      caption: { kind: "expr", description: "Small text under the value" },
      color,
    },
  },
  progress: {
    description: "Horizontal progress bar.",
    props: {
      value: { kind: "expr", required: true, description: "Current amount" },
      max: { kind: "expr", description: "Full amount (default 1)" },
      label: { kind: "expr", description: "Label shown above the bar" },
    },
  },
  list: {
    description: "Repeats `template` for each element of `items`.",
    props: {
      items: { kind: "expr", required: true, description: "Array to iterate" },
      template: { kind: "node", required: true, iterates: true, description: "Node rendered per item; `item` and `index` in scope" },
      empty: { kind: "expr", description: "Text when the list is empty" },
      limit: { kind: "number", description: "Max rows (<= 100)" },
    },
  },
  barChart: {
    description: "Horizontal bar chart.",
    props: {
      items: { kind: "expr", required: true, description: "Array of {label, value}" },
      max: { kind: "expr", description: "Value that fills a bar (default: largest value)" },
    },
  },
  badge: {
    description: "Small pill label.",
    props: { value: { kind: "expr", required: true, description: "Label" }, color },
  },
  divider: { description: "Thin separator line.", props: {} },
  visible: {
    description: "Renders children only when `when` is truthy.",
    props: { when: { kind: "expr", required: true, description: "Condition" }, children },
  },
};
