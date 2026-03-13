/**
 * CLI commands for audit-trail: verify, trail, report, search.
 *
 * Registered via api.registerCli under the "audit" subcommand.
 * Usage: openclaw audit <subcommand> [options]
 */

import type { Command } from "commander";
import {
  verifyDirectory,
  readTrail,
  searchEvents,
  generateReport,
  formatReportText,
} from "agent-audit-trail";
import type { AuditTrailConfig } from "agent-audit-trail";

export function registerAuditCli(program: Command, config: AuditTrailConfig): void {
  const audit = program.command("audit").description("Audit trail commands");

  // ---------------------------------------------------------------------------
  // verify
  // ---------------------------------------------------------------------------
  audit
    .command("verify")
    .description("Verify hash chain integrity of all audit log files")
    .option("--dir <logDir>", "Log directory", config.logDir)
    .option("--from <date>", "Start date (YYYY-MM-DD)")
    .option("--to <date>", "End date (YYYY-MM-DD)")
    .option("--json", "Output as JSON")
    .action(async (opts: { dir: string; from?: string; to?: string; json?: boolean }) => {
      const report = await verifyDirectory(opts.dir, { from: opts.from, to: opts.to });

      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        for (const result of report.results) {
          const icon = result.valid ? "✓" : "✗";
          const detail = result.valid
            ? `${result.totalEvents} events`
            : `TAMPERED at seq=${result.tamperedAtSeq ?? "?"} — ${result.error ?? ""}`;
          process.stdout.write(`${icon} ${result.filePath} — ${detail}\n`);
        }
        process.stdout.write(
          `\n${report.validFiles}/${report.checkedFiles} files valid` +
            (report.tamperedFiles > 0 ? ` (${report.tamperedFiles} tampered!)` : "") +
            "\n",
        );
      }

      process.exit(report.tamperedFiles > 0 ? 1 : 0);
    });

  // ---------------------------------------------------------------------------
  // trail
  // ---------------------------------------------------------------------------
  audit
    .command("trail")
    .description("Show the full decision chain for an agent run or session")
    .option("--run <runId>", "Run ID")
    .option("--session <sessionId>", "Session ID")
    .option("--agent <agentId>", "Agent ID")
    .option("--dir <logDir>", "Log directory", config.logDir)
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        run?: string;
        session?: string;
        agent?: string;
        dir: string;
        json?: boolean;
      }) => {
        if (!opts.run && !opts.session && !opts.agent) {
          process.stderr.write("Error: at least one of --run, --session, or --agent is required\n");
          process.exit(1);
        }

        const events = await readTrail(opts.dir, {
          runId: opts.run,
          sessionId: opts.session,
          agentId: opts.agent,
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(events, null, 2) + "\n");
          return;
        }

        if (events.length === 0) {
          process.stdout.write("No events found.\n");
          return;
        }

        process.stdout.write(`Found ${events.length} events:\n\n`);
        for (const ev of events) {
          const ts = ev.timestamp.replace("T", " ").replace("Z", "");
          const runTag = ev.runId ? ` run=${ev.runId}` : "";
          const toolTag =
            "toolName" in (ev.payload as Record<string, unknown>)
              ? ` tool=${(ev.payload as Record<string, unknown>)["toolName"]}`
              : "";
          process.stdout.write(`[${ts}]${runTag} ${ev.type}${toolTag}\n`);
        }
      },
    );

  // ---------------------------------------------------------------------------
  // report
  // ---------------------------------------------------------------------------
  audit
    .command("report")
    .description("Generate a compliance summary report")
    .option("--dir <logDir>", "Log directory", config.logDir)
    .option("--from <date>", "Start date (YYYY-MM-DD)")
    .option("--to <date>", "End date (YYYY-MM-DD)")
    .option("--format <format>", "Output format: text | json | csv", "text")
    .action(
      async (opts: { dir: string; from?: string; to?: string; format: string }) => {
        const report = await generateReport({
          logDir: opts.dir,
          from: opts.from,
          to: opts.to,
        });

        if (opts.format === "json") {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        } else if (opts.format === "csv") {
          // Simple CSV output
          process.stdout.write("type,count\n");
          for (const [type, count] of Object.entries(report.eventsByType)) {
            process.stdout.write(`${type},${count}\n`);
          }
        } else {
          process.stdout.write(formatReportText(report) + "\n");
        }
      },
    );

  // ---------------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------------
  audit
    .command("search")
    .description("Stream-search audit events")
    .option("--dir <logDir>", "Log directory", config.logDir)
    .option("--type <type>", "Event type filter")
    .option("--tool <name>", "Tool name filter")
    .option("--from <ts>", "Start timestamp (ISO)")
    .option("--to <ts>", "End timestamp (ISO)")
    .action(
      async (opts: { dir: string; type?: string; tool?: string; from?: string; to?: string }) => {
        let count = 0;
        await searchEvents(
          opts.dir,
          {
            type: opts.type as import("agent-audit-trail").AuditEventType | undefined,
            toolName: opts.tool,
            from: opts.from,
            to: opts.to,
          },
          (ev) => {
            process.stdout.write(JSON.stringify(ev) + "\n");
            count++;
          },
        );
        if (count === 0) {
          process.stderr.write("No matching events.\n");
        }
      },
    );
}
