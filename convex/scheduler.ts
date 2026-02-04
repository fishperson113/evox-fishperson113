import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalAction,
  ActionCtx,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Type for template execution context
type SchedulerCtx = {
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
};

// =============================================================================
// AGT-214: Cron Scheduler — Schedule Agent Tasks
// =============================================================================

// Task template types
export const TASK_TEMPLATES = {
  daily_standup: {
    name: "Daily Standup",
    description: "Generate and send daily standup summary to Son",
    defaultCron: "0 18 * * *", // 6 PM UTC daily
    targetAgent: "max",
  },
  weekly_report: {
    name: "Weekly Report",
    description: "Generate weekly progress report with metrics",
    defaultCron: "0 18 * * 5", // 6 PM UTC on Fridays
    targetAgent: "max",
  },
  backlog_grooming: {
    name: "Backlog Grooming",
    description: "Prioritize unassigned tasks and clean stale items",
    defaultCron: "0 9 * * 1", // 9 AM UTC on Mondays
    targetAgent: "max",
  },
  health_check: {
    name: "Health Check",
    description: "Check agent health, uptime, and error rates",
    defaultCron: "0 */6 * * *", // Every 6 hours
    targetAgent: undefined, // System task
  },
  custom: {
    name: "Custom Task",
    description: "User-defined scheduled task",
    defaultCron: "0 12 * * *",
    targetAgent: undefined,
  },
} as const;

// =============================================================================
// Cron Expression Parser (simplified for common patterns)
// =============================================================================

/**
 * Parse cron expression and calculate next run time
 * Supports: minute hour day month weekday
 * Examples: "0 18 * * *" (daily 6 PM), "0 9 * * 1" (Mondays 9 AM)
 */
function parseNextRun(cronExpression: string, fromTime: number = Date.now()): number {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    // Default to 1 hour from now if invalid
    return fromTime + 60 * 60 * 1000;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const now = new Date(fromTime);

  // Start from next minute
  const next = new Date(now);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Try up to 400 days to find next match
  for (let attempts = 0; attempts < 400 * 24 * 60; attempts++) {
    const matches =
      matchField(minute, next.getMinutes()) &&
      matchField(hour, next.getHours()) &&
      matchField(dayOfMonth, next.getDate()) &&
      matchField(month, next.getMonth() + 1) &&
      matchDayOfWeek(dayOfWeek, next.getDay());

    if (matches) {
      return next.getTime();
    }

    // Advance by 1 minute
    next.setMinutes(next.getMinutes() + 1);
  }

  // Fallback: 24 hours from now
  return fromTime + 24 * 60 * 60 * 1000;
}

function matchField(pattern: string, value: number): boolean {
  if (pattern === "*") return true;

  // Handle step values: */5 means every 5
  if (pattern.startsWith("*/")) {
    const step = parseInt(pattern.slice(2), 10);
    return value % step === 0;
  }

  // Handle ranges: 1-5
  if (pattern.includes("-")) {
    const [start, end] = pattern.split("-").map((n) => parseInt(n, 10));
    return value >= start && value <= end;
  }

  // Handle lists: 0,15,30,45
  if (pattern.includes(",")) {
    const values = pattern.split(",").map((n) => parseInt(n, 10));
    return values.includes(value);
  }

  // Exact match
  return parseInt(pattern, 10) === value;
}

function matchDayOfWeek(pattern: string, value: number): boolean {
  // Sunday is 0 in JS, but can be 0 or 7 in cron
  if (pattern === "*") return true;

  const normalized = value === 0 ? 7 : value; // Normalize Sunday to 7

  if (pattern.includes(",")) {
    const values = pattern.split(",").map((n) => {
      const v = parseInt(n, 10);
      return v === 0 ? 7 : v;
    });
    return values.includes(normalized) || values.includes(value);
  }

  const patternVal = parseInt(pattern, 10);
  return patternVal === value || patternVal === normalized;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * List all schedules
 */
export const listSchedules = query({
  args: {
    enabledOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { enabledOnly }) => {
    let schedules = await ctx.db.query("schedules").order("desc").collect();

    if (enabledOnly) {
      schedules = schedules.filter((s) => s.enabled);
    }

    return schedules.map((s) => ({
      ...s,
      templateInfo: TASK_TEMPLATES[s.taskTemplate],
    }));
  },
});

/**
 * Get a single schedule by ID
 */
export const getSchedule = query({
  args: { id: v.id("schedules") },
  handler: async (ctx, { id }) => {
    const schedule = await ctx.db.get(id);
    if (!schedule) return null;

    return {
      ...schedule,
      templateInfo: TASK_TEMPLATES[schedule.taskTemplate],
    };
  },
});

/**
 * Get schedule by name
 */
export const getScheduleByName = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const schedule = await ctx.db
      .query("schedules")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();

    if (!schedule) return null;

    return {
      ...schedule,
      templateInfo: TASK_TEMPLATES[schedule.taskTemplate],
    };
  },
});

