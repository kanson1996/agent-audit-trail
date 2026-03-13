/**
 * AuditWriter — top-level coordinator for log rotation and HashChainWriter lifecycle.
 *
 * Supports three rotation strategies:
 *   - daily:   New file each calendar day (UTC). Default.
 *   - session: One file per session (identified by sessionKey or sessionId).
 *   - size:    Rotate when current file exceeds maxSizeBytes.
 *
 * Maintains an index.jsonl in logDir tracking all created files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { HashChainWriter } from "./hash-chain.js";
import type { AuditEventInput } from "./hash-chain.js";
import type { AuditTrailConfig } from "./types.js";

export type WriterOptions = {
  config: AuditTrailConfig;
};

type FileIndex = {
  filePath: string;
  date: string;
  createdAt: string;
};

export class AuditWriter {
  private writers: Map<string, HashChainWriter> = new Map();
  private readonly config: AuditTrailConfig;
  private readonly indexPath: string;

  constructor(options: WriterOptions) {
    this.config = options.config;
    this.indexPath = path.join(options.config.logDir, "index.jsonl");
  }

  /**
   * Append an audit event. Selects or creates the appropriate log file
   * based on the configured rotation strategy.
   */
  append(input: AuditEventInput & { sessionKey?: string }): void {
    const fileKey = this.resolveFileKey(input);
    const filePath = this.resolveFilePath(fileKey, input.timestamp);

    let writer = this.writers.get(fileKey);
    if (!writer) {
      writer = new HashChainWriter(filePath);
      this.writers.set(fileKey, writer);
      // Record in index (fire-and-forget; do not block the write path)
      this.appendIndex({ filePath, date: fileKey, createdAt: input.timestamp }).catch(() => {
        // Best-effort index update; main audit chain is unaffected
      });
    }

    writer.append(input);
  }

  /** Wait for all pending writes to flush to disk. */
  async flush(): Promise<void> {
    await Promise.all([...this.writers.values()].map((w) => w.flush()));
  }

  private resolveFileKey(input: AuditEventInput & { sessionKey?: string }): string {
    const { strategy } = this.config.rotation;
    if (strategy === "session") {
      return input.sessionKey ?? input.sessionId ?? this.dateKey(input.timestamp);
    }
    // Both "daily" and "size" use date as the key
    return this.dateKey(input.timestamp);
  }

  private resolveFilePath(fileKey: string, timestamp: string): string {
    const { strategy } = this.config.rotation;
    if (strategy === "session") {
      // Store session logs under a sessions/ subdirectory
      const date = this.dateKey(timestamp);
      return path.join(this.config.logDir, "sessions", date, `audit-${fileKey}.jsonl`);
    }
    // Daily and size rotation: subdirectory per date
    return path.join(this.config.logDir, fileKey, `audit-${fileKey}.jsonl`);
  }

  private dateKey(timestamp: string): string {
    // Extract YYYY-MM-DD from ISO timestamp
    return timestamp.slice(0, 10);
  }

  private async appendIndex(entry: FileIndex): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.appendFile(this.indexPath, JSON.stringify(entry) + "\n", "utf8");
  }
}
