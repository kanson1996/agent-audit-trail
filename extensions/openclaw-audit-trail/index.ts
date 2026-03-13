/**
 * @kanson1996/audit-trail — OpenClaw Plugin
 *
 * Tamper-evident audit trail for AI Agent lifecycle events.
 *
 * Registers lifecycle hooks that map OpenClaw events → AuditEvents
 * stored in a hash-chained JSONL log. Provides CLI commands for
 * verification, trail reconstruction, and compliance reporting.
 *
 * Plugin config (in openclaw.json):
 * {
 *   "plugins": [{
 *     "path": "@kanson1996/audit-trail",
 *     "config": {
 *       "logDir": "~/.openclaw/audit-trail",
 *       "captureMode": "metadata_only"
 *     }
 *   }]
 * }
 */

import { AuditWriter } from "agent-audit-trail";
import { auditTrailConfigSchema, DEFAULT_CONFIG } from "./src/config.js";
import { registerHooks } from "./src/hooks.js";
import { registerAuditCli } from "./src/cli.js";

// Type stubs for the OpenClaw plugin API (resolved at runtime via openclaw peer dep)
type PluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  on: (hookName: string, handler: (...args: unknown[]) => unknown) => void;
  registerCli: (registrar: (ctx: { program: import("commander").Command }) => void, opts?: { commands?: string[] }) => void;
  registerService: (service: { id: string; start: () => void; stop?: () => void }) => void;
  resolvePath: (p: string) => string;
};

const plugin = {
  id: "audit-trail",
  name: "Audit Trail",
  description: "Tamper-evident audit trail for AI Agent lifecycle events",
  version: "0.1.0",
  configSchema: auditTrailConfigSchema,

  register(api: PluginApi) {
    // Parse and resolve config
    const rawConfig = auditTrailConfigSchema.parse(api.pluginConfig ?? {});
    const config = {
      ...rawConfig,
      logDir: api.resolvePath(rawConfig.logDir),
    };

    const writer = new AuditWriter({ config });

    // Register lifecycle hooks
    registerHooks(api as Parameters<typeof registerHooks>[0], writer, config);

    // Register CLI commands
    api.registerCli(
      ({ program }) => {
        registerAuditCli(program, config);
      },
      { commands: ["audit"] },
    );

    // Register service for clean shutdown
    api.registerService({
      id: "audit-trail",
      start: () => {
        api.logger.info(`audit-trail: started (logDir=${config.logDir}, mode=${config.captureMode})`);
      },
      stop: async () => {
        await writer.flush();
        api.logger.info("audit-trail: flushed and stopped");
      },
    });
  },
};

export default plugin;
