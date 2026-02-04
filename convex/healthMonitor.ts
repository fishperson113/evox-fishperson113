/**
 * AGT-250: Website Health Monitor — AUTONOMOUS Self-Healing
 *
 * Monitors:
 * - Vercel frontend: https://evox-ten.vercel.app
 * - Convex API: https://gregarious-elk-556.convex.site/status
 *
 * Self-Healing Flow:
 * 1. Detect issue → Create event for MAX
 * 2. MAX evaluates → Dispatches Sam/Leo to fix
 * 3. Agent attempts fix → Reports result
 * 4. If still broken after 3 attempts → THEN alert Son (last resort)
 *
 * NO HUMAN IN THE LOOP unless absolutely necessary.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// URLs to monitor
const HEALTH_ENDPOINTS = [
  {
    name: "Vercel Frontend",
    url: "https://evox-ten.vercel.app",
    timeout: 10000,
  },
  {
    name: "Convex API",
    url: "https://gregarious-elk-556.convex.site/status",
    timeout: 5000,
  },
];

// Human alert only after N failed auto-fix attempts
const MAX_AUTO_FIX_ATTEMPTS = 3;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

interface HealthCheckResult {
  name: string;
  url: string;
  status: "up" | "down" | "slow";
  httpCode?: number;
  responseTime?: number;
  error?: string;
}

/**
 * Check a single endpoint health
 */
async function checkEndpoint(endpoint: { name: string; url: string; timeout: number }): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);

    const response = await fetch(endpoint.url, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return {
        name: endpoint.name,
        url: endpoint.url,
        status: "down",
        httpCode: response.status,
        responseTime,
        error: `HTTP ${response.status}`,
      };
    }

    // Slow if > 5 seconds
    if (responseTime > 5000) {
      return {
        name: endpoint.name,
        url: endpoint.url,
        status: "slow",
        httpCode: response.status,
        responseTime,
      };
    }

    return {
      name: endpoint.name,
      url: endpoint.url,
      status: "up",
      httpCode: response.status,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      name: endpoint.name,
      url: endpoint.url,
      status: "down",
      responseTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send Telegram alert
 */
async function sendTelegramAlert(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[HealthMonitor] Telegram not configured, skipping alert");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("[HealthMonitor] Telegram alert failed:", error);
    return false;
  }
}

/**
 * Get last health status from settings
 */
export const getLastHealthStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "health_status"))
      .first();

    return setting?.value as { lastCheck: number; statuses: Record<string, string> } | null;
  },
});

/**
 * Save health status to settings
 */
