# Graft

**Let your users vibe-code features into your app.** Graft is a library for web, Android and iOS. Your
users describe what they want ("show how much I spent on food this month compared to my budget"), an LLM
designs a widget, they preview it, and it shows up in your app, bound to live app data and rendered
with native components.

It works like Lovable, but it lives *inside* your product: you add it as a library, and your end users do the prompting.

```
 ┌────────────── your app ───────────────┐          ┌──────── your backend ────────┐
 │                                       │  prompt  │                              │
 │  graft.addDataSource("transactions")──┼─manifest─▶  POST /v1/generate           │
 │  graft.addSlot("home.top")            │ (schemas)│   Claude → Widget Spec JSON  │
 │                                       │          │   validate → repair loop     │
 │  <GraftSlot "home.top">  ◀── spec ────┼──────────┤                              │
 │    native renderer + live data        │          └──────────────────────────────┘
 └───────────────────────────────────────┘
```

## How it works

1. **The developer exposes data.** You register *data sources*. Each one has a description, a schema and a live getter.
   Only the schema and an optional, developer-curated `sample` are sent to the LLM. Live data never leaves the device.
2. **The developer declares slots.** A slot is a named place in your UI where widgets may appear (`home.top`,
   `orderDetail.sidebar`, …). Graft never modifies the rest of your UI. It renders only inside slots you placed.
3. **The user asks for a feature.** The built-in "vibe" panel or sheet sends the prompt and the manifest to your generator
   backend. The backend asks Claude for a **Widget Spec**, which is a JSON document built from a small component catalog
   (card, metric, list, barChart, progress, …) and a JSONLogic-style expression language (`filter`, `group`, `sum`,
   `format`, `startOf`, …).
4. **Validate, preview, accept.** The spec is validated on the server, where errors go back to Claude for repair, and again
   on the device. The user sees a live preview, refines it ("make it weekly instead") and adds it. Accepted widgets are
   persisted, and they re-render whenever your data changes.

### Why specs instead of generated code?

- **Safe by construction.** A spec can only show data you exposed, using components you ship. It can't make network calls,
  read storage, inject HTML or run code. Text is always set as text.
- **App-store friendly.** iOS and Android forbid downloading executable code. Specs are data, so they render natively.
- **One generator, three platforms.** The same spec renders on web (DOM), Android (Jetpack Compose) and iOS (SwiftUI).
- **Bounded.** Node count, depth, list sizes and an evaluation step budget are all capped, so a bad spec can't freeze the app.

The full contract is in [`spec/README.md`](spec/README.md). Shared conformance vectors in
[`spec/conformance/`](spec/conformance) are run by every SDK's test suite, so all platforms evaluate expressions the same way.

## Repository layout

| Path | What | Status |
|---|---|---|
| [`spec/`](spec) | Normative widget spec, expression language, conformance vectors | v1 |
| [`packages/core`](packages/core) | `@graft/core` (TypeScript): types, expression engine, validator, system prompt, `Graft` engine | tested |
| [`packages/web`](packages/web) | `@graft/web`: DOM renderer, `mountSlot`, vibe panel, `LocalStorageStore` | tested (unit + browser e2e) |
| [`server/`](server) | Reference generator backend (Node + Claude API) with validate → repair loop | tested with a mocked client |
| [`examples/web-demo`](examples/web-demo) | "Budgetly" expense tracker showing an integration | runs with an offline mock or Claude |
| [`android/`](android) | `graft-core` (pure Kotlin, tested on JVM) and `graft-compose` (Compose UI) | core tested; Compose built in CI |
| [`ios/`](ios) | Swift package: `GraftCore` and `GraftUI` (SwiftUI) | built and tested in CI (macOS) |

## Quick start (web)

```ts
import { Graft, HttpGenerator, LocalStorageStore, mountSlot, mountVibeButton } from "@graft/web";

const graft = new Graft({
  app: { name: "Budgetly", description: "Personal expense tracker" },
  generator: new HttpGenerator("/v1/generate"),       // your backend, see server/
  store: new LocalStorageStore(),                     // or your own per-user store
  theme: { currency: "EUR", locale: "sv-SE" },
});

graft.addDataSource("transactions", {
  description: "The user's card transactions, newest first",
  schema: { type: "array", items: { type: "object", properties: {
    amount: { type: "number" }, category: { type: "string" }, date: { type: "string", format: "date-time" } } } },
  sample: [{ amount: 12.5, category: "Food", date: "2026-10-01T12:00:00Z" }],
  get: () => store.transactions,
  subscribe: (onChange) => store.subscribe(onChange),  // widgets re-render on change
});

graft.addSlot("home.top", { description: "Home screen, under the balance. Full width.", maxWidgets: 3 });
await graft.init();

mountSlot(graft, document.querySelector("#home-top")!, "home.top");
mountVibeButton(graft);                                // floating "✨ Add feature" button
```

Headless use works too: `await graft.propose(prompt)` returns a validated spec, `graft.accept(spec)` persists it, and
`renderWidget(graft.bind(spec, data))` returns a DOM element.

Theme with CSS custom properties: `:root { --graft-accent: #0f766e; --graft-radius: 16px; }`.

## Run the demo

```bash
npm install
npm run build
npm test                               # core + web + server

# Offline (canned "mock" generator, no API key needed):
node server/dist/index.js              # then open http://localhost:8787/?mock

# With Claude:
ANTHROPIC_API_KEY=sk-ant-... node server/dist/index.js   # open http://localhost:8787/
```

In the demo, try "how much budget do I have left?", "spend by category", "my biggest purchases" or "food this month".
Then add a transaction and watch the widgets update.

## The generator backend

[`server/`](server) is a small reference implementation. You can deploy it as is, or call `createClaudeGenerator()` from your
existing backend:

- uses Claude Opus 5.5 (`claude-opus-5-5`) with adaptive thinking and streaming; effort is configurable
- caches the system prompt and the per-app manifest with prompt caching, so repeated requests are cheap
- validates every reply with the same validator the SDKs use, and feeds errors back for up to 2 repair rounds
- opts into server-side refusal fallbacks (`fallbacks: "default"`)
- `authorize` hook for auth and rate limiting. **Put the endpoint behind your own user auth** so it can't be used as an open LLM proxy.

Never ship an API key inside a mobile or web client. The SDKs only ever talk to your backend.

## Mobile

- **Android**: see [`android/README.md`](android/README.md). `GraftSlot(graft, "home.top")` and `VibeButton(graft)` are composables.
- **iOS**: see [`ios/README.md`](ios/README.md). Use `GraftSlotView(graft:slot:)` and `VibeButton(graft:)` in SwiftUI.

The core is reimplemented natively on each platform (about 500 lines each), not embedded through a JS engine. That keeps
the SDKs small and dependency-free. The shared conformance vectors keep the three implementations in agreement.

## Roadmap ideas

- **Actions**: host-registered actions (navigate, open a record, call an API with confirmation) that buttons in specs can trigger
- **Parameters**: widgets with user inputs (date range picker, category filter)
- More components (line chart, table, image from allow-listed URLs), and host-provided custom components
- Sharing and moderation: let admins publish a user's widget to everyone, with a review queue
- React, Vue and Flutter wrappers
- Server-side eval set of prompts → specs to tune the system prompt
