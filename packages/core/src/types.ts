/**
 * Core types for the agent-audit-trail system.
 * All types are designed for JSONL serialization.
 */

export type AuditEventType =
  | "session_start"
  | "session_end"
  | "message_received"
  | "message_sent"
  | "llm_input"
  | "llm_output"
  | "tool_call_before"
  | "tool_call_after"
  | "agent_end"
  | "subagent_spawned"
  | "subagent_ended";

// ---------------------------------------------------------------------------
// Per-type payloads
// ---------------------------------------------------------------------------

export type SessionStartPayload = {
  sessionId: string;
  sessionKey?: string;
  resumedFrom?: string;
};

export type SessionEndPayload = {
  sessionId: string;
  sessionKey?: string;
  messageCount: number;
  durationMs?: number;
};

export type MessageReceivedPayload = {
  from: string;
  channelId: string;
  contentLength: number;
  content?: string;
};

export type MessageSentPayload = {
  to: string;
  channelId: string;
  success: boolean;
  error?: string;
  contentLength: number;
  content?: string;
};

export type LlmInputPayload = {
  provider: string;
  model: string;
  historyMessageCount: number;
  systemPromptHash?: string;
  prompt?: string;
};

export type LlmOutputPayload = {
  provider: string;
  model: string;
  assistantTextLength?: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

export type ToolCallBeforePayload = {
  toolName: string;
  paramsHash: string;
  params?: Record<string, unknown>;
};

export type ToolCallAfterPayload = {
  toolName: string;
  durationMs?: number;
  success: boolean;
  error?: string;
  resultHash?: string;
  result?: unknown;
};

export type AgentEndPayload = {
  success: boolean;
  durationMs?: number;
  messageCount?: number;
  error?: string;
};

export type SubagentSpawnedPayload = {
  childSessionKey: string;
  childAgentId: string;
  mode: "run" | "session";
};

export type SubagentEndedPayload = {
  targetSessionKey: string;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  error?: string;
};

export type AuditEventPayload =
  | SessionStartPayload
  | SessionEndPayload
  | MessageReceivedPayload
  | MessageSentPayload
  | LlmInputPayload
  | LlmOutputPayload
  | ToolCallBeforePayload
  | ToolCallAfterPayload
  | AgentEndPayload
  | SubagentSpawnedPayload
  | SubagentEndedPayload;

// ---------------------------------------------------------------------------
// Core event record (JSONL line)
// ---------------------------------------------------------------------------

export type AuditEvent = {
  /** Monotonically increasing counter within a single log file. */
  seq: number;
  /** SHA-256 hash of the previous event. Genesis event uses "0".repeat(64). */
  prevHash: string;
  /** SHA-256(canonicalJson(event minus the "hash" field)). */
  hash: string;

  type: AuditEventType;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;

  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  /** Stable identifier linking all hooks in a single agent invocation. */
  runId?: string;
  toolCallId?: string;

  payload: AuditEventPayload;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type RedactionMode = "hash" | "omit" | "truncate";

export type AuditTrailConfig = {
  /** Directory where audit logs are written. Default: ~/.openclaw/audit-trail */
  logDir: string;
  /** metadata_only: record hashes/lengths only; full_capture: record raw content. */
  captureMode: "metadata_only" | "full_capture";
  rotation: {
    strategy: "daily" | "session" | "size";
    /** Only used when strategy === "size". */
    maxSizeBytes?: number;
  };
  redaction: {
    /** Dot-notation paths to redact in full_capture mode. */
    fields?: string[];
    mode: RedactionMode;
    /** Only used when mode === "truncate". */
    truncateLength?: number;
  };
  /** If set, only these event types are written. Default: all types enabled. */
  enabledEvents?: AuditEventType[];
  /** If false, skip before_tool_call hook to minimize execution-path observation. */
  captureBeforeToolCall: boolean;
};

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

export type FileVerificationResult = {
  filePath: string;
  valid: boolean;
  totalEvents: number;
  /** First seq where tampering was detected, if any. */
  tamperedAtSeq?: number;
  error?: string;
};

export type VerificationReport = {
  checkedFiles: number;
  validFiles: number;
  tamperedFiles: number;
  results: FileVerificationResult[];
};