export const saveHealthStatus = internalMutation({
  args: {
    statuses: v.any(),
  },
  handler: async (ctx, { statuses }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "health_status"))
      .first();

    const value = {
      lastCheck: Date.now(),
      statuses,
    };

    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        key: "health_status",
        value,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Create auto-fix dispatch for Sam to investigate downtime
 */
export const createAutoFixDispatch = internalMutation({
  args: {
    endpoint: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { endpoint, error }) => {
    // Find Sam agent
    const sam = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", "SAM"))
      .first();

    if (!sam) {
      console.log("[HealthMonitor] Sam agent not found, cannot auto-dispatch");
      return null;
    }

    // Create dispatch for Sam to investigate
    const dispatchId = await ctx.db.insert("dispatches", {
      agentId: sam._id,
      command: "investigate_downtime",
      payload: JSON.stringify({
        endpoint,
        error,
        timestamp: Date.now(),
      }),
      priority: 0, // URGENT
      isUrgent: true,
      status: "pending",
      createdAt: Date.now(),
    });

    console.log(`[HealthMonitor] Created auto-fix dispatch ${dispatchId} for Sam`);
    return dispatchId;
  },
});

/**
 * Log health event to alerts table
 */
export const logHealthAlert = internalMutation({
  args: {
    type: v.union(v.literal("down"), v.literal("recovered"), v.literal("slow")),
    endpoint: v.string(),
    message: v.string(),
    httpCode: v.optional(v.number()),
    responseTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("alerts", {
      type: "agent_failed", // Reuse existing type for now
      severity: args.type === "down" ? "critical" : "warning",
      channel: "telegram",
      title: `[HEALTH] ${args.endpoint} ${args.type.toUpperCase()}`,
      message: args.message,
      status: "sent",
      createdAt: Date.now(),
    });
  },
});

/**
 * Main health check action (called by cron every 1 minute)
 */
export const checkWebsite = internalAction({
  handler: async (ctx) => {
    console.log("[HealthMonitor] Starting health check...");

    // Get previous status to detect changes
    const previousStatus = await ctx.runQuery(internal.healthMonitor.getLastHealthStatus);
    const previousStatuses = previousStatus?.statuses ?? {};

    // Check all endpoints
    const results: HealthCheckResult[] = [];
    for (const endpoint of HEALTH_ENDPOINTS) {
      const result = await checkEndpoint(endpoint);
      results.push(result);
      console.log(`[HealthMonitor] ${result.name}: ${result.status} (${result.responseTime}ms)`);
    }

    // Build current status map
    const currentStatuses: Record<string, string> = {};
    for (const result of results) {
      currentStatuses[result.name] = result.status;
    }

    // Detect status changes and alert
    for (const result of results) {
      const prevStatus = previousStatuses[result.name];
      const currStatus = result.status;

      // DOWN alert — Notify MAX (agent) first, not human
      if (currStatus === "down" && prevStatus !== "down") {
        // 1. Log to alerts table
        await ctx.runMutation(internal.healthMonitor.logHealthAlert, {
          type: "down",
          endpoint: result.name,
          message: result.error || `HTTP ${result.httpCode}`,
          httpCode: result.httpCode,
          responseTime: result.responseTime,
        });

        // 2. Fire event to MAX for autonomous handling
        await ctx.scheduler.runAfter(0, internal.agentEvents.publishEvent, {
          type: "system_alert",
          targetAgent: "max",
          payload: {
            message: `🔴 WEBSITE DOWN: ${result.name} - ${result.error || `HTTP ${result.httpCode}`}`,
            priority: "urgent",
            metadata: {
              alertType: "health_check_failed",
              endpoint: result.name,
              url: result.url,
              error: result.error,
              httpCode: result.httpCode,
            },
          },
        });

        // 3. Auto-create dispatch for Sam to investigate
        await ctx.runMutation(internal.healthMonitor.createAutoFixDispatch, {
          endpoint: result.name,
          error: result.error || `HTTP ${result.httpCode}`,
        });

        // 4. Create P0 bug ticket in Linear
        const errorMsg = result.error || `HTTP ${result.httpCode}`;
        const ticketResult = await ctx.runAction(internal.webhooks.createLinearBugTicket, {
          title: `[P0] ${result.name} Down — ${errorMsg}`,
          description: `## 🔴 Website Health Monitor Alert\n\n` +
            `**Service:** ${result.name}\n` +
            `**URL:** ${result.url}\n` +
            `**Status:** DOWN\n` +
            `**Error:** ${errorMsg}\n` +
            `**HTTP Code:** ${result.httpCode || "N/A"}\n` +
            `**Response Time:** ${result.responseTime}ms\n` +
            `**Detected At:** ${new Date().toISOString()}\n\n` +
            `## Next Steps\n\n` +
            `1. Check Vercel deployment logs\n` +
            `2. Check Convex dashboard for errors\n` +
            `3. Verify DNS and SSL certificates\n` +
            `4. Monitor recovery status\n\n` +
            `Auto-dispatched to Sam for investigation.`,
        });

        if (ticketResult.success) {
          console.log(`[HealthMonitor] Created Linear ticket: ${ticketResult.ticketId}`);
        }

        console.log(`[HealthMonitor] ALERT: ${result.name} is DOWN! → Notified MAX, dispatched Sam, created ticket.`);
      }

      // RECOVERED alert
      if (currStatus === "up" && prevStatus === "down") {
        const message = `🟢 <b>EVOX RECOVERED</b>\n\n` +
          `<b>Service:</b> ${result.name}\n` +
          `<b>URL:</b> ${result.url}\n` +
          `<b>Response:</b> ${result.responseTime}ms\n` +
          `<b>Time:</b> ${new Date().toISOString()}\n\n` +
          `✅ Service is back online!`;

        await sendTelegramAlert(message);
        await ctx.runMutation(internal.healthMonitor.logHealthAlert, {
          type: "recovered",
          endpoint: result.name,
          message: `Recovered after downtime`,
          httpCode: result.httpCode,
          responseTime: result.responseTime,
        });

        console.log(`[HealthMonitor] RECOVERED: ${result.name} is back up!`);
      }

      // SLOW alert (only once, not repeating)
      if (currStatus === "slow" && prevStatus !== "slow") {
        const message = `🟡 <b>EVOX SLOW</b>\n\n` +
          `<b>Service:</b> ${result.name}\n` +
          `<b>Response:</b> ${result.responseTime}ms\n` +
          `<b>Time:</b> ${new Date().toISOString()}\n\n` +
          `⚠️ Performance degradation detected.`;

        await sendTelegramAlert(message);
        await ctx.runMutation(internal.healthMonitor.logHealthAlert, {
          type: "slow",
          endpoint: result.name,
          message: `Slow response: ${result.responseTime}ms`,
          responseTime: result.responseTime,
        });

        console.log(`[HealthMonitor] SLOW: ${result.name} response time ${result.responseTime}ms`);
      }
    }

    // Save current status
    await ctx.runMutation(internal.healthMonitor.saveHealthStatus, {
      statuses: currentStatuses,
    });

    return {
      success: true,
      timestamp: Date.now(),
      results: results.map((r) => ({
        name: r.name,
        status: r.status,
        responseTime: r.responseTime,
      })),
    };
  },
});

/**
 * Manual health check trigger (for testing)
 */
export const triggerHealthCheck = internalAction({
  handler: async (ctx) => {
    return await ctx.runAction(internal.healthMonitor.checkWebsite);
  },
});
