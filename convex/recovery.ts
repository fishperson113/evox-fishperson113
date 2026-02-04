/**
 * AGT-216: Auto-Recovery — Self-Healing Agent Restart & Retry
 *
 * Features:
 * - Crash detection via heartbeat timeout (>30 min = crashed)
 * - Auto-restart with exponential backoff (1min, 5min, 15min)
 * - Circuit breaker: stop after 3 consecutive failures
 * - Recovery events logged to activityEvents
 */
import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Configuration
const HEARTBEAT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const BACKOFF_LEVELS_MS = [
  1 * 60 * 1000,   // Level 0: 1 minute
  5 * 60 * 1000,   // Level 1: 5 minutes
  15 * 60 * 1000,  // Level 2: 15 minutes
];
const MAX_CONSECUTIVE_FAILURES = 3; // Circuit breaker threshold
const RECOVERY_WINDOW_MS = 60 * 60 * 1000; // 1 hour — reset restart count after this

// =============================================================================
// Crash Detection
// =============================================================================

/**
 * Detect agents that have crashed (heartbeat timeout exceeded)
 * Returns list of crashed agents with their last heartbeat info
 */
export const detectCrashedAgents = query({
  handler: async (ctx) => {
    const now = Date.now();
    const agents = await ctx.db.query("agents").collect();

    const crashed = agents.filter((agent) => {
      // Skip offline agents — they're intentionally stopped
      if (agent.status === "offline") return false;

      // Skip agents with circuit breaker tripped — already handled
      if (agent.circuitBreakerTripped) return false;

      // Check heartbeat timeout
      const lastHeartbeat = agent.lastHeartbeat ?? agent.lastSeen;
      const timeSinceHeartbeat = now - lastHeartbeat;

      return timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS;
    });

    return crashed.map((agent) => ({
      id: agent._id,
      name: agent.name,
      status: agent.status,
      lastHeartbeat: agent.lastHeartbeat ?? agent.lastSeen,
      timeSinceHeartbeat: now - (agent.lastHeartbeat ?? agent.lastSeen),
      restartCount: agent.restartCount ?? 0,
      consecutiveFailures: agent.consecutiveFailures ?? 0,
      circuitBreakerTripped: agent.circuitBreakerTripped ?? false,
      recoveryBackoffLevel: agent.recoveryBackoffLevel ?? 0,
    }));
  },
});

/**
 * Internal mutation to check and trigger restarts for crashed agents
 * Called by cron job
 */
