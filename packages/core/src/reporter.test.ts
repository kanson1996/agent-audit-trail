import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AuditWriter } from "./writer.js";
import { generateReport, formatReportText } from "./reporter.js";
import type { AuditTrailConfig } from "./types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporter-test-"));
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

async function writeTestScenario() {
  const writer = new AuditWriter({ config: makeConfig() });
  const ts = (s: number) => `2026-03-13T00:00:0${s}.000Z`;

  writer.append({ type: "session_start", timestamp: ts(0), sessionId: "s1", payload: { sessionId: "s1" } });
  writer.append({ type: "session_start", timestamp: ts(1), sessionId: "s2", payload: { sessionId: "s2" } });
  writer.append({
    type: "llm_input", timestamp: ts(2), runId: "r1", sessionId: "s1",
    payload: { provider: "openai", model: "gpt-4", historyMessageCount: 2 },
  });
  writer.append({
    type: "llm_output", timestamp: ts(3), runId: "r1", sessionId: "s1",
    payload: { provider: "openai", model: "gpt-4", usage: { input: 100, output: 50 } },
  });
  writer.append({
    type: "tool_call_after", timestamp: ts(4), runId: "r1",
    payload: { toolName: "bash", success: true, durationMs: 20 },
  });
  writer.append({
    type: "tool_call_after", timestamp: ts(5), runId: "r1",
    payload: { toolName: "bash", success: false, error: "Permission denied", durationMs: 5 },
  });
  writer.append({
    type: "tool_call_after", timestamp: ts(6), runId: "r1",
    payload: { toolName: "read_file", success: true, durationMs: 10 },
  });
  writer.append({
    type: "agent_end", timestamp: ts(7), sessionId: "s1",
    payload: { success: true, durationMs: 100, messageCount: 4 },
  });
  writer.append({
    type: "session_end", timestamp: ts(8), sessionId: "s1",
    payload: { sessionId: "s1", messageCount: 4, durationMs: 200 },
  });

  await writer.flush();
}

describe("generateReport", () => {
  it("returns zero counts for empty log directory", async () => {
    const report = await generateReport({ logDir: tmpDir });
    expect(report.totalEvents).toBe(0);
    expect(report.sessions).toBe(0);
    expect(report.llmCalls).toBe(0);
    expect(report.toolCallsTotal).toBe(0);
    expect(report.errorRate).toBe(0);
  });

  it("counts sessions correctly", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    expect(report.sessions).toBe(2);
  });

  it("counts LLM calls correctly", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    expect(report.llmCalls).toBe(1);
  });

  it("sums token usage from llm_output events", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    expect(report.totalTokensInput).toBe(100);
    expect(report.totalTokensOutput).toBe(50);
  });

  it("counts tool calls and ranks by frequency", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    expect(report.toolCallsTotal).toBe(3);
    expect(report.topTools[0]!.toolName).toBe("bash");
    expect(report.topTools[0]!.calls).toBe(2);
    expect(report.topTools[0]!.errors).toBe(1);
  });

  it("includes integrity check results", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    expect(report.integrity.checkedFiles).toBeGreaterThan(0);
    expect(report.integrity.validFiles).toBe(report.integrity.checkedFiles);
    expect(report.integrity.tamperedFiles).toBe(0);
  });

  it("populates period from options", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir, from: "2026-03-13", to: "2026-03-13" });
    expect(report.period.from).toBe("2026-03-13");
    expect(report.period.to).toBe("2026-03-13");
  });

  it("omits from/to in period when not provided", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    expect(report.period.from).toBeUndefined();
    expect(report.period.to).toBeUndefined();
  });

  it("respects topN limit for tool list", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir, topN: 1 });
    expect(report.topTools.length).toBeLessThanOrEqual(1);
  });

  it("has generatedAt as ISO timestamp", async () => {
    const report = await generateReport({ logDir: tmpDir });
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("formatReportText", () => {
  it("renders a complete text report", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    const text = formatReportText(report);

    expect(text).toContain("Compliance Report");
    expect(text).toContain("Sessions:");
    expect(text).toContain("LLM calls:");
    expect(text).toContain("Tool calls:");
    expect(text).toContain("Chain integrity:");
    expect(text).toContain("Events by type:");
  });

  it("renders top tools section when tools exist", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir });
    const text = formatReportText(report);
    expect(text).toContain("Top tools:");
    expect(text).toContain("bash");
  });

  it("shows (beginning) when from is not set", async () => {
    const report = await generateReport({ logDir: tmpDir });
    const text = formatReportText(report);
    expect(text).toContain("(beginning)");
  });

  it("shows (now) when to is not set", async () => {
    const report = await generateReport({ logDir: tmpDir });
    const text = formatReportText(report);
    expect(text).toContain("(now)");
  });

  it("shows period dates when set", async () => {
    await writeTestScenario();
    const report = await generateReport({ logDir: tmpDir, from: "2026-03-01", to: "2026-03-13" });
    const text = formatReportText(report);
    expect(text).toContain("2026-03-01");
    expect(text).toContain("2026-03-13");
  });
});
