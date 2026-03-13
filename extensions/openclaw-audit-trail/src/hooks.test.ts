import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AuditWriter } from "agent-audit-trail";
import type { AuditEvent, AuditTrailConfig } from "agent-audit-trail";
import { registerHooks } from "./hooks.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hooks-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<AuditTrailConfig> = {}): AuditTrailConfig {
  return {
    logDir: tmpDir,
    captureMode: "metadata_only",
    rotation: { strategy: "daily" },
    redaction: { mode: "hash", fields: [] },
    captureBeforeToolCall: false,
    ...overrides,
  };
}

type HookHandler = (...args: unknown[]) => unknown;

function makeApi() {
  const handlers: Map<string, HookHandler> = new Map();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    on(hookName: string, handler: HookHandler) {
      handlers.set(hookName, handler);
    },
    fire(hookName: string, event: unknown, ctx: unknown = {}) {
      const h = handlers.get(hookName);
      if (h) {
        return h(event, ctx);
      }
    },
    isRegistered(hookName: string) {
      return handlers.has(hookName);
    },
    logger,
  };
}

async function readEvents(dir: string): Promise<AuditEvent[]> {
  const all: AuditEvent[] = [];
  async function recurse(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) await recurse(fp);
      else if (e.name.endsWith(".jsonl") && e.name !== "index.jsonl") {
        const content = await fs.readFile(fp, "utf8");
        for (const line of content.trimEnd().split("\n").filter(Boolean)) {
          all.push(JSON.parse(line) as AuditEvent);
        }
      }
    }
  }
  try { await recurse(dir); } catch { /* empty dir */ }
  return all;
}

