import { v } from "convex/values";
import { query } from "./_generated/server";

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
