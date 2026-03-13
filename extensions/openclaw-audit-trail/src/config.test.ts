import { describe, it, expect } from "vitest";
import { auditTrailConfigSchema, DEFAULT_CONFIG } from "./config.js";

describe("auditTrailConfigSchema.parse", () => {
  it("returns defaults for empty config", () => {
    const cfg = auditTrailConfigSchema.parse({});
    expect(cfg.captureMode).toBe("metadata_only");
    expect(cfg.rotation.strategy).toBe("daily");
    expect(cfg.redaction.mode).toBe("hash");
    expect(cfg.captureBeforeToolCall).toBe(false);
    expect(cfg.logDir).toBe(DEFAULT_CONFIG.logDir);
  });

  it("returns defaults for null/undefined/non-object", () => {
    expect(auditTrailConfigSchema.parse(null).captureMode).toBe("metadata_only");
    expect(auditTrailConfigSchema.parse(undefined).captureMode).toBe("metadata_only");
    expect(auditTrailConfigSchema.parse("string").captureMode).toBe("metadata_only");
  });

  it("parses captureMode: full_capture", () => {
    const cfg = auditTrailConfigSchema.parse({ captureMode: "full_capture" });
    expect(cfg.captureMode).toBe("full_capture");
  });

  it("falls back to metadata_only for unknown captureMode", () => {
    const cfg = auditTrailConfigSchema.parse({ captureMode: "unknown" });
    expect(cfg.captureMode).toBe("metadata_only");
  });

  it("parses custom logDir", () => {
    const cfg = auditTrailConfigSchema.parse({ logDir: "/custom/path" });
    expect(cfg.logDir).toBe("/custom/path");
  });

  it("parses rotation.strategy: session", () => {
    const cfg = auditTrailConfigSchema.parse({ rotation: { strategy: "session" } });
    expect(cfg.rotation.strategy).toBe("session");
  });

  it("parses rotation.strategy: size with maxSizeBytes", () => {
    const cfg = auditTrailConfigSchema.parse({ rotation: { strategy: "size", maxSizeBytes: 1048576 } });
    expect(cfg.rotation.strategy).toBe("size");
    expect(cfg.rotation.maxSizeBytes).toBe(1048576);
  });

  it("defaults rotation.strategy to daily for unknown value", () => {
    const cfg = auditTrailConfigSchema.parse({ rotation: { strategy: "unknown" } });
    expect(cfg.rotation.strategy).toBe("daily");
  });

  it("parses redaction.mode: omit", () => {
    const cfg = auditTrailConfigSchema.parse({ redaction: { mode: "omit" } });
    expect(cfg.redaction.mode).toBe("omit");
  });

  it("parses redaction.mode: truncate with truncateLength", () => {
    const cfg = auditTrailConfigSchema.parse({ redaction: { mode: "truncate", truncateLength: 64 } });
    expect(cfg.redaction.mode).toBe("truncate");
    expect(cfg.redaction.truncateLength).toBe(64);
  });

  it("parses redaction.fields array", () => {
    const cfg = auditTrailConfigSchema.parse({ redaction: { mode: "hash", fields: ["payload.content"] } });
    expect(cfg.redaction.fields).toEqual(["payload.content"]);
  });

  it("filters non-string redaction fields", () => {
    const cfg = auditTrailConfigSchema.parse({ redaction: { mode: "hash", fields: ["valid", 123, null] } });
    expect(cfg.redaction.fields).toEqual(["valid"]);
  });

  it("parses enabledEvents array", () => {
    const cfg = auditTrailConfigSchema.parse({ enabledEvents: ["session_start", "llm_input"] });
    expect(cfg.enabledEvents).toEqual(["session_start", "llm_input"]);
  });

  it("sets enabledEvents to undefined when not provided", () => {
    const cfg = auditTrailConfigSchema.parse({});
    expect(cfg.enabledEvents).toBeUndefined();
  });

  it("parses captureBeforeToolCall: true", () => {
    const cfg = auditTrailConfigSchema.parse({ captureBeforeToolCall: true });
    expect(cfg.captureBeforeToolCall).toBe(true);
  });

  it("defaults captureBeforeToolCall to false for truthy non-boolean", () => {
    const cfg = auditTrailConfigSchema.parse({ captureBeforeToolCall: 1 });
    expect(cfg.captureBeforeToolCall).toBe(false);
  });
});

describe("auditTrailConfigSchema.uiHints", () => {
  it("has uiHints for key fields", () => {
    const hints = auditTrailConfigSchema.uiHints;
    expect(hints).toHaveProperty("logDir");
    expect(hints).toHaveProperty("captureMode");
    expect(hints["captureMode"]!.label).toBeDefined();
    expect(hints["logDir"]!.advanced).toBe(true);
  });
});
