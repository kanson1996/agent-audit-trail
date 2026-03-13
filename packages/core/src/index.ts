// Public API for agent-audit-trail core package

export { canonicalJson } from "./canonical-json.js";
export { HashChainWriter, hashEvent } from "./hash-chain.js";
export type { AuditEventInput, HashChainState } from "./hash-chain.js";
export { AuditWriter } from "./writer.js";
export type { WriterOptions } from "./writer.js";
export { redact, contentHash } from "./redactor.js";
export type { RedactorConfig } from "./redactor.js";
export { verifyFile, verifyDirectory } from "./verifier.js";
export { readTrail, searchEvents } from "./reader.js";
export type { TrailFilter, SearchFilter } from "./reader.js";
export { generateReport, formatReportText } from "./reporter.js";
export type { ComplianceReport, ReportOptions, ToolStat } from "./reporter.js";
export type {
  AuditEvent,
  AuditEventType,
  AuditEventPayload,
  AuditTrailConfig,
  RedactionMode,
  FileVerificationResult,
  VerificationReport,
  SessionStartPayload,
  SessionEndPayload,
  MessageReceivedPayload,
  MessageSentPayload,
  LlmInputPayload,
  LlmOutputPayload,
  ToolCallBeforePayload,
  ToolCallAfterPayload,
  AgentEndPayload,
  SubagentSpawnedPayload,
  SubagentEndedPayload,
} from "./types.js";