export const checkAndRestartCrashedAgents = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const agents = await ctx.db.query("agents").collect();
    const results: Array<{
      agent: string;
      action: "restarted" | "circuit_breaker" | "backoff_wait" | "skipped";
      details?: string;
    }> = [];

    for (const agent of agents) {
      // Skip offline agents
      if (agent.status === "offline") {
        continue;
      }

      // Skip agents with circuit breaker tripped
      if (agent.circuitBreakerTripped) {
        results.push({
          agent: agent.name,
          action: "skipped",
          details: "Circuit breaker tripped",
        });
        continue;
      }

      // Check heartbeat timeout
      const lastHeartbeat = agent.lastHeartbeat ?? agent.lastSeen;
      const timeSinceHeartbeat = now - lastHeartbeat;

      if (timeSinceHeartbeat <= HEARTBEAT_TIMEOUT_MS) {
        continue; // Agent is healthy
      }

      // Agent is crashed — check backoff
      const backoffLevel = agent.recoveryBackoffLevel ?? 0;
      const lastRestart = agent.lastRestartAt ?? 0;
      const backoffTime = BACKOFF_LEVELS_MS[Math.min(backoffLevel, BACKOFF_LEVELS_MS.length - 1)];
      const timeSinceRestart = now - lastRestart;

      if (lastRestart > 0 && timeSinceRestart < backoffTime) {
        // Still in backoff period
        results.push({
          agent: agent.name,
          action: "backoff_wait",
          details: `Waiting ${Math.round((backoffTime - timeSinceRestart) / 1000)}s more`,
        });
        continue;
      }

      // Check consecutive failures for circuit breaker
      const consecutiveFailures = (agent.consecutiveFailures ?? 0) + 1;

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Trip circuit breaker
        await ctx.db.patch(agent._id, {
          circuitBreakerTripped: true,
          consecutiveFailures,
          status: "offline",
          statusReason: `Circuit breaker tripped after ${consecutiveFailures} failures`,
          statusSince: now,
        });

        // Log circuit breaker event
        await ctx.db.insert("activityEvents", {
          agentId: agent._id,
          agentName: agent.name.toLowerCase(),
          category: "system",
          eventType: "circuit_breaker_tripped",
          title: `${agent.name} circuit breaker tripped`,
          description: `Stopped after ${consecutiveFailures} consecutive failures. Manual intervention required.`,
          metadata: {
            source: "auto_recovery",
            errorMessage: `${consecutiveFailures} consecutive restart failures`,
          },
          timestamp: now,
        });

        // Create critical alert
        await ctx.db.insert("alerts", {
          type: "agent_failed",
          severity: "critical",
          channel: "telegram",
          title: `${agent.name} Circuit Breaker Tripped`,
          message: `Agent stopped after ${consecutiveFailures} consecutive failures. Manual restart required.`,
          agentName: agent.name.toLowerCase(),
          status: "pending",
          createdAt: now,
        });

        results.push({
          agent: agent.name,
          action: "circuit_breaker",
          details: `Stopped after ${consecutiveFailures} failures`,
        });
        continue;
      }

      // Reset restart count if outside recovery window
      let restartCount = agent.restartCount ?? 0;
      if (lastRestart > 0 && timeSinceRestart > RECOVERY_WINDOW_MS) {
        restartCount = 0;
      }

      // Perform restart
      const newBackoffLevel = Math.min((agent.recoveryBackoffLevel ?? 0) + 1, BACKOFF_LEVELS_MS.length - 1);

      await ctx.db.patch(agent._id, {
        status: "idle",
        statusReason: `Auto-recovery restart (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
        statusSince: now,
        lastHeartbeat: now,
        lastSeen: now,
        restartCount: restartCount + 1,
        lastRestartAt: now,
        consecutiveFailures,
        recoveryBackoffLevel: newBackoffLevel,
        currentTask: undefined, // Clear stuck task
      });

      // Log recovery event
      await ctx.db.insert("activityEvents", {
        agentId: agent._id,
        agentName: agent.name.toLowerCase(),
        category: "system",
        eventType: "auto_restart",
        title: `${agent.name} auto-restarted`,
        description: `Recovery attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}. Next backoff: ${BACKOFF_LEVELS_MS[newBackoffLevel] / 1000}s`,
        metadata: {
          source: "auto_recovery",
        },
        timestamp: now,
      });

      // Create warning alert
      await ctx.db.insert("alerts", {
        type: "agent_failed",
        severity: consecutiveFailures >= 2 ? "warning" : "info",
        channel: "telegram",
        title: `${agent.name} Auto-Restarted`,
        message: `Agent restarted after heartbeat timeout. Attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}.`,
        agentName: agent.name.toLowerCase(),
        status: "pending",
        createdAt: now,
      });

      results.push({
        agent: agent.name,
        action: "restarted",
        details: `Attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}, backoff level ${newBackoffLevel}`,
      });
    }

    return { timestamp: now, results };
  },
});

// =============================================================================
// Recovery Success/Failure Reporting
// =============================================================================

/**
 * Report successful recovery — agent is healthy again
 * Resets consecutive failures and backoff level
 */
export const reportRecoverySuccess = mutation({
  args: {
    agentName: v.string(),
  },
  handler: async (ctx, { agentName }) => {
    const now = Date.now();
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", agentName.toUpperCase()))
      .first();

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    const wasRecovering = (agent.consecutiveFailures ?? 0) > 0;

    await ctx.db.patch(agent._id, {
      consecutiveFailures: 0,
      recoveryBackoffLevel: 0,
      lastHeartbeat: now,
      lastSeen: now,
    });

    if (wasRecovering) {
      await ctx.db.insert("activityEvents", {
        agentId: agent._id,
        agentName: agentName.toLowerCase(),
        category: "system",
        eventType: "recovery_success",
        title: `${agentName.toUpperCase()} recovered successfully`,
        description: `Agent is healthy after auto-recovery. Reset failure counters.`,
        metadata: {
          source: "auto_recovery",
        },
        timestamp: now,
      });
    }

    return { success: true, wasRecovering };
  },
});

/**
 * Report recovery failure — agent failed again after restart
 */
export const reportRecoveryFailure = mutation({
  args: {
    agentName: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { agentName, error }) => {
    const now = Date.now();
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", agentName.toUpperCase()))
      .first();

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    const consecutiveFailures = (agent.consecutiveFailures ?? 0) + 1;

    await ctx.db.patch(agent._id, {
      consecutiveFailures,
      status: "offline",
      statusReason: `Recovery failed: ${error}`,
      statusSince: now,
    });

    await ctx.db.insert("activityEvents", {
      agentId: agent._id,
      agentName: agentName.toLowerCase(),
      category: "system",
      eventType: "recovery_failure",
      title: `${agentName.toUpperCase()} recovery failed`,
      description: `Error: ${error}. Failures: ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`,
      metadata: {
        source: "auto_recovery",
        errorMessage: error,
      },
      timestamp: now,
    });

    return { success: true, consecutiveFailures };
  },
});

// =============================================================================
// Circuit Breaker Management
// =============================================================================

/**
 * Reset circuit breaker for an agent (manual intervention)
 */
export const resetCircuitBreaker = mutation({
  args: {
    agentName: v.string(),
  },
  handler: async (ctx, { agentName }) => {
    const now = Date.now();
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", agentName.toUpperCase()))
      .first();

    if (!agent) {
      return { success: false, error: "Agent not found" };
    }

    if (!agent.circuitBreakerTripped) {
      return { success: false, error: "Circuit breaker not tripped" };
    }

    await ctx.db.patch(agent._id, {
      circuitBreakerTripped: false,
      consecutiveFailures: 0,
      recoveryBackoffLevel: 0,
      restartCount: 0,
      lastRestartAt: undefined,
      status: "idle",
      statusReason: "Circuit breaker reset manually",
      statusSince: now,
      lastHeartbeat: now,
      lastSeen: now,
    });

    await ctx.db.insert("activityEvents", {
      agentId: agent._id,
      agentName: agentName.toLowerCase(),
      category: "system",
      eventType: "circuit_breaker_reset",
      title: `${agentName.toUpperCase()} circuit breaker reset`,
      description: `Manual intervention — agent ready for work`,
      metadata: {
        source: "manual",
      },
      timestamp: now,
    });

    return { success: true, agentId: agent._id };
  },
});

/**
 * Get recovery status for all agents
 */
export const getRecoveryStatus = query({
  handler: async (ctx) => {
    const now = Date.now();
    const agents = await ctx.db.query("agents").collect();

    return agents.map((agent) => {
      const lastHeartbeat = agent.lastHeartbeat ?? agent.lastSeen;
      const timeSinceHeartbeat = now - lastHeartbeat;
      const isHealthy = timeSinceHeartbeat <= HEARTBEAT_TIMEOUT_MS;

      return {
        name: agent.name,
        status: agent.status,
        isHealthy,
        timeSinceHeartbeat,
        restartCount: agent.restartCount ?? 0,
        consecutiveFailures: agent.consecutiveFailures ?? 0,
        circuitBreakerTripped: agent.circuitBreakerTripped ?? false,
        recoveryBackoffLevel: agent.recoveryBackoffLevel ?? 0,
        nextBackoffMs: BACKOFF_LEVELS_MS[agent.recoveryBackoffLevel ?? 0] ?? BACKOFF_LEVELS_MS[0],
        lastRestartAt: agent.lastRestartAt ?? null,
      };
    });
  },
});

/**
 * Get recovery events log for debugging
 */
export const getRecoveryEvents = query({
  args: {
    limit: v.optional(v.number()),
    agentName: v.optional(v.string()),
  },
  handler: async (ctx, { limit, agentName }) => {
    const recoveryEventTypes = [
      "auto_restart",
      "circuit_breaker_tripped",
      "circuit_breaker_reset",
      "recovery_success",
      "recovery_failure",
    ];

    let eventsQuery = ctx.db
      .query("activityEvents")
      .withIndex("by_category", (q) => q.eq("category", "system"))
      .order("desc");

    const events = await eventsQuery.take(limit ?? 50);

    // Filter to recovery events only
    let filtered = events.filter((e) => recoveryEventTypes.includes(e.eventType));

    // Filter by agent if specified
    if (agentName) {
      filtered = filtered.filter((e) => e.agentName === agentName.toLowerCase());
    }

    return filtered.map((e) => ({
      id: e._id,
      agentName: e.agentName,
      eventType: e.eventType,
      title: e.title,
      description: e.description,
      timestamp: e.timestamp,
      metadata: e.metadata,
    }));
  },
});

// =============================================================================
// Internal Action for Cron
// =============================================================================

/**
 * Internal action wrapper for cron job
 * Checks system state and runs recovery check
 */
export const runRecoveryCheck: ReturnType<typeof internalAction> = internalAction({
  handler: async (ctx): Promise<{ skipped: true; reason: string } | { results: unknown[] }> => {
    // Check if system is paused (kill switch)
    const systemState = await ctx.runQuery(api.system.getSystemState);
    if (systemState.paused) {
      console.log("[Recovery] System paused, skipping check");
      return { skipped: true, reason: "system_paused" };
    }

    // Run recovery check
    const result = await ctx.runMutation(internal.recovery.checkAndRestartCrashedAgents);

    const actions = result.results.filter((r: any) => r.action !== "skipped");
    if (actions.length > 0) {
      console.log(`[Recovery] Actions taken:`, actions);
    }

    return result;
  },
});
