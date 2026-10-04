// Budgetly: a tiny host app showing how to add Graft to an existing web app.
import { Graft, HttpGenerator, LocalStorageStore, mountSlot, mountVibeButton } from "/graft.bundle.js";
import { MockGenerator } from "./mock.js";

// ---- The host app's own state (would be your Redux store, API cache, etc.) ----
const day = 86_400_000;
const now = Date.now();
let transactions = [
  { merchant: "Cafe Nero", amount: 4.5, category: "Food", date: new Date(now - 0.2 * day).toISOString() },
  { merchant: "SL Access", amount: 39, category: "Transport", date: new Date(now - 1 * day).toISOString() },
  { merchant: "ICA Maxi", amount: 62.3, category: "Food", date: new Date(now - 2 * day).toISOString() },
  { merchant: "H&M", amount: 45, category: "Shopping", date: new Date(now - 4 * day).toISOString() },
  { merchant: "Cinema", amount: 16, category: "Fun", date: new Date(now - 6 * day).toISOString() },
  { merchant: "Landlord", amount: 850, category: "Rent", date: new Date(now - 9 * day).toISOString() },
  { merchant: "Max Burgers", amount: 11.9, category: "Food", date: new Date(now - 12 * day).toISOString() },
  { merchant: "Uber", amount: 23.4, category: "Transport", date: new Date(now - 35 * day).toISOString() },
  { merchant: "Coop", amount: 48.2, category: "Food", date: new Date(now - 40 * day).toISOString() },
];
const profile = { name: "Ada", monthlyBudget: 1500, currency: "EUR" };
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

// ---- 1. Create Graft and pick a generator ----
const useMock = new URLSearchParams(location.search).has("mock");
document.getElementById("mode").textContent = useMock ? "Offline mock generator" : "Claude generator";
const graft = new Graft({
  app: { name: "Budgetly", description: "Personal expense tracker" },
  generator: useMock ? new MockGenerator() : new HttpGenerator("/v1/generate"),
  store: new LocalStorageStore("budgetly.widgets"),
  theme: { currency: profile.currency, locale: "en-GB" },
});

// ---- 2. Expose app data (schema + live getter + change subscription) ----
graft.addDataSource("transactions", {
  description: "The user's card transactions, newest first. amount is positive spend in the account currency.",
  schema: {
    type: "array",
    items: {
      type: "object",
      properties: {
        merchant: { type: "string" },
        amount: { type: "number", description: "Spend in EUR" },
        category: { type: "string", enum: ["Food", "Transport", "Shopping", "Rent", "Fun"] },
        date: { type: "string", format: "date-time" },
      },
    },
  },
  sample: transactions.slice(0, 2), // what the LLM sees; keep it small / anonymised
  get: () => transactions,
  subscribe: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
});
graft.addDataSource("profile", {
  description: "The signed-in user's profile and settings",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      monthlyBudget: { type: "number", description: "Monthly spending budget in EUR" },
      currency: { type: "string" },
    },
  },
  get: () => profile,
});

// ---- 3. Declare where widgets may go, and mount those slots ----
graft.addSlot("home.top", { description: "Home screen, under the monthly spend summary. Full width, prominent.", maxWidgets: 3 });
graft.addSlot("home.bottom", { description: "Home screen, below the transaction list. Good for detailed lists and breakdowns." });
await graft.init();
mountSlot(graft, document.getElementById("slot-home-top"), "home.top");
mountSlot(graft, document.getElementById("slot-home-bottom"), "home.bottom");

// ---- 4. Give users a way in ----
mountVibeButton(graft, { slotLabels: { "home.top": "Top of home", "home.bottom": "Bottom of home" } });

// ---- The host app's own UI ----
const fmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
function renderApp() {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const spent = transactions.filter((t) => Date.parse(t.date) >= monthStart).reduce((s, t) => s + t.amount, 0);
  document.getElementById("spent").textContent = fmt.format(spent);
  document.getElementById("budget").textContent = fmt.format(profile.monthlyBudget);
  const table = document.getElementById("tx");
  table.replaceChildren(...transactions.slice(0, 8).map((t) => {
    const tr = document.createElement("tr");
    for (const [text, cls] of [[t.merchant], [t.category, "muted"], [fmt.format(t.amount), "amt"]]) {
      const td = document.createElement("td");
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    return tr;
  }));
}
document.getElementById("add").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  transactions = [{ merchant: f.get("merchant"), amount: Number(f.get("amount")), category: f.get("category"), date: new Date().toISOString() }, ...transactions];
  e.target.reset();
  renderApp();
  notify(); // Graft widgets re-render with the new data
});
renderApp();