/**
 * Get upcoming scheduled runs
 */
export const getUpcomingRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const schedules = await ctx.db
      .query("schedules")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();

    // Filter to those with nextRun in the future
    const upcoming = schedules
      .filter((s) => s.nextRun && s.nextRun > now)
      .sort((a, b) => (a.nextRun ?? 0) - (b.nextRun ?? 0))
      .slice(0, limit ?? 10);

    return upcoming.map((s) => ({
      id: s._id,
      name: s.name,
      taskTemplate: s.taskTemplate,
      nextRun: s.nextRun,
      cronExpression: s.cronExpression,
      targetAgent: s.targetAgent,
    }));
  },
});

/**
 * Get available task templates
 */
export const getTaskTemplates = query({
  handler: async () => {
    return Object.entries(TASK_TEMPLATES).map(([key, value]) => ({
      id: key,
      ...value,
    }));
  },
});

// =============================================================================
// Mutations
// =============================================================================

/**
 * Create a new schedule
 */
export const createSchedule = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    taskTemplate: v.union(
      v.literal("daily_standup"),
      v.literal("weekly_report"),
      v.literal("backlog_grooming"),
      v.literal("health_check"),
      v.literal("custom")
    ),
    cronExpression: v.optional(v.string()),
    timezone: v.optional(v.string()),
    targetAgent: v.optional(v.string()),
    customConfig: v.optional(
      v.object({
        action: v.optional(v.string()),
        payload: v.optional(v.string()),
      })
    ),
    enabled: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if name already exists
    const existing = await ctx.db
      .query("schedules")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (existing) {
      throw new Error(`Schedule with name "${args.name}" already exists`);
    }

    const template = TASK_TEMPLATES[args.taskTemplate];
    const cronExpression = args.cronExpression ?? template.defaultCron;
    const nextRun = parseNextRun(cronExpression, now);

    const id = await ctx.db.insert("schedules", {
      name: args.name,
      description: args.description ?? template.description,
      taskTemplate: args.taskTemplate,
      cronExpression,
      timezone: args.timezone,
      targetAgent: args.targetAgent ?? template.targetAgent,
      customConfig: args.customConfig,
      enabled: args.enabled ?? true,
      nextRun,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    // If enabled, schedule the first run
    if (args.enabled !== false) {
      await ctx.scheduler.runAt(nextRun, internal.scheduler.executeSchedule, {
        scheduleId: id,
      });
    }

    return { id, nextRun };
  },
});

/**
 * Update a schedule
 */
