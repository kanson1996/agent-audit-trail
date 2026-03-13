import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { HashChainWriter, hashEvent } from "./hash-chain.js";
import type { AuditEvent } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeInput(seq?: number) {
  return {
    type: "session_start" as const,
    timestamp: new Date().toISOString(),
    payload: {
      sessionId: `s-${seq ?? 0}`,
      sessionKey: "key1",
    },
  };
}

async function readEvents(filePath: string): Promise<AuditEvent[]> {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEvent);
}

describe("HashChainWriter", () => {
  it("writes a genesis event with prevHash all zeros", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    const writer = new HashChainWriter(filePath);
    writer.append(makeInput(0));
    await writer.flush();

    const events = await readEvents(filePath);
    expect(events).toHaveLength(1);
    const [ev] = events;
    expect(ev!.seq).toBe(0);
    expect(ev!.prevHash).toBe("0".repeat(64));
    expect(ev!.hash).toHaveLength(64);
  });

  it("chains hashes between sequential events", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    const writer = new HashChainWriter(filePath);
    writer.append(makeInput(0));
    writer.append(makeInput(1));
    writer.append(makeInput(2));
    await writer.flush();

    const events = await readEvents(filePath);
    expect(events).toHaveLength(3);

    // Verify chain: each event's prevHash == previous event's hash
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.prevHash).toBe(events[i - 1]!.hash);
    }
  });

  it("seq numbers are monotonically increasing", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    const writer = new HashChainWriter(filePath);
    for (let i = 0; i < 5; i++) {
      writer.append(makeInput(i));
    }
    await writer.flush();

    const events = await readEvents(filePath);
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.seq).toBe(i);
    }
  });

  it("maintains chain integrity under concurrent appends", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    const writer = new HashChainWriter(filePath);

    // 50 concurrent appends — they must be serialized by the queue
    const promises = Array.from({ length: 50 }, (_, i) => {
      writer.append({
        type: "llm_input",
        timestamp: new Date().toISOString(),
        runId: `run-${i}`,
        payload: {
          provider: "openai",
          model: "gpt-4",
          historyMessageCount: i,
        },
      });
      return Promise.resolve();
    });
    await Promise.all(promises);
    await writer.flush();

    const events = await readEvents(filePath);
    expect(events).toHaveLength(50);

    // Verify complete chain
    expect(events[0]!.prevHash).toBe("0".repeat(64));
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.prevHash).toBe(events[i - 1]!.hash);
      expect(events[i]!.seq).toBe(events[i - 1]!.seq + 1);
    }
  });

  it("detects single-byte tampering when hash is recomputed", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    const writer = new HashChainWriter(filePath);
    writer.append(makeInput(0));
    await writer.flush();

    const events = await readEvents(filePath);
    const ev = events[0]!;

    // Tamper: change seq
    const tampered = { ...ev, seq: 999 };
    const { hash: _hash, ...withoutHash } = tampered;
    const recomputed = hashEvent(withoutHash);

    expect(recomputed).not.toBe(ev.hash);
  });

  it("recovers state from existing file on process restart", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");

    // First "process"
    const writer1 = new HashChainWriter(filePath);
    writer1.append(makeInput(0));
    writer1.append(makeInput(1));
    await writer1.flush();

    // Read last event hash to simulate recovery
    const state = await HashChainWriter.recover(filePath);
    expect(state).toBeDefined();

    // Second "process" continues from recovered state
    const writer2 = new HashChainWriter(filePath, state);
    writer2.append(makeInput(2));
    await writer2.flush();

    const events = await readEvents(filePath);
    expect(events).toHaveLength(3);
    expect(events[2]!.prevHash).toBe(events[1]!.hash);
    expect(events[2]!.seq).toBe(2);
  });

  it("recover returns undefined for non-existent file", async () => {
    const state = await HashChainWriter.recover(path.join(tmpDir, "nonexistent.jsonl"));
    expect(state).toBeUndefined();
  });
});
