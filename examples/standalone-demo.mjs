/**
 * standalone-demo.mjs — agent-audit-trail core 包独立使用示例
 *
 * 不需要 OpenClaw，直接使用 core 包记录和验证审计日志。
 *
 * 运行方式（在 agent-audit-trail/ 目录下）：
 *   node examples/standalone-demo.mjs
 *
 * 或者（直接运行源码，无需 build）：
 *   node --import tsx/esm examples/standalone-demo.mjs
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

// 从已构建的 dist 产物导入（先运行 pnpm build）
import { AuditWriter } from "../packages/core/dist/src/writer.js";
import { verifyDirectory } from "../packages/core/dist/src/verifier.js";
import { readTrail } from "../packages/core/dist/src/reader.js";
import { generateReport, formatReportText } from "../packages/core/dist/src/reporter.js";

// ============================================================================
// 配置
// ============================================================================

const logDir = join(tmpdir(), `audit-demo-${Date.now()}`);
console.log(`📁 日志目录: ${logDir}\n`);

const config = {
  logDir,
  captureMode: "metadata_only", // 不记录原始内容，只记录哈希和长度
  rotation: { strategy: "daily" },
  redaction: { mode: "hash", fields: [] },
  captureBeforeToolCall: false,
};

// ============================================================================
// Step 1: 创建 AuditWriter，模拟一次 Agent 会话
// ============================================================================

console.log("Step 1: 写入审计日志...");

const writer = new AuditWriter({ config });
const now = () => new Date().toISOString();

// 会话开始
writer.append({
  type: "session_start",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  sessionKey: "key-abc",
  payload: { sessionId: "s-001", sessionKey: "key-abc" },
});

// 收到用户消息
writer.append({
  type: "message_received",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  payload: {
    from: "user-123",
    channelId: "telegram",
    contentLength: 42,
    // content 不记录（metadata_only 模式）
  },
});

// LLM 调用（第一轮）
const runId = "run-xyz-001";
writer.append({
  type: "llm_input",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  runId,
  payload: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    historyMessageCount: 1,
    systemPromptHash: "d8f1a2b3c4d5e6f7".repeat(4), // 真实场景由 contentHash() 生成
  },
});

// 工具调用：bash
writer.append({
  type: "tool_call_after",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  runId,
  toolCallId: "tc-001",
  payload: {
    toolName: "bash",
    durationMs: 156,
    success: true,
    resultHash: "abcdef12345678".repeat(4),
  },
});

// 工具调用：read_file（失败）
writer.append({
  type: "tool_call_after",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  runId,
  payload: {
    toolName: "read_file",
    durationMs: 23,
    success: false,
    error: "Permission denied: /etc/passwd",
  },
});

// LLM 输出
writer.append({
  type: "llm_output",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  runId,
  payload: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    assistantTextLength: 280,
    usage: { input: 1240, output: 87, total: 1327 },
  },
});

// Agent 结束
writer.append({
  type: "agent_end",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  payload: { success: true, durationMs: 2340, messageCount: 6 },
});

// 会话结束
writer.append({
  type: "session_end",
  timestamp: now(),
  agentId: "my-agent",
  sessionId: "s-001",
  payload: { sessionId: "s-001", messageCount: 6, durationMs: 2500 },
});

// 等待所有写入完成
await writer.flush();
console.log("  ✓ 8 条 AuditEvent 写入完成\n");

// ============================================================================
// Step 2: 验证哈希链完整性
// ============================================================================

console.log("Step 2: 验证哈希链完整性...");

const report = await verifyDirectory(logDir);
for (const result of report.results) {
  const icon = result.valid ? "✓" : "✗";
  console.log(`  ${icon} ${result.filePath}`);
  console.log(`    events: ${result.totalEvents}, valid: ${result.valid}`);
}
console.log(`\n  结果: ${report.validFiles}/${report.checkedFiles} 个文件完整\n`);

// ============================================================================
// Step 3: 按 runId 重建决策链
// ============================================================================

console.log(`Step 3: 重建 run ${runId} 的决策链...`);

const trail = await readTrail(logDir, { runId });
console.log(`  找到 ${trail.length} 条相关事件:`);
for (const ev of trail) {
  const ts = ev.timestamp.slice(11, 19);
  const extra = "toolName" in ev.payload
    ? ` → ${(ev.payload).toolName}`
    : "";
  console.log(`  [${ts}] ${ev.type}${extra}`);
}
console.log();

// ============================================================================
// Step 4: 合规报告
// ============================================================================

console.log("Step 4: 生成合规报告...");

const compliance = await generateReport({ logDir });
console.log(formatReportText(compliance));

// ============================================================================
// Step 5: 模拟篡改，演示检测
// ============================================================================

console.log("\nStep 5: 演示篡改检测...");

// 找到日志文件并篡改中间一行
import { readdir, readFile, writeFile } from "node:fs/promises";

async function findJsonlFiles(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const fp = join(dir, e.name);
    if (e.isDirectory()) results.push(...await findJsonlFiles(fp));
    else if (e.name.endsWith(".jsonl") && e.name !== "index.jsonl") results.push(fp);
  }
  return results;
}

const files = await findJsonlFiles(logDir);
const targetFile = files[0];
const content = await readFile(targetFile, "utf8");
const lines = content.trimEnd().split("\n");

// 篡改第 3 行（seq=2）的 payload
const original = JSON.parse(lines[2]);
const tampered = { ...original, payload: { TAMPERED: "by attacker" } };
lines[2] = JSON.stringify(tampered);
await writeFile(targetFile, lines.join("\n") + "\n");

console.log(`  已篡改文件: ${targetFile} (seq=2)`);

const tamperedReport = await verifyDirectory(logDir);
for (const result of tamperedReport.results) {
  const icon = result.valid ? "✓" : "✗";
  const detail = result.valid
    ? `${result.totalEvents} events`
    : `TAMPERED at seq=${result.tamperedAtSeq} — ${result.error}`;
  console.log(`  ${icon} ${result.filePath}`);
  console.log(`    ${detail}`);
}

// ============================================================================
// 清理
// ============================================================================

await rm(logDir, { recursive: true, force: true });
console.log("\n✓ 演示完成，临时目录已清理");
