/**
 * Offline verifier for audit trail JSONL files.
 *
 * Reads every line, recomputes the hash, and checks:
 *   1. hash == SHA-256(canonicalJson(event_without_hash))
 *   2. prevHash == hash of previous event (or all-zeros for seq 0)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { hashEvent } from "./hash-chain.js";
import type { AuditEvent } from "./types.js";
import type { FileVerificationResult, VerificationReport } from "./types.js";

export async function verifyFile(filePath: string): Promise<FileVerificationResult> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    return {
      filePath,
      valid: false,
      totalEvents: 0,
      error: `Cannot read file: ${String(err)}`,
    };
  }

  const lines = content.trimEnd().split("\n").filter(Boolean);
  let prevHash = "0".repeat(64);

  for (let i = 0; i < lines.length; i++) {
    let event: AuditEvent;
    try {
      event = JSON.parse(lines[i]!) as AuditEvent;
    } catch {
      return {
        filePath,
        valid: false,
        totalEvents: i,
        tamperedAtSeq: i,
        error: `Line ${i} is not valid JSON`,
      };
    }

    // Check prevHash linkage
    if (event.prevHash !== prevHash) {
      return {
        filePath,
        valid: false,
        totalEvents: lines.length,
        tamperedAtSeq: event.seq,
        error: `prevHash mismatch at seq ${event.seq}`,
      };
    }

    // Recompute hash
    const { hash, ...withoutHash } = event;
    const expected = hashEvent(withoutHash);
    if (hash !== expected) {
      return {
        filePath,
        valid: false,
        totalEvents: lines.length,
        tamperedAtSeq: event.seq,
        error: `Hash mismatch at seq ${event.seq}: stored ${hash}, expected ${expected}`,
      };
    }

    prevHash = hash;
  }

  return { filePath, valid: true, totalEvents: lines.length };
}

export async function verifyDirectory(
  logDir: string,
  opts?: { from?: string; to?: string },
): Promise<VerificationReport> {
  // Find all *.jsonl files excluding the index
  const allFiles: string[] = [];
  try {
    // Use readdir recursively to find JSONL files
    await collectJsonlFiles(logDir, allFiles);
  } catch {
    // Directory may not exist yet
  }

  const auditFiles = allFiles
    .filter((f) => !f.endsWith("index.jsonl"))
    .filter((f) => {
      if (!opts?.from && !opts?.to) {
        return true;
      }
      // Extract date from path for filtering
      const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) {
        return true;
      }
      const fileDate = dateMatch[1]!;
      if (opts.from && fileDate < opts.from) {
        return false;
      }
      if (opts.to && fileDate > opts.to) {
        return false;
      }
      return true;
    });

  const results = await Promise.all(auditFiles.map((f) => verifyFile(f)));

  const validFiles = results.filter((r) => r.valid).length;
  const tamperedFiles = results.filter((r) => !r.valid).length;

  return {
    checkedFiles: results.length,
    validFiles,
    tamperedFiles,
    results,
  };
}

async function collectJsonlFiles(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsonlFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(fullPath);
    }
  }
}