describe("registerHooks", () => {
  it("registers all expected hooks", () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    const expected = [
      "session_start", "session_end",
      "message_received", "message_sent",
      "llm_input", "llm_output",
      "after_tool_call", "agent_end",
      "subagent_spawned", "subagent_ended",
    ];
    for (const hookName of expected) {
      expect(api.isRegistered(hookName), `Hook ${hookName} should be registered`).toBe(true);
    }
  });

  it("does not register before_tool_call when captureBeforeToolCall is false", () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig({ captureBeforeToolCall: false }) });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig({ captureBeforeToolCall: false }));
    expect(api.isRegistered("before_tool_call")).toBe(false);
  });

  it("registers before_tool_call when captureBeforeToolCall is true", () => {
    const api = makeApi();
    const cfg = makeConfig({ captureBeforeToolCall: true });
    const writer = new AuditWriter({ config: cfg });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, cfg);
    expect(api.isRegistered("before_tool_call")).toBe(true);
  });

  it("writes llm_input event with correct runId", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("llm_input", {
      runId: "run-abc",
      sessionId: "s-1",
      provider: "openai",
      model: "gpt-4",
      prompt: "Hello",
      historyMessages: [{}, {}],
      systemPrompt: "You are helpful.",
    }, { agentId: "agent-1", sessionKey: "key-1" });

    await writer.flush();

    const events = await readEvents(tmpDir);
    const llmEv = events.find((e) => e.type === "llm_input");
    expect(llmEv).toBeDefined();
    expect(llmEv!.runId).toBe("run-abc");
    const p = llmEv!.payload as { historyMessageCount: number; provider: string; systemPromptHash?: string };
    expect(p.historyMessageCount).toBe(2);
    expect(p.provider).toBe("openai");
    // metadata_only: systemPromptHash should be set, no prompt field
    expect(p.systemPromptHash).toBeDefined();
    expect((llmEv!.payload as Record<string, unknown>)["prompt"]).toBeUndefined();
  });

  it("writes after_tool_call with success=true on no error", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("after_tool_call", {
      toolName: "bash",
      params: { command: "ls" },
      runId: "run-1",
      result: { output: "file.txt" },
      durationMs: 42,
    }, { agentId: "a1", sessionId: "s1" });

    await writer.flush();

    const events = await readEvents(tmpDir);
    const toolEv = events.find((e) => e.type === "tool_call_after");
    expect(toolEv).toBeDefined();
    const p = toolEv!.payload as { toolName: string; success: boolean; durationMs: number };
    expect(p.toolName).toBe("bash");
    expect(p.success).toBe(true);
    expect(p.durationMs).toBe(42);
  });

  it("writes after_tool_call with success=false on error", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("after_tool_call", {
      toolName: "bash",
      params: {},
      error: "Permission denied",
      durationMs: 10,
    }, {});

    await writer.flush();

    const events = await readEvents(tmpDir);
    const toolEv = events.find((e) => e.type === "tool_call_after");
    expect(toolEv).toBeDefined();
    const p = toolEv!.payload as { success: boolean; error: string };
    expect(p.success).toBe(false);
    expect(p.error).toBe("Permission denied");
  });

  it("does not record content in metadata_only mode", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig({ captureMode: "metadata_only" }) });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig({ captureMode: "metadata_only" }));

    api.fire("message_received", {
      from: "user",
      content: "sensitive user message",
    }, { channelId: "telegram" });

    await writer.flush();

    const events = await readEvents(tmpDir);
    const msgEv = events.find((e) => e.type === "message_received");
    expect(msgEv).toBeDefined();
    const p = msgEv!.payload as Record<string, unknown>;
    expect(p["content"]).toBeUndefined();
    expect(p["contentLength"]).toBe("sensitive user message".length);
  });

  it("records content in full_capture mode", async () => {
    const api = makeApi();
    const cfg = makeConfig({ captureMode: "full_capture" });
    const writer = new AuditWriter({ config: cfg });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, cfg);

    api.fire("message_received", {
      from: "user",
      content: "hello world",
    }, { channelId: "telegram" });

    await writer.flush();

    const events = await readEvents(tmpDir);
    const msgEv = events.find((e) => e.type === "message_received");
    expect(msgEv).toBeDefined();
    const p = msgEv!.payload as Record<string, unknown>;
    expect(p["content"]).toBe("hello world");
  });

  it("writes session_end event", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("session_end", {
      sessionId: "s-1", sessionKey: "key-1", messageCount: 5, durationMs: 300,
    }, { agentId: "a1" });

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "session_end");
    expect(ev).toBeDefined();
    const p = ev!.payload as { messageCount: number; durationMs: number };
    expect(p.messageCount).toBe(5);
    expect(p.durationMs).toBe(300);
  });

  it("writes message_sent event", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("message_sent", {
      to: "user123", content: "Hello!", success: true,
    }, { channelId: "telegram" });

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "message_sent");
    expect(ev).toBeDefined();
    const p = ev!.payload as { to: string; success: boolean; contentLength: number };
    expect(p.to).toBe("user123");
    expect(p.success).toBe(true);
    expect(p.contentLength).toBe(6);
  });

  it("writes llm_output event with token usage", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("llm_output", {
      runId: "run-1", sessionId: "s-1", provider: "anthropic", model: "claude-sonnet-4-6",
      assistantTexts: ["Hello", " world"],
      usage: { input: 200, output: 80, total: 280 },
    }, { agentId: "a1" });

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "llm_output");
    expect(ev).toBeDefined();
    const p = ev!.payload as { provider: string; assistantTextLength: number; usage: Record<string, number> };
    expect(p.provider).toBe("anthropic");
    expect(p.assistantTextLength).toBe(11); // "Hello world"
    expect(p.usage["input"]).toBe(200);
    expect(ev!.runId).toBe("run-1");
  });

  it("writes agent_end event", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("agent_end", {
      messages: [{}, {}, {}], success: false, error: "Context limit exceeded", durationMs: 5000,
    }, { agentId: "a1", sessionId: "s1" });

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "agent_end");
    expect(ev).toBeDefined();
    const p = ev!.payload as { success: boolean; error: string; messageCount: number };
    expect(p.success).toBe(false);
    expect(p.error).toBe("Context limit exceeded");
    expect(p.messageCount).toBe(3);
  });

  it("writes subagent_spawned event", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("subagent_spawned", {
      childSessionKey: "child-key", agentId: "child-agent", mode: "run", runId: "run-xyz",
    }, { runId: "run-xyz" });

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "subagent_spawned");
    expect(ev).toBeDefined();
    const p = ev!.payload as { childSessionKey: string; childAgentId: string; mode: string };
    expect(p.childSessionKey).toBe("child-key");
    expect(p.childAgentId).toBe("child-agent");
    expect(p.mode).toBe("run");
  });

  it("writes subagent_ended event", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("subagent_ended", {
      targetSessionKey: "child-key", outcome: "ok", runId: "run-xyz",
    }, {});

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "subagent_ended");
    expect(ev).toBeDefined();
    const p = ev!.payload as { targetSessionKey: string; outcome: string };
    expect(p.targetSessionKey).toBe("child-key");
    expect(p.outcome).toBe("ok");
  });

  it("respects enabledEvents filter — skips disabled types", async () => {
    const cfg = makeConfig({ enabledEvents: ["session_start"] });
    const api = makeApi();
    const writer = new AuditWriter({ config: cfg });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, cfg);

    // session_start should be registered, llm_input should not
    expect(api.isRegistered("session_start")).toBe(true);
    expect(api.isRegistered("llm_input")).toBe(false);
  });

  it("records systemPromptHash in llm_input when systemPrompt is provided", async () => {
    const api = makeApi();
    const writer = new AuditWriter({ config: makeConfig() });
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, makeConfig());

    api.fire("llm_input", {
      runId: "r1", sessionId: "s1", provider: "openai", model: "gpt-4",
      prompt: "Hello", historyMessages: [],
      systemPrompt: "You are a helpful assistant.",
    }, {});

    await writer.flush();
    const events = await readEvents(tmpDir);
    const ev = events.find((e) => e.type === "llm_input");
    const p = ev!.payload as { systemPromptHash: string };
    expect(p.systemPromptHash).toHaveLength(64);
  });
});
