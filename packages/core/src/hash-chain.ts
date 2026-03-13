/**
 * HashChainWriter — tamper-evident, append-only JSONL writer.
 *
 * Guarantees serial writes within a single file via a Promise queue
 * (same pattern as OpenClaw's QueuedFileWriter). Within each queued
 * step, it atomically:
 *   1. Reads prevHash from state
 *   2. Computes SHA-256(canonicalJson(event_without_hash_field))
 *   3. Appends the completed event to the file
 *   4. Updates in-memory state
 *
 * On process restart, call `recover()` to restore state from the last
 * line of an existing file.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
import type { AuditEvent, AuditEventPayload, AuditEventType } from "./types.js";

export type AuditEventInput = {
  type: AuditEventType;
  timestamp: string;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  toolCallId?: string;
  payload: AuditEventPayload;
};

export type HashChainState = {
  lastHash: string;
  lastSeq: number;
};

const GENESIS_HASH = "0".repeat(64);

export function hashEvent(eventWithoutHash: Omit<AuditEvent, "hash">): string {
  return createHash("sha256").update(canonicalJson(eventWithoutHash)).digest("hex");
}

export class HashChainWriter {
  private lastHash: string;
  private lastSeq: number;
  private queue: Promise<void>;
  private readonly ready: Promise<void>;

  constructor(
    private readonly filePath: string,
    initialState?: HashChainState,
  ) {
    this.lastHash = initialState?.lastHash ?? GENESIS_HASH;
    this.lastSeq = initialState?.lastSeq ?? -1;

    const dir = path.dirname(filePath);
    this.ready = fs.mkdir(dir, { recursive: true }).then(() => undefined);
    this.queue = this.ready;
  }

  /**
   * Recover state by reading the last line of an existing file.
   * Call this after construction if the file may already contain events.
   */
  static async recover(filePath: string): Promise<HashChainState | undefined> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.trimEnd().split("\n");
      const lastLine = lines[lines.length - 1];
      if (!lastLine) {
        return undefined;
      }
      const event = JSON.parse(lastLine) as AuditEvent;
      return { lastHash: event.hash, lastSeq: event.seq };
    } catch {
      return undefined;
    }
  }

  append(input: AuditEventInput): void {
    // Enqueue: each step runs after the previous finishes
    this.queue = this.queue.then(async () => {
      const seq = this.lastSeq + 1;
      const prevHash = this.lastHash;

      const eventWithoutHash: Omit<AuditEvent, "hash"> = {
        seq,
        prevHash,
        type: input.type,
        timestamp: input.timestamp,
        payload: input.payload,
        ...(input.agentId !== undefined && { agentId: input.agentId }),
        ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
        ...(input.sessionKey !== undefined && { sessionKey: input.sessionKey }),
        ...(input.runId !== undefined && { runId: input.runId }),
        ...(input.toolCallId !== undefined && { toolCallId: input.toolCallId }),
      };

      const hash = hashEvent(eventWithoutHash);
      const event: AuditEvent = { ...eventWithoutHash, hash };

      await fs.appendFile(this.filePath, JSON.stringify(event) + "\n", "utf8");

      this.lastHash = hash;
      this.lastSeq = seq;
    });
  }

  /** Wait for all queued writes to flush. */
  async flush(): Promise<void> {
    await this.queue;
  }

  getState(): HashChainState {
    return { lastHash: this.lastHash, lastSeq: this.lastSeq };
  }
}
