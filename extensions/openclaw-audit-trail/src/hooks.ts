/**
 * OpenClaw hook registrations for audit-trail.
 *
 * All hooks are registered as observers (void return) to avoid
 * interfering with agent behavior. Maps each lifecycle event to
 * an AuditEvent and queues it through AuditWriter.
 */

import { AuditWriter, contentHash } from "agent-audit-trail";
import type { AuditTrailConfig } from "agent-audit-trail";

// We import from the OpenClaw plugin SDK via the extension's peer dep.
// In tests, this is mocked. In production, openclaw resolves this.
type PluginApi = {
  on: (hookName: string, handler: (...args: unknown[]) => unknown) => void;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

export function registerHooks(api: PluginApi, writer: AuditWriter, config: AuditTrailConfig): void {
  const { captureMode, enabledEvents, captureBeforeToolCall } = config;
  const isEnabled = (type: string): boolean =>
    !enabledEvents || (enabledEvents as string[]).includes(type);
  const ts = () => new Date().toISOString();

  // -------------------------------------------------------------------------
  // session_start
  // -------------------------------------------------------------------------
  if (isEnabled("session_start")) {
    api.on("session_start", (event: unknown, ctx: unknown) => {
      const ev = event as { sessionId: string; sessionKey?: string; resumedFrom?: string };
      const c = ctx as { agentId?: string; sessionId?: string; sessionKey?: string };
      try {
        writer.append({
          type: "session_start",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: ev.sessionId,
          sessionKey: ev.sessionKey,
          payload: {
            sessionId: ev.sessionId,
            sessionKey: ev.sessionKey,
            resumedFrom: ev.resumedFrom,
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: session_start write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // session_end
  // -------------------------------------------------------------------------
  if (isEnabled("session_end")) {
    api.on("session_end", (event: unknown, ctx: unknown) => {
      const ev = event as { sessionId: string; sessionKey?: string; messageCount: number; durationMs?: number };
      const c = ctx as { agentId?: string };
      try {
        writer.append({
          type: "session_end",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: ev.sessionId,
          sessionKey: ev.sessionKey,
          payload: {
            sessionId: ev.sessionId,
            sessionKey: ev.sessionKey,
            messageCount: ev.messageCount,
            durationMs: ev.durationMs,
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: session_end write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // message_received
  // -------------------------------------------------------------------------
  if (isEnabled("message_received")) {
    api.on("message_received", (event: unknown, ctx: unknown) => {
      const ev = event as { from: string; content: string };
      const c = ctx as { channelId: string };
      try {
        const contentLength = ev.content?.length ?? 0;
        writer.append({
          type: "message_received",
          timestamp: ts(),
          payload: {
            from: ev.from,
            channelId: c.channelId,
            contentLength,
            ...(captureMode === "full_capture" ? { content: ev.content } : {}),
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: message_received write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // message_sent
  // -------------------------------------------------------------------------
  if (isEnabled("message_sent")) {
    api.on("message_sent", (event: unknown, ctx: unknown) => {
      const ev = event as { to: string; content: string; success: boolean; error?: string };
      const c = ctx as { channelId: string };
      try {
        const contentLength = ev.content?.length ?? 0;
        writer.append({
          type: "message_sent",
          timestamp: ts(),
          payload: {
            to: ev.to,
            channelId: c.channelId,
            success: ev.success,
            error: ev.error,
            contentLength,
            ...(captureMode === "full_capture" ? { content: ev.content } : {}),
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: message_sent write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // llm_input
  // -------------------------------------------------------------------------
  if (isEnabled("llm_input")) {
    api.on("llm_input", (event: unknown, ctx: unknown) => {
      const ev = event as {
        runId: string;
        sessionId: string;
        provider: string;
        model: string;
        systemPrompt?: string;
        prompt: string;
        historyMessages: unknown[];
      };
      const c = ctx as { agentId?: string; sessionKey?: string };
      try {
        writer.append({
          type: "llm_input",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: ev.sessionId,
          sessionKey: c.sessionKey,
          runId: ev.runId,
          payload: {
            provider: ev.provider,
            model: ev.model,
            historyMessageCount: ev.historyMessages?.length ?? 0,
            systemPromptHash: ev.systemPrompt ? contentHash(ev.systemPrompt) : undefined,
            ...(captureMode === "full_capture" ? { prompt: ev.prompt } : {}),
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: llm_input write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // llm_output
  // -------------------------------------------------------------------------
  if (isEnabled("llm_output")) {
    api.on("llm_output", (event: unknown, ctx: unknown) => {
      const ev = event as {
        runId: string;
        sessionId: string;
        provider: string;
        model: string;
        assistantTexts: string[];
        usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
      };
      const c = ctx as { agentId?: string; sessionKey?: string };
      try {
        const assistantText = ev.assistantTexts?.join("") ?? "";
        writer.append({
          type: "llm_output",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: ev.sessionId,
          sessionKey: c.sessionKey,
          runId: ev.runId,
          payload: {
            provider: ev.provider,
            model: ev.model,
            assistantTextLength: assistantText.length,
            usage: ev.usage,
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: llm_output write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // before_tool_call (opt-in)
  // -------------------------------------------------------------------------
  if (captureBeforeToolCall && isEnabled("tool_call_before")) {
    api.on("before_tool_call", (event: unknown, ctx: unknown) => {
      const ev = event as { toolName: string; params: Record<string, unknown>; runId?: string; toolCallId?: string };
      const c = ctx as { agentId?: string; sessionKey?: string; sessionId?: string };
      try {
        writer.append({
          type: "tool_call_before",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: c.sessionId,
          sessionKey: c.sessionKey,
          runId: ev.runId,
          toolCallId: ev.toolCallId,
          payload: {
            toolName: ev.toolName,
            paramsHash: contentHash(JSON.stringify(ev.params)),
            ...(captureMode === "full_capture" ? { params: ev.params } : {}),
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: before_tool_call write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // after_tool_call
  // -------------------------------------------------------------------------
  if (isEnabled("tool_call_after")) {
    api.on("after_tool_call", (event: unknown, ctx: unknown) => {
      const ev = event as {
        toolName: string;
        params: Record<string, unknown>;
        runId?: string;
        toolCallId?: string;
        result?: unknown;
        error?: string;
        durationMs?: number;
      };
      const c = ctx as { agentId?: string; sessionKey?: string; sessionId?: string };
      try {
        const success = !ev.error;
        const resultStr = ev.result !== undefined ? JSON.stringify(ev.result) : undefined;
        writer.append({
          type: "tool_call_after",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: c.sessionId,
          sessionKey: c.sessionKey,
          runId: ev.runId,
          toolCallId: ev.toolCallId,
          payload: {
            toolName: ev.toolName,
            durationMs: ev.durationMs,
            success,
            error: ev.error,
            resultHash: resultStr ? contentHash(resultStr) : undefined,
            ...(captureMode === "full_capture" && ev.result !== undefined
              ? { result: ev.result }
              : {}),
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: after_tool_call write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // agent_end
  // -------------------------------------------------------------------------
  if (isEnabled("agent_end")) {
    api.on("agent_end", (event: unknown, ctx: unknown) => {
      const ev = event as { messages: unknown[]; success: boolean; error?: string; durationMs?: number };
      const c = ctx as { agentId?: string; sessionKey?: string; sessionId?: string };
      try {
        writer.append({
          type: "agent_end",
          timestamp: ts(),
          agentId: c.agentId,
          sessionId: c.sessionId,
          sessionKey: c.sessionKey,
          payload: {
            success: ev.success,
            durationMs: ev.durationMs,
            messageCount: ev.messages?.length,
            error: ev.error,
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: agent_end write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // subagent_spawned
  // -------------------------------------------------------------------------
  if (isEnabled("subagent_spawned")) {
    api.on("subagent_spawned", (event: unknown, ctx: unknown) => {
      const ev = event as { childSessionKey: string; agentId: string; mode: "run" | "session"; runId: string };
      const c = ctx as { runId?: string };
      try {
        writer.append({
          type: "subagent_spawned",
          timestamp: ts(),
          runId: ev.runId ?? c.runId,
          payload: {
            childSessionKey: ev.childSessionKey,
            childAgentId: ev.agentId,
            mode: ev.mode,
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: subagent_spawned write failed: ${String(err)}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // subagent_ended
  // -------------------------------------------------------------------------
  if (isEnabled("subagent_ended")) {
    api.on("subagent_ended", (event: unknown, ctx: unknown) => {
      const ev = event as { targetSessionKey: string; outcome?: string; error?: string; runId?: string };
      const c = ctx as { runId?: string };
      try {
        writer.append({
          type: "subagent_ended",
          timestamp: ts(),
          runId: ev.runId ?? c.runId,
          payload: {
            targetSessionKey: ev.targetSessionKey,
            outcome: ev.outcome as "ok" | "error" | "timeout" | "killed" | "reset" | "deleted" | undefined,
            error: ev.error,
          },
        });
      } catch (err) {
        api.logger.warn(`audit-trail: subagent_ended write failed: ${String(err)}`);
      }
    });
  }

  api.logger.info(`audit-trail: hooks registered (mode=${captureMode}, dir=${config.logDir})`);
}
