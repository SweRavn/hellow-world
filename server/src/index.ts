import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { GenerateRequest } from "@graft/core";
import { createClaudeGenerator, GenerationError } from "./generate.js";

export { createClaudeGenerator, GenerationError, extractJson } from "./generate.js";

const MAX_BODY = 512 * 1024;

export interface ServerOptions {
  generate: ReturnType<typeof createClaudeGenerator>;
  /** Allowed CORS origin(s). Default: none (same-origin only). */
  corsOrigin?: string;
  /**
   * Authenticate/rate-limit here. Return false to reject. In production, tie requests to your
   * own user sessions so the endpoint can't be used as a free LLM proxy.
   */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /** Serve the demo app and the web bundle at / (development only). */
  serveDemo?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new GenerationError("request too large", 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

function isGenerateRequest(v: unknown): v is GenerateRequest {
  const r = v as GenerateRequest;
  return !!r && typeof r.prompt === "string" && r.prompt.length > 0 && r.prompt.length <= 2000 &&
    typeof r.specVersion === "number" && !!r.manifest && typeof r.manifest === "object" &&
    typeof r.manifest.dataSources === "object" && typeof r.manifest.slots === "object";
}

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const STATIC: Record<string, string> = {
  "/graft.bundle.js": join(root, "packages/web/dist/graft.bundle.js"),
};
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const demoDir = join(root, "examples/web-demo");
  const file = STATIC[path] ?? join(demoDir, normalize(path === "/" ? "/index.html" : path));
  if (!file.startsWith(demoDir + sep) && !Object.values(STATIC).includes(file)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function createGraftServer(opts: ServerOptions) {
  return createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (opts.corsOrigin) {
      res.setHeader("access-control-allow-origin", opts.corsOrigin);
      res.setHeader("access-control-allow-headers", "content-type, authorization");
      res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") return void res.writeHead(204).end();
      if (req.method === "POST" && url.pathname === "/v1/generate") {
        if (opts.authorize && !(await opts.authorize(req))) return json(401, { error: "unauthorized" });
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          if (e instanceof GenerationError) throw e;
          return json(400, { error: "invalid JSON body" });
        }
        if (!isGenerateRequest(body)) return json(400, { error: "expected { prompt, manifest, specVersion }" });
        const started = Date.now();
        const { spec, attempts } = await opts.generate(body);
        console.log(`[graft] generated "${spec.title}" in ${Date.now() - started}ms (${attempts} attempt${attempts > 1 ? "s" : ""})`);
        return json(200, { spec });
      }
      if (req.method === "GET" && opts.serveDemo && (await serveStatic(url.pathname, res))) return;
      json(404, { error: "not found" });
    } catch (e) {
      if (e instanceof GenerationError) return json(e.status, { error: e.message, details: e.details });
      if (e instanceof Anthropic.RateLimitError) return json(429, { error: "busy, try again shortly" });
      if (e instanceof Anthropic.APIError) {
        console.error("[graft] Claude API error", e.status, e.message);
        return json(502, { error: "generator unavailable" });
      }
      console.error("[graft]", e);
      json(500, { error: "internal error" });
    }
  });
}

// Run directly: `node server/dist/index.js`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createGraftServer({
    generate: createClaudeGenerator({ ...(process.env.GRAFT_MODEL && { model: process.env.GRAFT_MODEL }) }),
    serveDemo: process.env.GRAFT_SERVE_DEMO !== "0",
    ...(process.env.GRAFT_CORS_ORIGIN && { corsOrigin: process.env.GRAFT_CORS_ORIGIN }),
  }).listen(port, () => console.log(`[graft] generator on http://localhost:${port}  (demo at /, API at POST /v1/generate)`));
}
