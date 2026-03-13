import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AuditWriter } from "./writer.js";
import { readTrail, searchEvents } from "./reader.js";
import type { AuditEvent, AuditTrailConfig } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reader-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeConfig(): AuditTrailConfig {
  return {
    logDir: tmpDir,
    captureMode: "metadata_only",
    rotation: { strategy: "daily" },
    redaction: { mode: "hash", fields: [] },
    captureBeforeToolCall: false,
  };
}

async function writeScenario() {
  const writer = new AuditWriter({ config: makeConfig() });
  writer.append({
    type: "session_start", timestamp: "2026-03-13T00:00:00.000Z",
    sessionId: "s1", agentId: "a1",
    payload: { sessionId: "s1" },
  });
  writer.append({
    type: "llm_input", timestamp: "2026-03-13T00:00:01.000Z",
    runId: "run-1", sessionId: "s1", agentId: "a1",
    payload: { provider: "openai", model: "gpt-4", historyMessageCount: 0 },
  });
  writer.append({
    type: "tool_call_after", timestamp: "2026-03-13T00:00:02.000Z",
    runId: "run-1", sessionId: "s1",
    payload: { toolName: "bash", success: true, durationMs: 10 },
  });
  writer.append({
    type: "llm_input", timestamp: "2026-03-13T00:00:03.000Z",
    runId: "run-2", sessionId: "s2", agentId: "a2",
    payload: { provider: "anthropic", model: "claude-3", historyMessageCount: 0 },
  });
  await writer.flush();
}

describe("readTrail", () => {
  it("returns all events when no filter applied", async () => {
    await writeScenario();
    const events = await readTrail(tmpDir, {});
    expect(events.length).toBe(4);
  });

  it("filters by runId", async () => {
    await writeScenario();
    const events = await readTrail(tmpDir, { runId: "run-1" });
    expect(events.length).toBe(2);
    for (const ev of events) {
      expect(ev.runId).toBe("run-1");
    }
  });

  it("filters by sessionId", async () => {
    await writeScenario();
    const events = await readTrail(tmpDir, { sessionId: "s1" });
    expect(events).toHaveLength(3);
    for (const ev of events) {
      expect(ev.sessionId).toBe("s1");
    }
  });

  it("filters by agentId", async () => {
    await writeScenario();
    const events = await readTrail(tmpDir, { agentId: "a2" });
    expect(events).toHaveLength(1);
    expect(events[0]!.agentId).toBe("a2");
  });

  it("returns events sorted by timestamp", async () => {
    await writeScenario();
    const events = await readTrail(tmpDir, {});
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timestamp >= events[i - 1]!.timestamp).toBe(true);
    }
  });

  it("filters by from/to timestamps", async () => {
    await writeScenario();
    const events = await readTrail(tmpDir, {
      from: "2026-03-13T00:00:01.000Z",
      to: "2026-03-13T00:00:02.000Z",
    });
    expect(events.length).toBe(2);
  });

  it("returns empty array for non-existent directory", async () => {
    const events = await readTrail(path.join(tmpDir, "nonexistent"), {});
    expect(events).toHaveLength(0);
  });
});

describe("searchEvents", () => {
  it("calls onMatch for each matching event", async () => {
    await writeScenario();
    const found: AuditEvent[] = [];
    await searchEvents(tmpDir, { type: "llm_input" }, (ev) => found.push(ev));
    expect(found).toHaveLength(2);
  });

  it("filters by toolName", async () => {
    await writeScenario();
    const found: AuditEvent[] = [];
    await searchEvents(tmpDir, { toolName: "bash" }, (ev) => found.push(ev));
    expect(found).toHaveLength(1);
    expect((found[0]!.payload as { toolName: string }).toolName).toBe("bash");
  });

  it("filters by from timestamp", async () => {
    await writeScenario();
    const found: AuditEvent[] = [];
    await searchEvents(tmpDir, { from: "2026-03-13T00:00:02.000Z" }, (ev) => found.push(ev));
    expect(found.length).toBeLessThan(4);
  });

  it("calls onMatch zero times when nothing matches", async () => {
    await writeScenario();
    const found: AuditEvent[] = [];
    await searchEvents(tmpDir, { type: "session_end" }, (ev) => found.push(ev));
    expect(found).toHaveLength(0);
  });
});
