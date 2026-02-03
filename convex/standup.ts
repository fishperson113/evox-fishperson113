import { v } from "convex/values";
import { query, internalMutation, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Get standup report per agent (AGT-134: group by task.agentName, not assignee).
 * AGT-138: Now supports Day/Week/30Days date ranges.
 *
 * Returns breakdown of completed, in-progress, backlog, blocked for each canonical agent (max, sam, leo).
 * - completed: Tasks moved to "done" within the date range
 * - inProgress: Tasks updated within range that are currently in_progress
 * - backlog: Tasks updated within range that are backlog/todo
 * - blocked: Tasks with "blocked" keyword updated within range
 *
 * @param startTs - Start of range (UTC ms). Frontend sends user's local range.
 * @param endTs - End of range (UTC ms).
 */
export const getDaily = query({
  args: {
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Default to today if no range provided
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;

    const rangeStart = args.startTs ?? todayStart;
    const rangeEnd = args.endTs ?? todayEnd;

    // AGT-134: Use agentMappings (max, sam, leo) for column order; group tasks by task.agentName
    const mappings = await ctx.db.query("agentMappings").collect();
    const allTasks = await ctx.db.query("tasks").collect();

    const allActivities = await ctx.db
      .query("activities")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    const activitiesInRange = allActivities.filter(
      (a) => a.createdAt >= rangeStart && a.createdAt <= rangeEnd
    );

    // Task IDs moved to "done" within range (any agent)
    const completedTaskIdsInRange = new Set(
      activitiesInRange
        .filter(
          (a) =>
            a.action === "updated_task_status" &&
            (a.metadata as { to?: string } | undefined)?.to === "done"
        )
        .map((a) => a.target)
    );

    // Task IDs that had ANY activity within range (for inProgress/backlog filtering)
    const taskIdsWithActivityInRange = new Set(
      activitiesInRange
        .filter((a) => a.action === "updated_task_status" || a.action === "created_task")
        .map((a) => a.target)
    );

    // Also include tasks updated within range (by updatedAt timestamp)
    const tasksUpdatedInRange = allTasks.filter(
      (t) => t.updatedAt >= rangeStart && t.updatedAt <= rangeEnd
    );
    tasksUpdatedInRange.forEach((t) => taskIdsWithActivityInRange.add(t._id));

    const agentReports = await Promise.all(
      mappings.map(async (mapping) => {
        const agent = await ctx.db.get(mapping.convexAgentId);
        if (!agent) return null;
        const canonicalName = mapping.name;

        // AGT-134: filter tasks by task.agentName (not assignee)
        const byAgentName = (t: { agentName?: string | null }) =>
          (t.agentName ?? "").toLowerCase() === canonicalName.toLowerCase();

        // Completed: done status AND moved to done within range
        const completedTasks = allTasks.filter(
          (t) =>
            byAgentName(t) &&
            t.status === "done" &&
            completedTaskIdsInRange.has(t._id)
        );

        // In Progress: currently in_progress AND had activity/update in range
        const inProgressTasks = allTasks.filter(
          (t) =>
            byAgentName(t) &&
            t.status === "in_progress" &&
            taskIdsWithActivityInRange.has(t._id)
        );

        // Backlog: backlog/todo AND had activity/update in range
        const backlogTasks = allTasks.filter(
          (t) =>
            byAgentName(t) &&
            (t.status === "backlog" || t.status === "todo") &&
            taskIdsWithActivityInRange.has(t._id)
        );

        // Blocked: has "blocked" keyword AND had activity/update in range
        const blockedTasks = allTasks.filter(
          (t) =>
            byAgentName(t) &&
            taskIdsWithActivityInRange.has(t._id) &&
            (t.title.toLowerCase().includes("blocked") ||
              t.description.toLowerCase().includes("blocked"))
        );

        const rangeActivities = activitiesInRange.filter(
          (a) => a.agent === agent._id
        ).length;

        return {
          agent: {
            id: agent._id,
            name: agent.name,
            role: agent.role,
            avatar: agent.avatar,
            status: agent.status,
          },
          completed: completedTasks.map((t) => ({
            id: t._id,
            title: t.title,
            priority: t.priority,
            linearIdentifier: t.linearIdentifier,
          })),
          inProgress: inProgressTasks.map((t) => ({
            id: t._id,
            title: t.title,
            priority: t.priority,
            linearIdentifier: t.linearIdentifier,
          })),
          backlog: backlogTasks.map((t) => ({
            id: t._id,
            title: t.title,
            priority: t.priority,
            linearIdentifier: t.linearIdentifier,
          })),
          blocked: blockedTasks.map((t) => ({
            id: t._id,
            title: t.title,
            priority: t.priority,
            linearIdentifier: t.linearIdentifier,
          })),
          activityCount: rangeActivities,
        };
      })
    );

    return {
      startTs: rangeStart,
      endTs: rangeEnd,
      agents: agentReports.filter((r): r is NonNullable<typeof r> => r != null),
    };
  },
});

/**
 * Get standup summary with aggregate stats for a date range.
 * AGT-138: Now supports Day/Week/30Days date ranges.
 *
 * Returns overall metrics for the selected range:
 * - tasksCompleted: Tasks moved to "done" within range
 * - tasksInProgress: Tasks updated within range that are currently in_progress
 * - tasksBacklog: Tasks updated within range that are backlog/todo
 *
 * @param startTs - Start of range (UTC ms). Frontend sends user's local range.
 * @param endTs - End of range (UTC ms).
 */
export const getDailySummary = query({
  args: {
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Default to today if no range provided
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;

    const rangeStart = args.startTs ?? todayStart;
    const rangeEnd = args.endTs ?? todayEnd;

    // Get all tasks
    const allTasks = await ctx.db.query("tasks").collect();

    // Get activities for the range
    const allActivitiesForSummary = await ctx.db
      .query("activities")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    const activitiesInRange = allActivitiesForSummary.filter(
      (a) => a.createdAt >= rangeStart && a.createdAt <= rangeEnd
    );

    // Count unique agents active in range
    const activeAgentIds = new Set(activitiesInRange.map((a) => a.agent));

    // Tasks completed in range (moved to "done" status)
    const completedTaskIds = activitiesInRange
      .filter(
        (a) => a.action === "updated_task_status" && a.metadata?.to === "done"
      )
      .map((a) => a.target);
    const tasksCompleted = new Set(completedTaskIds).size;

    // Task IDs with activity in range (for filtering inProgress/backlog)
    const taskIdsWithActivityInRange = new Set(
      activitiesInRange
        .filter((a) => a.action === "updated_task_status" || a.action === "created_task")
        .map((a) => a.target)
    );
    // Also include tasks updated within range
    allTasks
      .filter((t) => t.updatedAt >= rangeStart && t.updatedAt <= rangeEnd)
      .forEach((t) => taskIdsWithActivityInRange.add(t._id));

    // Tasks currently in progress AND had activity in range
    const tasksInProgress = allTasks.filter(
      (t) => t.status === "in_progress" && taskIdsWithActivityInRange.has(t._id)
    ).length;

    // Backlog = backlog/todo AND had activity in range
    const tasksBacklog = allTasks.filter(
      (t) =>
        (t.status === "backlog" || t.status === "todo") &&
        taskIdsWithActivityInRange.has(t._id)
    ).length;

    // Blocked = "blocked" keyword AND had activity in range
    const tasksBlocked = allTasks.filter(
      (t) =>
        taskIdsWithActivityInRange.has(t._id) &&
        (t.title.toLowerCase().includes("blocked") ||
          t.description.toLowerCase().includes("blocked"))
    ).length;

    // Messages sent in range
    const messagesSent = activitiesInRange.filter(
      (a) => a.action === "sent_message"
    ).length;

    // Total activities in range
    const totalActivities = activitiesInRange.length;

    return {
      startTs: rangeStart,
      endTs: rangeEnd,
      totalActivities,
      tasksCompleted,
      tasksInProgress,
      tasksBacklog,
      tasksBlocked,
      agentsActive: activeAgentIds.size,
      messagesSent,
    };
  },
});

// ============================================================
// AGT-120: Auto Daily Standup Generation + Push to Son
// ============================================================

/**
 * Format a single agent's standup as markdown
 */
function formatAgentStandup(
  agentReport: {
    agent: { name: string; role: string };
    completed: { title: string; linearIdentifier?: string }[];
    inProgress: { title: string; linearIdentifier?: string }[];
    backlog: { title: string; linearIdentifier?: string }[];
    blocked: { title: string; linearIdentifier?: string }[];
  },
  date: string
): string {
  const { agent, completed, inProgress, backlog, blocked } = agentReport;
  const lines: string[] = [];

  lines.push(`# ${agent.name.toUpperCase()} Daily Standup — ${date}`);
  lines.push("");

  // Completed
  lines.push(`## ✅ Completed (${completed.length})`);
  if (completed.length > 0) {
    completed.forEach((t) => {
      const id = t.linearIdentifier ?? "";
      lines.push(`- ${id ? `[${id}] ` : ""}${t.title}`);
    });
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  // In Progress
  lines.push(`## 🔄 In Progress (${inProgress.length})`);
  if (inProgress.length > 0) {
    inProgress.forEach((t) => {
      const id = t.linearIdentifier ?? "";
      lines.push(`- ${id ? `[${id}] ` : ""}${t.title}`);
    });
  } else {
    lines.push("- (none)");
  }
  lines.push("");

  // Blocked
  if (blocked.length > 0) {
    lines.push(`## 🚫 Blocked (${blocked.length})`);
    blocked.forEach((t) => {
      const id = t.linearIdentifier ?? "";
      lines.push(`- ${id ? `[${id}] ` : ""}${t.title}`);
    });
    lines.push("");
  }

  // Backlog (queue for tomorrow)
  lines.push(`## 📋 Queue (${backlog.length})`);
  if (backlog.length > 0) {
    backlog.slice(0, 5).forEach((t) => {
      const id = t.linearIdentifier ?? "";
      lines.push(`- ${id ? `[${id}] ` : ""}${t.title}`);
    });
    if (backlog.length > 5) {
      lines.push(`- ... and ${backlog.length - 5} more`);
    }
  } else {
    lines.push("- (none)");
  }

  return lines.join("\n");
}

/**
 * Format system-wide standup summary for Son
 */
function formatSystemSummary(
  standupData: {
    agents: {
      agent: { name: string };
      completed: unknown[];
      inProgress: unknown[];
      blocked: unknown[];
    }[];
  },
  summary: {
    tasksCompleted: number;
    tasksInProgress: number;
    tasksBacklog: number;
    tasksBlocked: number;
    agentsActive: number;
  },
  date: string
): string {
  const lines: string[] = [];

  lines.push(`# 📊 EVOX Daily Standup — ${date}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- **Completed:** ${summary.tasksCompleted} tasks`);
  lines.push(`- **In Progress:** ${summary.tasksInProgress} tasks`);
  lines.push(`- **Backlog:** ${summary.tasksBacklog} tasks`);
  lines.push(`- **Blocked:** ${summary.tasksBlocked} tasks`);
  lines.push(`- **Active Agents:** ${summary.agentsActive}/3`);
  lines.push("");

  lines.push("## Per-Agent Breakdown");
  for (const agentReport of standupData.agents) {
    const name = agentReport.agent.name.toUpperCase();
    const done = agentReport.completed.length;
    const wip = agentReport.inProgress.length;
    const blocked = agentReport.blocked.length;
    const status = blocked > 0 ? "🚫 BLOCKED" : wip > 0 ? "🔄 Working" : done > 0 ? "✅ Done" : "💤 Idle";
    lines.push(`- **${name}**: ${done} done, ${wip} in progress ${status}`);
  }
  lines.push("");

  // Blockers section if any
  const allBlocked = standupData.agents.flatMap((a) =>
    (a.blocked as { title: string; linearIdentifier?: string }[]).map((t) => ({
      agent: a.agent.name,
      ...t,
    }))
  );
  if (allBlocked.length > 0) {
    lines.push("## ⚠️ Blockers Requiring Attention");
    allBlocked.forEach((b) => {
      const id = b.linearIdentifier ?? "";
      lines.push(`- [${b.agent.toUpperCase()}] ${id ? `${id}: ` : ""}${b.title}`);
    });
    lines.push("");
  }

  lines.push("---");
  lines.push("_Auto-generated by EVOX Standup System_");

  return lines.join("\n");
}

/**
 * Save daily note for an agent (internal mutation)
 */
export const saveDailyNote = internalMutation({
  args: {
    agentId: v.id("agents"),
    content: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if daily note already exists for this date
    const existing = await ctx.db
      .query("agentMemory")
      .withIndex("by_agent_type", (q) =>
        q.eq("agentId", args.agentId).eq("type", "daily")
      )
      .collect();

    const existingNote = existing.find((m) => m.date === args.date);

    if (existingNote) {
      // Update existing note
      await ctx.db.patch(existingNote._id, {
        content: args.content,
        updatedAt: now,
        version: existingNote.version + 1,
      });
      return { id: existingNote._id, created: false };
    }

    // Create new note
    const id = await ctx.db.insert("agentMemory", {
      agentId: args.agentId,
      type: "daily",
      content: args.content,
      date: args.date,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    return { id, created: true };
  },
});

/**
 * Notify Son with daily standup summary (internal mutation)
 * Creates a system notification + unified message
 */
export const notifySon = internalMutation({
  args: {
    content: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find MAX agent (system sender)
    const maxAgent = await ctx.db
      .query("agents")
      .withIndex("by_name", (q) => q.eq("name", "MAX"))
      .first();

    if (!maxAgent) {
      console.log("[Standup] MAX agent not found, skipping notification");
      return { success: false };
    }

    // Create unified message to Son
    await ctx.db.insert("unifiedMessages", {
      fromAgent: "max",
      toAgent: "son",
      content: args.content,
      type: "system",
      priority: "normal",
      read: false,
      createdAt: now,
    });

    // Create activity event
    await ctx.db.insert("activityEvents", {
      agentId: maxAgent._id,
      agentName: "max",
      category: "system",
      eventType: "standup_generated",
      title: `Daily standup generated for ${args.date}`,
      description: "Auto-generated standup summary sent to Son",
      metadata: {
        source: "standup_scheduler",
      },
      timestamp: now,
    });

    console.log(`[Standup] Daily summary sent to Son for ${args.date}`);
    return { success: true };
  },
});

/**
 * Generate daily standup for all agents (internal action)
 * Called by cron job at end of day
 */
export const generateDailyStandup = internalAction({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; agentsProcessed: number; date: string }> => {
    const today = new Date().toISOString().split("T")[0];
    console.log(`[Standup] Generating daily standup for ${today}`);

    // Get today's standup data
    const standupData = await ctx.runQuery(api.standup.getDaily, {});
    const summary = await ctx.runQuery(api.standup.getDailySummary, {});

    // Save daily note for each agent
    for (const agentReport of standupData.agents) {
      const markdown = formatAgentStandup(
        agentReport as Parameters<typeof formatAgentStandup>[0],
        today
      );

      await ctx.runMutation(internal.standup.saveDailyNote, {
        agentId: agentReport.agent.id as Id<"agents">,
        content: markdown,
        date: today,
      });

      console.log(`[Standup] Saved daily note for ${agentReport.agent.name}`);
    }

    // Generate and send system summary to Son
    const systemSummary = formatSystemSummary(
      standupData as Parameters<typeof formatSystemSummary>[0],
      summary,
      today
    );

    await ctx.runMutation(internal.standup.notifySon, {
      content: systemSummary,
      date: today,
    });

    return {
      success: true,
      agentsProcessed: standupData.agents.length,
      date: today,
    };
  },
});
