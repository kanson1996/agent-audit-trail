/**
 * Trail reader — reconstructs the decision chain for a specific
 * runId, sessionId, or agentId by scanning audit JSONL files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AuditEvent } from "./types.js";

export type TrailFilter = {
  runId?: string;
  sessionId?: string;
  agentId?: string;
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
};

export type SearchFilter = {
  type?: AuditEvent["type"];
  toolName?: string;
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
};

/**
 * Read all events matching the given filter from the log directory.
 * Returns events sorted by (seq) within each file, then by timestamp across files.
 */
export async function readTrail(logDir: string, filter: TrailFilter): Promise<AuditEvent[]> {
  const files = await collectJsonlFiles(logDir);
  const matching: AuditEvent[] = [];

  for (const filePath of files) {
    if (filePath.endsWith("index.jsonl")) {
      continue;
    }
    const events = await readFile(filePath);
    for (const ev of events) {
      if (filter.runId && ev.runId !== filter.runId) {
        continue;
      }
      if (filter.sessionId && ev.sessionId !== filter.sessionId) {
        continue;
      }
      if (filter.agentId && ev.agentId !== filter.agentId) {
        continue;
      }
      if (filter.from && ev.timestamp < filter.from) {
        continue;
      }
      if (filter.to && ev.timestamp > filter.to) {
        continue;
      }
      matching.push(ev);
    }
  }

  return matching.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Stream-search events matching a filter. Callback receives each match.
 */
export async function searchEvents(
  logDir: string,
  filter: SearchFilter,
  onMatch: (event: AuditEvent) => void,
): Promise<void> {
  const files = await collectJsonlFiles(logDir);

  for (const filePath of files) {
    if (filePath.endsWith("index.jsonl")) {
      continue;
    }
    const events = await readFile(filePath);
    for (const ev of events) {
      if (filter.type && ev.type !== filter.type) {
        continue;
      }
      if (filter.from && ev.timestamp < filter.from) {
        continue;
      }
      if (filter.to && ev.timestamp > filter.to) {
        continue;
      }
      if (filter.toolName) {
        const payload = ev.payload as Record<string, unknown>;
        if (payload["toolName"] !== filter.toolName) {
          continue;
        }
      }
      onMatch(ev);
    }
  }
}

async function readFile(filePath: string): Promise<AuditEvent[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .trimEnd()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEvent);
  } catch {
    return [];
  }
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    await recurse(dir, out);
  } catch {
    // Directory may not exist
  }
  return out.sort();
}

async function recurse(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await recurse(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(fullPath);
    }
  }
}
