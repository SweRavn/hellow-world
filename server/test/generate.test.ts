import { describe, expect, it } from "vitest";
import type { Manifest } from "@graft/core";
import { createClaudeGenerator, createGraftServer, extractJson, GenerationError } from "../src/index.js";

const manifest: Manifest = {
  app: { name: "T" },
  dataSources: { tx: { description: "tx", schema: { type: "array" } } },
  slots: { "home.top": { description: "top" } },
};
const good = { specVersion: 1, id: "a", title: "A", slot: "home.top", root: { type: "text", value: { count: [{ var: "tx" }] } } };
const bad = { ...good, root: { type: "text", value: { var: "orders" } } };

function fakeClient(replies: { text: string; stop_reason?: string }[]) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: any) {
          calls.push(structuredClone(params));
          const r = replies.shift()!;
          return {
            finalMessage: async () => ({
              stop_reason: r.stop_reason ?? "end_turn",
              content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: r.text }],
            }),
          };
        },
      },
    },
  };
  return { client: client as any, calls };
}

describe("claude generator", () => {
  it("returns a validated spec and caches system + manifest", async () => {
    const { client, calls } = fakeClient([{ text: "```json\n" + JSON.stringify(good) + "\n```" }]);
    const out = await createClaudeGenerator({ client })({ prompt: "count tx", manifest, specVersion: 1 });
    expect(out.spec.prompt).toBe("count tx");
    expect(out.attempts).toBe(1);
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].thinking).toEqual({ type: "adaptive" });
    expect(calls[0].system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(calls[0].messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(calls[0].messages[0].content[1].text).toContain("count tx");
  });

  it("feeds validation errors back append-only and repairs", async () => {
    const { client, calls } = fakeClient([{ text: JSON.stringify(bad) }, { text: JSON.stringify(good) }]);
    const out = await createClaudeGenerator({ client })({ prompt: "x", manifest, specVersion: 1 });
    expect(out.attempts).toBe(2);
    const msgs = calls[1].messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual(calls[0].messages[0]); // history unchanged
    expect(msgs[1].content[0].type).toBe("thinking"); // full assistant content kept
    expect(msgs[2].content).toContain('unknown variable "orders"');
  });

  it("gives up after maxRepairs with details", async () => {
    const { client } = fakeClient([{ text: "nope" }, { text: JSON.stringify(bad) }]);
    const p = createClaudeGenerator({ client, maxRepairs: 1 })({ prompt: "x", manifest, specVersion: 1 });
    await expect(p).rejects.toMatchObject({ status: 422, details: [expect.stringContaining("orders")] });
  });

  it("surfaces refusals", async () => {
    const { client } = fakeClient([{ text: "", stop_reason: "refusal" }]);
    await expect(createClaudeGenerator({ client })({ prompt: "x", manifest, specVersion: 1 })).rejects.toBeInstanceOf(GenerationError);
  });

  it("extractJson tolerates prose", () => {
    expect(extractJson('Sure! {"a": {"b": 1}} done')).toEqual({ a: { b: 1 } });
  });
});

describe("http server", () => {
  it("serves POST /v1/generate", async () => {
    const server = createGraftServer({ generate: async (req) => ({ spec: { ...good, prompt: req.prompt } as any, attempts: 1 }) });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    try {
      const ok = await fetch(`http://localhost:${port}/v1/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: "hi", manifest, specVersion: 1 }),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).spec.prompt).toBe("hi");
      const badReq = await fetch(`http://localhost:${port}/v1/generate`, { method: "POST", body: "{}" });
      expect(badReq.status).toBe(400);
      const notFound = await fetch(`http://localhost:${port}/../../etc/passwd`);
      expect(notFound.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
