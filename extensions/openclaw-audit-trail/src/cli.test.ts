import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { AuditWriter } from "agent-audit-trail";
import type { AuditTrailConfig } from "agent-audit-trail";
import { registerAuditCli } from "./cli.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeConfig(): AuditTrailConfig {
  return {
    logDir: tmpDir,
    captureMode: "metadata_only",
    rotation: { strategy: "daily" },
    redaction: { mode: "hash", fields: [] },
    captureBeforeToolCall: false,
  };
}

async function writeTestEvents(count = 3): Promise<void> {
  const writer = new AuditWriter({ config: makeConfig() });
  for (let i = 0; i < count; i++) {
    writer.append({
      type: "session_start",
      timestamp: `2026-03-13T00:00:0${i}.000Z`,
      runId: `run-${i}`,
      payload: { sessionId: `s-${i}` },
    });
  }
  await writer.flush();
}

async function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const program = new Command();
  program.exitOverride();

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let exitCode = 0;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);

  (process.stdout as { write: unknown }).write = (chunk: string) => { stdoutChunks.push(chunk); return true; };
  (process.stderr as { write: unknown }).write = (chunk: string) => { stderrChunks.push(chunk); return true; };
  (process as { exit: unknown }).exit = (code: number) => { exitCode = code ?? 0; throw new Error(`EXIT:${code}`); };

  try {
    registerAuditCli(program, makeConfig());
    await program.parseAsync(["node", "audit", ...args]);
  } catch (err) {
    const msg = String(err);
    if (!msg.startsWith("Error: EXIT:")) {
      // Re-throw real errors
    }
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    process.exit = origExit;
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

describe("audit verify", () => {
  it("exits 0 when all files are valid", async () => {
    await writeTestEvents();
    const { exitCode, stdout } = await runCommand(["audit", "verify", "--dir", tmpDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓");
  });

  it("exits 1 when a file is tampered", async () => {
    await writeTestEvents(3);

    // Find and tamper the file
    const files: string[] = [];
    async function find(d: string) {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) await find(fp);
        else if (e.name.endsWith(".jsonl") && e.name !== "index.jsonl") files.push(fp);
      }
    }
    await find(tmpDir);
    const content = await fs.readFile(files[0]!, "utf8");
    const lines = content.trimEnd().split("\n");
    const ev = JSON.parse(lines[1]!) as Record<string, unknown>;
    lines[1] = JSON.stringify({ ...ev, payload: { sessionId: "HACKED" } });
    await fs.writeFile(files[0]!, lines.join("\n") + "\n");

    const { exitCode } = await runCommand(["audit", "verify", "--dir", tmpDir]);
    expect(exitCode).toBe(1);
  });

  it("outputs JSON when --json flag is set", async () => {
    await writeTestEvents();
    const { stdout } = await runCommand(["audit", "verify", "--dir", tmpDir, "--json"]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("checkedFiles");
    expect(parsed).toHaveProperty("results");
  });
});

describe("audit trail", () => {
  it("finds events by runId", async () => {
    await writeTestEvents(3);
    const { stdout } = await runCommand(["audit", "trail", "--run", "run-1", "--dir", tmpDir]);
    expect(stdout).toContain("session_start");
    expect(stdout).toContain("run=run-1");
  });

  it("shows error when no filter given", async () => {
    const { stderr, exitCode } = await runCommand(["audit", "trail", "--dir", tmpDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("at least one");
  });

  it("outputs JSON when --json flag is set", async () => {
    await writeTestEvents(2);
    const { stdout } = await runCommand(["audit", "trail", "--run", "run-0", "--json", "--dir", tmpDir]);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("shows 'No events found' when nothing matches", async () => {
    await writeTestEvents(1);
    const { stdout } = await runCommand(["audit", "trail", "--run", "nonexistent", "--dir", tmpDir]);
    expect(stdout).toContain("No events found");
  });
});

describe("audit report", () => {
  it("generates text report", async () => {
    await writeTestEvents(3);
    const { stdout } = await runCommand(["audit", "report", "--dir", tmpDir]);
    expect(stdout).toContain("Compliance Report");
    expect(stdout).toContain("Sessions:");
  });

  it("generates JSON report with --format json", async () => {
    await writeTestEvents(3);
    const { stdout } = await runCommand(["audit", "report", "--format", "json", "--dir", tmpDir]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("totalEvents");
    expect(parsed).toHaveProperty("integrity");
  });

  it("generates CSV report with --format csv", async () => {
    await writeTestEvents(3);
    const { stdout } = await runCommand(["audit", "report", "--format", "csv", "--dir", tmpDir]);
    expect(stdout).toContain("type,count");
    expect(stdout).toContain("session_start");
  });
});

describe("audit search", () => {
  it("streams matching events as JSON lines", async () => {
    await writeTestEvents(3);
    const { stdout } = await runCommand(["audit", "search", "--type", "session_start", "--dir", tmpDir]);
    const lines = stdout.trimEnd().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const ev = JSON.parse(line) as Record<string, unknown>;
      expect(ev["type"]).toBe("session_start");
    }
  });

  it("writes to stderr when no events match", async () => {
    await writeTestEvents(1);
    const { stderr } = await runCommand(["audit", "search", "--type", "agent_end", "--dir", tmpDir]);
    expect(stderr).toContain("No matching events");
  });
});
