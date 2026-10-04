# Graft reference generator

`POST /v1/generate` with `{ prompt, manifest, specVersion, slot?, existing? }` returns `{ spec }`, or
`{ error, details? }` with HTTP 4xx/5xx.

```bash
npm run build && ANTHROPIC_API_KEY=... node server/dist/index.js
```

| env | default | |
|---|---|---|
| `PORT` | `8787` | |
| `GRAFT_MODEL` | `claude-opus-5-5` | |
| `GRAFT_CORS_ORIGIN` | unset (same-origin only) | e.g. `https://app.example.com` |
| `GRAFT_SERVE_DEMO` | `1` | serves `examples/web-demo` at `/`; set `0` in production |

To embed it in your own backend:

```ts
import { createClaudeGenerator } from "@graft/server";
const generate = createClaudeGenerator({ effort: "low" });   // faster; "medium" is the default
app.post("/v1/generate", requireUser, rateLimit, async (req, res) => res.json(await generate(req.body)));
```

Add authentication and per-user rate limits before exposing this endpoint. Each request is a paid Claude API call.