export const updateSchedule = mutation({
  args: {
    id: v.id("schedules"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    cronExpression: v.optional(v.string()),
    timezone: v.optional(v.string()),
    targetAgent: v.optional(v.string()),
    customConfig: v.optional(
      v.object({
        action: v.optional(v.string()),
        payload: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.id);
    if (!schedule) throw new Error("Schedule not found");

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.name !== undefined) {
      // Check for name conflicts
      const existing = await ctx.db
        .query("schedules")
        .withIndex("by_name", (q) => q.eq("name", args.name!))
        .first();
      if (existing && existing._id !== args.id) {
        throw new Error(`Schedule with name "${args.name}" already exists`);
      }
      updates.name = args.name;
    }

    if (args.description !== undefined) updates.description = args.description;
    if (args.timezone !== undefined) updates.timezone = args.timezone;
    if (args.targetAgent !== undefined) updates.targetAgent = args.targetAgent;
    if (args.customConfig !== undefined) updates.customConfig = args.customConfig;

    if (args.cronExpression !== undefined) {
      updates.cronExpression = args.cronExpression;
      // Recalculate next run
      if (schedule.enabled) {
        updates.nextRun = parseNextRun(args.cronExpression, now);
      }
    }

    await ctx.db.patch(args.id, updates);

    return { id: args.id };
  },
});

/**
 * Toggle schedule enabled/disabled
 */
export const toggleSchedule = mutation({
  args: {
    id: v.id("schedules"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { id, enabled }) => {
    const schedule = await ctx.db.get(id);
    if (!schedule) throw new Error("Schedule not found");

    const now = Date.now();
    const updates: Record<string, unknown> = {
      enabled,
      updatedAt: now,
    };

    if (enabled) {
      // Calculate next run and schedule it
      const nextRun = parseNextRun(schedule.cronExpression, now);
      updates.nextRun = nextRun;

      await ctx.scheduler.runAt(nextRun, internal.scheduler.executeSchedule, {
        scheduleId: id,
      });
    } else {
      // Clear next run
      updates.nextRun = undefined;
    }

    await ctx.db.patch(id, updates);

    return { id, enabled, nextRun: updates.nextRun };
  },
});

/**
 * Delete a schedule
 */
export const deleteSchedule = mutation({
  args: { id: v.id("schedules") },
  handler: async (ctx, { id }) => {
    const schedule = await ctx.db.get(id);
    if (!schedule) throw new Error("Schedule not found");

    await ctx.db.delete(id);

    return { deleted: true, name: schedule.name };
  },
});

/**
 * Manually trigger a schedule (run now)
 */
export const triggerSchedule = mutation({
  args: { id: v.id("schedules") },
  handler: async (ctx, { id }) => {
    const schedule = await ctx.db.get(id);
    if (!schedule) throw new Error("Schedule not found");

    // Schedule immediate execution
    await ctx.scheduler.runAt(
      Date.now(),
      internal.scheduler.executeSchedule,
      { scheduleId: id }
    );

    return { triggered: true, name: schedule.name };
  },
});

// =============================================================================
// Internal: Schedule Execution
// =============================================================================

/**
 * Execute a scheduled task (called by Convex scheduler)
 */
export const executeSchedule: ReturnType<typeof internalAction> = internalAction({
  args: { scheduleId: v.id("schedules") },
  handler: async (ctx, { scheduleId }): Promise<{ success: boolean; error?: string; result?: unknown }> => {
    // Get schedule
    const schedule = await ctx.runQuery(api.scheduler.getSchedule, {
      id: scheduleId,
    });

    if (!schedule) {
      console.log(`[Scheduler] Schedule ${scheduleId} not found, skipping`);
      return { success: false, error: "schedule_not_found" };
    }

    if (!schedule.enabled) {
      console.log(`[Scheduler] Schedule ${schedule.name} is disabled, skipping`);
      await ctx.runMutation(internal.scheduler.updateScheduleStatus, {
        id: scheduleId,
        status: "skipped",
      });
      return { success: false, error: "schedule_disabled" };
    }

    // Check if system is paused
    const systemState = await ctx.runQuery(api.system.getSystemState);
    if (systemState.paused) {
      console.log(`[Scheduler] System paused, skipping ${schedule.name}`);
      await ctx.runMutation(internal.scheduler.updateScheduleStatus, {
        id: scheduleId,
        status: "skipped",
        error: "system_paused",
      });
      return { success: false, error: "system_paused" };
    }

    console.log(`[Scheduler] Executing ${schedule.name} (${schedule.taskTemplate})`);

    try {
      // Execute based on template
      let result: unknown;

      switch (schedule.taskTemplate) {
        case "daily_standup":
          result = await ctx.runAction(internal.standup.generateDailyStandup, {});
          break;

        case "weekly_report":
          result = await executeWeeklyReport(ctx);
          break;

        case "backlog_grooming":
          result = await executeBacklogGrooming(ctx);
          break;

        case "health_check":
          result = await executeHealthCheck(ctx);
          break;

        case "custom":
          result = await executeCustomTask(ctx, schedule.customConfig);
          break;
      }

      // Update schedule with success status
      await ctx.runMutation(internal.scheduler.updateScheduleStatus, {
        id: scheduleId,
        status: "success",
      });

      // Schedule next run
      await ctx.runMutation(internal.scheduler.scheduleNextRun, {
        id: scheduleId,
      });

      console.log(`[Scheduler] ${schedule.name} completed successfully`);
      return { success: true, result };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`[Scheduler] ${schedule.name} failed:`, errorMessage);

      // Update schedule with failure status
      await ctx.runMutation(internal.scheduler.updateScheduleStatus, {
        id: scheduleId,
        status: "failed",
        error: errorMessage,
      });

      // Still schedule next run
      await ctx.runMutation(internal.scheduler.scheduleNextRun, {
        id: scheduleId,
      });

      return { success: false, error: errorMessage };
    }
  },
});

/**
 * Update schedule status after execution
 */
export const updateScheduleStatus = internalMutation({
  args: {
    id: v.id("schedules"),
    status: v.union(v.literal("success"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, error }) => {
    const now = Date.now();

    await ctx.db.patch(id, {
      lastRun: now,
      lastRunStatus: status,
      lastRunError: error,
      updatedAt: now,
    });
  },
});

/**
 * Schedule the next run for a schedule
 */
export const scheduleNextRun = internalMutation({
  args: { id: v.id("schedules") },
  handler: async (ctx, { id }) => {
    const schedule = await ctx.db.get(id);
    if (!schedule || !schedule.enabled) return;

    const now = Date.now();
    const nextRun = parseNextRun(schedule.cronExpression, now);

    await ctx.db.patch(id, {
      nextRun,
      updatedAt: now,
    });

    // Schedule the next execution
    await ctx.scheduler.runAt(nextRun, internal.scheduler.executeSchedule, {
      scheduleId: id,
    });
  },
});

// =============================================================================
// Template Execution Functions
// =============================================================================

/**
 * Execute weekly report template
 */
async function executeWeeklyReport(
  ctx: SchedulerCtx
): Promise<{ success: boolean; report: string }> {
  // Get 7-day standup data
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const summary = await ctx.runQuery(api.standup.getDailySummary, {
    startTs: weekAgo,
    endTs: now,
  });

  const weekDate = new Date().toISOString().split("T")[0];
  const report = `# 📊 EVOX Weekly Report — Week of ${weekDate}

## Summary
- **Tasks Completed:** ${summary.tasksCompleted}
- **In Progress:** ${summary.tasksInProgress}
- **Backlog:** ${summary.tasksBacklog}
- **Blocked:** ${summary.tasksBlocked}
- **Active Agents:** ${summary.agentsActive}/3
- **Messages:** ${summary.messagesSent}

---
_Auto-generated by EVOX Scheduler_`;

  // Send to Son via DM
  await ctx.runMutation(api.messaging.sendDM, {
    from: "max",
    to: "son",
    content: report,
    priority: "normal",
  });

  return { success: true, report };
}

/**
 * Execute backlog grooming template
 */
async function executeBacklogGrooming(
  ctx: SchedulerCtx
): Promise<{ success: boolean; tasksReviewed: number; suggestions: string[] }> {
  // Get all backlog/todo tasks
  const tasks = await ctx.runQuery(api.tasks.getByStatus, {
    status: "backlog",
  });

  const todoTasks = await ctx.runQuery(api.tasks.getByStatus, {
    status: "todo",
  });

  const allTasks = [...tasks, ...todoTasks];
  const suggestions: string[] = [];

  // Identify stale tasks (not updated in 7+ days)
  const now = Date.now();
  const staleThreshold = 7 * 24 * 60 * 60 * 1000;

  const staleTasks = allTasks.filter((t) => now - t.updatedAt > staleThreshold);
  if (staleTasks.length > 0) {
    suggestions.push(
      `${staleTasks.length} tasks haven't been updated in 7+ days`
    );
  }

  // Identify unassigned high-priority tasks
  const unassignedUrgent = allTasks.filter(
    (t) => !t.assignee && (t.priority === "urgent" || t.priority === "high")
  );
  if (unassignedUrgent.length > 0) {
    suggestions.push(
      `${unassignedUrgent.length} high-priority tasks are unassigned`
    );
  }

  // Send grooming report if there are suggestions
  if (suggestions.length > 0) {
    await ctx.runMutation(api.messaging.sendDM, {
      from: "max",
      to: "son",
      content: `## 🧹 Backlog Grooming Report

### Findings
${suggestions.map((s) => `- ${s}`).join("\n")}

### Action Needed
Review and prioritize these tasks.

---
_Auto-generated by EVOX Scheduler_`,
      priority: "normal",
    });
  }

  return {
    success: true,
    tasksReviewed: allTasks.length,
    suggestions,
  };
}

/**
 * Execute health check template
 */
async function executeHealthCheck(
  ctx: SchedulerCtx
): Promise<{ success: boolean; healthStatus: Record<string, unknown> }> {
  // Get agent statuses
  const agents = await ctx.runQuery(api.agents.list);

  const now = Date.now();
  const offlineThreshold = 30 * 60 * 1000; // 30 minutes

  const healthStatus: Record<string, unknown> = {
    timestamp: now,
    agents: agents.map((a: any) => ({
      name: a.name,
      status: a.status,
      lastHeartbeat: a.lastHeartbeat,
      isHealthy:
        a.status !== "offline" &&
        (!a.lastHeartbeat || now - a.lastHeartbeat < offlineThreshold),
    })),
  };

  // Check for unhealthy agents
  const unhealthy = agents.filter(
    (a: any) =>
      a.status === "offline" ||
      (a.lastHeartbeat && now - a.lastHeartbeat > offlineThreshold)
  );

  if (unhealthy.length > 0) {
    await ctx.runMutation(api.messaging.sendDM, {
      from: "max",
      to: "son",
      content: `## ⚠️ Health Check Alert

The following agents are unhealthy:
${unhealthy.map((a: any) => `- **${a.name}**: ${a.status} (last seen: ${a.lastHeartbeat ? new Date(a.lastHeartbeat).toISOString() : "never"})`).join("\n")}

---
_Auto-generated by EVOX Scheduler_`,
      priority: "urgent",
    });
  }

  return { success: true, healthStatus };
}

/**
 * Execute custom task template
 */
async function executeCustomTask(
  _ctx: SchedulerCtx,
  config?: { action?: string; payload?: string }
): Promise<{ success: boolean; action?: string }> {
  if (!config?.action) {
    return { success: true, action: "noop" };
  }

  // Log custom task execution
  console.log(`[Scheduler] Custom task: ${config.action}`);

  return { success: true, action: config.action };
}

// =============================================================================
// Initialization: Create default schedules
// =============================================================================

/**
 * Initialize default schedules (run once during setup)
 */
export const initializeDefaultSchedules = mutation({
  handler: async (ctx) => {
    const now = Date.now();
    const created: string[] = [];

    // Check which schedules already exist
    const existing = await ctx.db.query("schedules").collect();
    const existingNames = new Set(existing.map((s) => s.name));

    // Default schedules to create
    const defaults = [
      {
        name: "daily-standup",
        taskTemplate: "daily_standup" as const,
        cronExpression: "0 18 * * *",
        description: "Generate daily standup summary at 6 PM UTC",
      },
      {
        name: "weekly-report",
        taskTemplate: "weekly_report" as const,
        cronExpression: "0 18 * * 5",
        description: "Generate weekly progress report on Fridays at 6 PM UTC",
      },
      {
        name: "backlog-grooming",
        taskTemplate: "backlog_grooming" as const,
        cronExpression: "0 9 * * 1",
        description: "Groom backlog on Mondays at 9 AM UTC",
      },
    ];

    for (const schedule of defaults) {
      if (existingNames.has(schedule.name)) continue;

      const nextRun = parseNextRun(schedule.cronExpression, now);

      const id = await ctx.db.insert("schedules", {
        name: schedule.name,
        description: schedule.description,
        taskTemplate: schedule.taskTemplate,
        cronExpression: schedule.cronExpression,
        targetAgent: TASK_TEMPLATES[schedule.taskTemplate].targetAgent,
        enabled: true,
        nextRun,
        createdBy: "system",
        createdAt: now,
        updatedAt: now,
      });

      // Schedule the first run
      await ctx.scheduler.runAt(nextRun, internal.scheduler.executeSchedule, {
        scheduleId: id,
      });

      created.push(schedule.name);
    }

    return { created, total: defaults.length };
  },
});
