/**
 * Compliance report generator.
 *
 * Produces a summary of audit activity over a time range:
 * - Total events by type
 * - Session count
 * - LLM call count and token usage
 * - Tool call counts (top N)
 * - Error rate
 * - Chain integrity status
 */

import { readTrail } from "./reader.js";
import { verifyDirectory } from "./verifier.js";
import type { AuditEvent, AuditEventType } from "./types.js";

export type ToolStat = {
  toolName: string;
  calls: number;
  errors: number;
};

export type ComplianceReport = {
  generatedAt: string;
  period: { from?: string; to?: string };
  totalEvents: number;
  eventsByType: Partial<Record<AuditEventType, number>>;
  sessions: number;
  llmCalls: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  toolCallsTotal: number;
  topTools: ToolStat[];
  errorRate: number;
  integrity: {
    checkedFiles: number;
    validFiles: number;
    tamperedFiles: number;
  };
};

export type ReportOptions = {
  logDir: string;
  from?: string;
  to?: string;
  topN?: number;
};

export async function generateReport(opts: ReportOptions): Promise<ComplianceReport> {
  const { logDir, from, to, topN = 10 } = opts;

  // Load all events in range
  const trailFilter: import("./reader.js").TrailFilter = {};
  if (from !== undefined) trailFilter.from = from;
  if (to !== undefined) trailFilter.to = to;
  const events = await readTrail(logDir, trailFilter);

  // Count by type
  const eventsByType: Partial<Record<AuditEventType, number>> = {};
  for (const ev of events) {
    eventsByType[ev.type] = (eventsByType[ev.type] ?? 0) + 1;
  }

  // Session count
  const sessions = eventsByType["session_start"] ?? 0;

  // LLM stats
  const llmCalls = eventsByType["llm_input"] ?? 0;
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  for (const ev of events) {
    if (ev.type === "llm_output") {
      const p = ev.payload as { usage?: { input?: number; output?: number } };
      totalTokensInput += p.usage?.input ?? 0;
      totalTokensOutput += p.usage?.output ?? 0;
    }
  }

  // Tool call stats
  const toolStats = new Map<string, ToolStat>();
  let totalErrors = 0;
  let toolCallsTotal = 0;

  for (const ev of events) {
    if (ev.type === "tool_call_after") {
      const p = ev.payload as { toolName: string; success: boolean };
      toolCallsTotal++;
      const stat = toolStats.get(p.toolName) ?? { toolName: p.toolName, calls: 0, errors: 0 };
      stat.calls++;
      if (!p.success) {
        stat.errors++;
        totalErrors++;
      }
      toolStats.set(p.toolName, stat);
    }
    if (ev.type === "agent_end") {
      const p = ev.payload as { success: boolean };
      if (!p.success) {
        totalErrors++;
      }
    }
  }

  const topTools = [...toolStats.values()]
    .sort((a, b) => b.calls - a.calls)
    .slice(0, topN);

  const errorRate = events.length > 0 ? totalErrors / events.length : 0;

  // Chain integrity
  const verifyOpts: { from?: string; to?: string } = {};
  if (from !== undefined) verifyOpts.from = from;
  if (to !== undefined) verifyOpts.to = to;
  const integrity = await verifyDirectory(logDir, verifyOpts);

  const period: { from?: string; to?: string } = {};
  if (from !== undefined) period.from = from;
  if (to !== undefined) period.to = to;

  return {
    generatedAt: new Date().toISOString(),
    period,
    totalEvents: events.length,
    eventsByType,
    sessions,
    llmCalls,
    totalTokensInput,
    totalTokensOutput,
    toolCallsTotal,
    topTools,
    errorRate,
    integrity: {
      checkedFiles: integrity.checkedFiles,
      validFiles: integrity.validFiles,
      tamperedFiles: integrity.tamperedFiles,
    },
  };
}

export function formatReportText(report: ComplianceReport): string {
  const lines: string[] = [
    "=== Agent Audit Trail — Compliance Report ===",
    `Generated: ${report.generatedAt}`,
    `Period:    ${report.period.from ?? "(beginning)"} → ${report.period.to ?? "(now)"}`,
    "",
    `Total events:   ${report.totalEvents}`,
    `Sessions:       ${report.sessions}`,
    `LLM calls:      ${report.llmCalls}`,
    `Tokens in/out:  ${report.totalTokensInput} / ${report.totalTokensOutput}`,
    `Tool calls:     ${report.toolCallsTotal}`,
    `Error rate:     ${(report.errorRate * 100).toFixed(1)}%`,
    "",
    "Events by type:",
  ];

  for (const [type, count] of Object.entries(report.eventsByType)) {
    lines.push(`  ${type.padEnd(22)} ${count}`);
  }

  if (report.topTools.length > 0) {
    lines.push("", "Top tools:");
    for (const tool of report.topTools) {
      lines.push(`  ${tool.toolName.padEnd(30)} calls=${tool.calls} errors=${tool.errors}`);
    }
  }

  lines.push(
    "",
    "Chain integrity:",
    `  Files checked: ${report.integrity.checkedFiles}`,
    `  Valid:         ${report.integrity.validFiles}`,
    `  Tampered:      ${report.integrity.tamperedFiles}`,
  );

  return lines.join("\n");
}
