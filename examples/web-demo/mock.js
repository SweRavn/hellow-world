// Offline stand-in for the Claude generator so the demo runs without an API key.
// It only understands a few phrasings; the real generator handles arbitrary requests.
const v = (path) => ({ var: path });
const thisMonth = { filter: [v("transactions"), { ">=": [{ toTime: [v("item.date")] }, { startOf: ["month"] }] }] };

const recipes = [
  {
    match: /categor|breakdown|where.*money/i,
    spec: {
      title: "Spend by category",
      slot: "home.bottom",
      bindings: {
        month: thisMonth,
        groups: { sort: [{ group: [v("month"), v("item.category"), v("item.amount")] }, "sum", "desc"] },
      },
      root: {
        type: "card", title: "This month by category",
        children: [{ type: "barChart", items: { map: [v("groups"), { object: ["label", v("item.key"), "value", { round: [v("item.sum")] }] }] } }],
      },
    },
  },
  {
    match: /budget|left|remaining/i,
    spec: {
      title: "Budget left",
      slot: "home.top",
      bindings: { spent: { sum: [thisMonth, "amount"] }, left: { "-": [v("profile.monthlyBudget"), v("spent")] } },
      root: {
        type: "card", title: "Budget",
        children: [
          { type: "metric", label: "Left to spend this month", value: { format: [v("left"), "currency"] },
            color: { if: [{ "<": [v("left"), 0] }, "negative", "positive"] },
            caption: { concat: [{ format: [{ "/": [v("spent"), v("profile.monthlyBudget")] }, "percent"] }, " of budget used"] } },
          { type: "progress", value: v("spent"), max: v("profile.monthlyBudget") },
        ],
      },
    },
  },
  {
    match: /biggest|largest|top|expensive/i,
    spec: {
      title: "Biggest purchases",
      slot: "home.bottom",
      root: {
        type: "card", title: "Biggest purchases this month",
        children: [{
          type: "list", items: { take: [{ sort: [thisMonth, "amount", "desc"] }, 3] },
          template: { type: "row", align: "spaceBetween", children: [
            { type: "column", gap: 0, children: [
              { type: "text", value: v("item.merchant") },
              { type: "text", style: "caption", color: "muted", value: { concat: [v("item.category"), " · ", { format: [v("item.date"), "relative"] }] } },
            ] },
            { type: "text", value: { format: [v("item.amount"), "currency"] } },
          ] },
        }],
      },
    },
  },
  {
    match: /food|groceries|eat/i,
    spec: {
      title: "Food this month",
      slot: "home.top",
      bindings: { food: { filter: [thisMonth, { "==": [v("item.category"), "Food"] }] } },
      root: {
        type: "card", title: "Food",
        children: [{ type: "row", align: "spaceBetween", children: [
          { type: "metric", label: "Spent on food this month", value: { format: [{ sum: [v("food"), "amount"] }, "currency"] },
            caption: { concat: [{ count: [v("food")] }, " purchases"] } },
          { type: "badge", value: { concat: ["avg ", { format: [{ avg: [v("food"), "amount"] }, "currency"] }] }, color: "accent" },
        ] }],
      },
    },
  },
];

export class MockGenerator {
  async generate(req) {
    await new Promise((r) => setTimeout(r, 600));
    const recipe = recipes.find((r) => r.match.test(req.prompt));
    const spec = recipe
      ? structuredClone(recipe.spec)
      : {
          title: "Not understood",
          slot: "home.top",
          root: { type: "card", title: "Mock generator", children: [{ type: "text", value: "The offline mock only knows: food, budget, categories, biggest purchases. Run the server with an API key for anything else." }] },
        };
    return {
      specVersion: 1,
      id: `mock_${Date.now().toString(36)}`,
      prompt: req.prompt,
      ...spec,
      slot: req.slot ?? req.existing?.slot ?? spec.slot,
    };
  }
}
