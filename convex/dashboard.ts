/**
 * AGT-150: Dashboard Stats Query
 *
 * Provides aggregated stats for the dashboard overview:
 * - Agent counts (active vs total)
 * - Task counts by status
 * - Last sync time
 */
import { query } from "./_generated/server";

// Agent is "active" if lastSeen within 5 minutes
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Get dashboard stats for overview
 * @returns {
 *   agentsActive: number,
 *   agentsTotal: number,
 *   taskCounts: { backlog, todo, inProgress, review, done },
 *   lastSyncTime: number | null
 * }
 */
export const getStats = query({
  handler: async (ctx) => {
    const now = Date.now();

    // Get agents (max 10 - we only have 3)
    const agents = await ctx.db.query("agents").take(10);
    const agentsTotal = agents.length;
    const agentsActive = agents.filter(
      (a) => a.lastSeen > now - ACTIVE_THRESHOLD_MS
    ).length;

    // Count tasks by status using index queries (no full table scan)
    // FIX: Collect all done tasks for accurate count (was .take(100) causing mismatch)
    const [backlog, todo, inProgress, review, done] = await Promise.all([
      ctx.db.query("tasks").withIndex("by_status", q => q.eq("status", "backlog")).collect(),
      ctx.db.query("tasks").withIndex("by_status", q => q.eq("status", "todo")).collect(),
      ctx.db.query("tasks").withIndex("by_status", q => q.eq("status", "in_progress")).collect(),
      ctx.db.query("tasks").withIndex("by_status", q => q.eq("status", "review")).collect(),
      ctx.db.query("tasks").withIndex("by_status", q => q.eq("status", "done")).collect(),
    ]);
    const taskCounts = {
      backlog: backlog.length,
      todo: todo.length,
      inProgress: inProgress.length,
      review: review.length,
      done: done.length,
    };

    // Get last sync time from settings or most recent sync event
    const syncSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "lastSyncTime"))
      .first();

    let lastSyncTime: number | null = null;
    if (syncSetting?.value && typeof syncSetting.value === "number") {
      lastSyncTime = syncSetting.value;
    } else {
      // Fallback: check most recent sync activity event
      const syncEvents = await ctx.db
        .query("activityEvents")
        .withIndex("by_category", (q) => q.eq("category", "system"))
        .order("desc")
        .take(10);

      const lastSync = syncEvents.find(
        (e) =>
          e.eventType === "sync_completed" ||
          e.eventType === "sync_started" ||
          (e.metadata?.source === "linear_sync")
      );

      if (lastSync) {
        lastSyncTime = lastSync.timestamp;
      }
    }

    return {
      agentsActive,
      agentsTotal,
      taskCounts,
      lastSyncTime,
    };
  },
});
