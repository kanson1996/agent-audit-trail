import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { HashChainWriter } from "./hash-chain.js";
import { verifyFile, verifyDirectory } from "./verifier.js";
import type { AuditEvent } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeEvents(filePath: string, count: number): Promise<void> {
  const writer = new HashChainWriter(filePath);
  for (let i = 0; i < count; i++) {
    writer.append({
      type: "session_start",
      timestamp: `2026-03-13T00:00:0${i}.000Z`,
      payload: { sessionId: `s-${i}` },
    });
  }
  await writer.flush();
}

describe("verifyFile", () => {
  it("returns valid=true for a correct chain", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    await writeEvents(filePath, 3);

    const result = await verifyFile(filePath);
    expect(result.valid).toBe(true);
    expect(result.totalEvents).toBe(3);
    expect(result.tamperedAtSeq).toBeUndefined();
  });

  it("returns valid=false for non-existent file", async () => {
    const result = await verifyFile(path.join(tmpDir, "nope.jsonl"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Cannot read file");
  });

  it("detects tampering in the middle of a chain", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    await writeEvents(filePath, 5);

    // Read, tamper line 2 (seq=2), rewrite
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trimEnd().split("\n");
    const ev = JSON.parse(lines[2]!) as AuditEvent;
    const tampered = { ...ev, seq: 999 };
    lines[2] = JSON.stringify(tampered);
    await fs.writeFile(filePath, lines.join("\n") + "\n");

    const result = await verifyFile(filePath);
    expect(result.valid).toBe(false);
    // Tampering detected at seq=999 (hash mismatch) or seq=3 (prevHash mismatch)
    expect(result.tamperedAtSeq).toBeDefined();
  });

  it("detects tampering of the first event", async () => {
    const filePath = path.join(tmpDir, "audit.jsonl");
    await writeEvents(filePath, 2);

    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trimEnd().split("\n");
    const ev = JSON.parse(lines[0]!) as AuditEvent;
    // Change payload
    const tampered = { ...ev, payload: { sessionId: "HACKED" } };
    lines[0] = JSON.stringify(tampered);
    await fs.writeFile(filePath, lines.join("\n") + "\n");

    const result = await verifyFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.tamperedAtSeq).toBe(0);
  });

  it("handles empty file gracefully", async () => {
    const filePath = path.join(tmpDir, "empty.jsonl");
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(filePath, "");
    const result = await verifyFile(filePath);
    expect(result.valid).toBe(true);
    expect(result.totalEvents).toBe(0);
  });
});

describe("verifyDirectory", () => {
  it("returns valid report when all files are intact", async () => {
    await fs.mkdir(path.join(tmpDir, "2026-03-13"), { recursive: true });
    await writeEvents(path.join(tmpDir, "2026-03-13", "audit-2026-03-13.jsonl"), 3);

    const report = await verifyDirectory(tmpDir);
    expect(report.checkedFiles).toBe(1);
    expect(report.validFiles).toBe(1);
    expect(report.tamperedFiles).toBe(0);
  });

  it("reports tampered files correctly", async () => {
    await fs.mkdir(path.join(tmpDir, "2026-03-13"), { recursive: true });
    const filePath = path.join(tmpDir, "2026-03-13", "audit-2026-03-13.jsonl");
    await writeEvents(filePath, 3);

    // Tamper the file
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trimEnd().split("\n");
    const ev = JSON.parse(lines[1]!) as AuditEvent;
    lines[1] = JSON.stringify({ ...ev, payload: { sessionId: "TAMPERED" } });
    await fs.writeFile(filePath, lines.join("\n") + "\n");

    const report = await verifyDirectory(tmpDir);
    expect(report.tamperedFiles).toBe(1);
    expect(report.validFiles).toBe(0);
  });

  it("returns empty report for missing directory", async () => {
    const report = await verifyDirectory(path.join(tmpDir, "nonexistent"));
    expect(report.checkedFiles).toBe(0);
    expect(report.validFiles).toBe(0);
  });
});
