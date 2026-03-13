/**
 * Redaction utilities for sensitive fields in audit payloads.
 *
 * Supports three modes:
 *   - hash:     Replace value with SHA-256(String(value))
 *   - omit:     Remove the field entirely
 *   - truncate: Keep first N characters
 *
 * Paths use dot-notation (e.g. "payload.content", "payload.params.password").
 */

import { createHash } from "node:crypto";
import type { RedactionMode } from "./types.js";

export type RedactorConfig = {
  mode: RedactionMode;
  fields: string[];
  truncateLength?: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Deep-clone an object and redact specified dot-notation paths.
 */
export function redact(obj: Record<string, unknown>, config: RedactorConfig): Record<string, unknown> {
  if (config.fields.length === 0) {
    return obj;
  }
  const clone = deepClone(obj);
  for (const fieldPath of config.fields) {
    applyRedaction(clone, fieldPath.split("."), config);
  }
  return clone;
}

function applyRedaction(
  obj: Record<string, unknown>,
  parts: string[],
  config: RedactorConfig,
): void {
  if (parts.length === 0) {
    return;
  }
  const [head, ...rest] = parts;
  if (!head) {
    return;
  }

  if (rest.length === 0) {
    // Leaf: apply redaction
    if (!(head in obj)) {
      return;
    }
    if (config.mode === "omit") {
      delete obj[head];
    } else if (config.mode === "hash") {
      obj[head] = sha256(String(obj[head]));
    } else if (config.mode === "truncate") {
      const len = config.truncateLength ?? 32;
      const strVal = String(obj[head]);
      obj[head] = strVal.length > len ? strVal.slice(0, len) + "…" : strVal;
    }
    return;
  }

  // Traverse nested object
  const nested = obj[head];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    applyRedaction(nested as Record<string, unknown>, rest, config);
  }
}

function deepClone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/**
 * Compute SHA-256 of a string value — used for metadata_only mode
 * to record content fingerprints without storing raw content.
 */
export function contentHash(value: string): string {
  return sha256(value);
}
