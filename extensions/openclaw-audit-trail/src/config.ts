/**
 * OpenClaw plugin configuration schema for audit-trail.
 *
 * Follows the same pattern as memory-lancedb's configSchema:
 * a plain object with parse() and uiHints.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { AuditTrailConfig } from "agent-audit-trail";

const DEFAULT_LOG_DIR = join(homedir(), ".openclaw", "audit-trail");

export const DEFAULT_CONFIG: AuditTrailConfig = {
  logDir: DEFAULT_LOG_DIR,
  captureMode: "metadata_only",
  rotation: { strategy: "daily" },
  redaction: { mode: "hash", fields: [] },
  captureBeforeToolCall: false,
};

function assertAllowedKeys(obj: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

export const auditTrailConfigSchema = {
  parse(value: unknown): AuditTrailConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      // Accept empty config — use all defaults
      return { ...DEFAULT_CONFIG };
    }

    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["logDir", "captureMode", "rotation", "redaction", "enabledEvents", "captureBeforeToolCall"],
      "audit-trail config",
    );

    const captureMode =
      cfg["captureMode"] === "full_capture" ? "full_capture" : "metadata_only";

    // Rotation
    let rotation: AuditTrailConfig["rotation"] = { strategy: "daily" };
    if (cfg["rotation"] && typeof cfg["rotation"] === "object") {
      const rot = cfg["rotation"] as Record<string, unknown>;
      const strategy =
        rot["strategy"] === "session"
          ? "session"
          : rot["strategy"] === "size"
            ? "size"
            : "daily";
      rotation = {
        strategy,
        maxSizeBytes:
          typeof rot["maxSizeBytes"] === "number" ? rot["maxSizeBytes"] : undefined,
      };
    }

    // Redaction
    let redaction: AuditTrailConfig["redaction"] = { mode: "hash", fields: [] };
    if (cfg["redaction"] && typeof cfg["redaction"] === "object") {
      const red = cfg["redaction"] as Record<string, unknown>;
      const mode =
        red["mode"] === "omit" ? "omit" : red["mode"] === "truncate" ? "truncate" : "hash";
      redaction = {
        mode,
        fields: Array.isArray(red["fields"])
          ? (red["fields"] as string[]).filter((f) => typeof f === "string")
          : [],
        truncateLength:
          typeof red["truncateLength"] === "number" ? red["truncateLength"] : undefined,
      };
    }

    return {
      logDir: typeof cfg["logDir"] === "string" ? cfg["logDir"] : DEFAULT_LOG_DIR,
      captureMode,
      rotation,
      redaction,
      enabledEvents: Array.isArray(cfg["enabledEvents"])
        ? (cfg["enabledEvents"] as string[]).filter((e) => typeof e === "string") as AuditTrailConfig["enabledEvents"]
        : undefined,
      captureBeforeToolCall: cfg["captureBeforeToolCall"] === true,
    };
  },

  uiHints: {
    logDir: {
      label: "Log Directory",
      placeholder: DEFAULT_LOG_DIR,
      help: "Directory where tamper-evident audit logs are stored",
      advanced: true,
    },
    captureMode: {
      label: "Capture Mode",
      help: 'metadata_only: record hashes and lengths only (privacy-safe). full_capture: record raw content.',
      placeholder: "metadata_only",
    },
    "rotation.strategy": {
      label: "Rotation Strategy",
      help: "daily: one file per day. session: one file per session. size: rotate by file size.",
      placeholder: "daily",
    },
    "rotation.maxSizeBytes": {
      label: "Max Log File Size (bytes)",
      help: "Only used when rotation strategy is 'size'",
      advanced: true,
      placeholder: "10485760",
    },
    "redaction.mode": {
      label: "Redaction Mode",
      help: "hash: replace with SHA-256. omit: remove field. truncate: keep first N chars.",
      placeholder: "hash",
    },
    "redaction.fields": {
      label: "Redaction Fields",
      help: "Dot-notation paths to redact in full_capture mode (e.g. payload.content)",
      advanced: true,
    },
    captureBeforeToolCall: {
      label: "Capture Before Tool Call",
      help: "Record tool parameters before execution (may expose sensitive args)",
      advanced: true,
    },
  },
};
