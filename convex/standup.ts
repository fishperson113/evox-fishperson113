import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Get daily standup report per agent
 * Returns breakdown of completed, in-progress, and blocked tasks for each agent
 *
 * @param startTs - Start of day (UTC ms). Frontend sends user's local day range.
 * @param endTs - End of day (UTC ms).
 */
export const getDaily = query({
  args: {
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayStart =
      args.startTs ?? new Date(new Date().toISOString().split("T")[0]).setHours(0, 0, 0, 0);
    const dayEnd =
      args.endTs ?? new Date(new Date().toISOString().split("T")[0]).setHours(23, 59, 59, 999);

    // Get all agents
    const agents = await ctx.db.query("agents").collect();

    // Get all tasks
    const allTasks = await ctx.db.query("tasks").collect();

    // Get activities for the day to track task completions
    // Note: Convex indexes don't support range queries, so we filter after fetching
    const allActivities = await ctx.db
      .query("activities")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    const activities = allActivities.filter(
      (a) => a.createdAt >= dayStart && a.createdAt <= dayEnd
    );

    // Build per-agent report
    const agentReports = await Promise.all(
      agents.map(async (agent) => {
        // Completed: tasks moved to "done" status today
        const completedTaskIds = activities
          .filter(
            (a) =>
              a.agent === agent._id &&
              a.action === "updated_task_status" &&
              a.metadata?.to === "done"
          )
          .map((a) => a.target);

        const completedTasks = allTasks.filter((t) =>
          completedTaskIds.includes(t._id)
        );

        // In Progress: currently assigned tasks with in_progress status
        const inProgressTasks = allTasks.filter(
          (t) => t.assignee === agent._id && t.status === "in_progress"
        );

        // Blocked: tasks with "blocked" in title/description or specific blocked status
        // Note: We don't have a "blocked" status in schema yet, so we check for keyword
        const blockedTasks = allTasks.filter(
          (t) =>
            t.assignee === agent._id &&
            (t.status === "backlog" ||
              t.title.toLowerCase().includes("blocked") ||
              t.description.toLowerCase().includes("blocked"))
        );

        // Count activities for this agent today
        const todayActivities = activities.filter(
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
          blocked: blockedTasks.map((t) => ({
            id: t._id,
            title: t.title,
            priority: t.priority,
            linearIdentifier: t.linearIdentifier,
          })),
          activityCount: todayActivities,
        };
      })
    );

    return {
      startTs: dayStart,
      endTs: dayEnd,
      agents: agentReports,
    };
  },
});

/**
 * Get daily standup summary with aggregate stats
 * Returns overall metrics for the day
 *
 * @param startTs - Start of day (UTC ms). Frontend sends user's local day range.
 * @param endTs - End of day (UTC ms).
 */
export const getDailySummary = query({
  args: {
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayStart =
      args.startTs ?? new Date(new Date().toISOString().split("T")[0]).setHours(0, 0, 0, 0);
    const dayEnd =
      args.endTs ?? new Date(new Date().toISOString().split("T")[0]).setHours(23, 59, 59, 999);

    // Get all tasks
    const allTasks = await ctx.db.query("tasks").collect();

    // Get activities for the day
    // Note: Convex indexes don't support range queries, so we filter after fetching
    const allActivitiesForSummary = await ctx.db
      .query("activities")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    const activities = allActivitiesForSummary.filter(
      (a) => a.createdAt >= dayStart && a.createdAt <= dayEnd
    );

    // Count unique agents active today
    const activeAgentIds = new Set(activities.map((a) => a.agent));

    // Tasks completed today (moved to "done" status)
    const completedTaskIds = activities
      .filter(
        (a) => a.action === "updated_task_status" && a.metadata?.to === "done"
      )
      .map((a) => a.target);

    const tasksCompleted = new Set(completedTaskIds).size;

    // Tasks currently in progress
    const tasksInProgress = allTasks.filter(
      (t) => t.status === "in_progress"
    ).length;

    // Blocked tasks (keyword-based detection)
    const tasksBlocked = allTasks.filter(
      (t) =>
        t.status === "backlog" ||
        t.title.toLowerCase().includes("blocked") ||
        t.description.toLowerCase().includes("blocked")
    ).length;

    // Messages sent today
    const messagesSent = activities.filter(
      (a) => a.action === "sent_message"
    ).length;

    // Total activities
    const totalActivities = activities.length;

    return {
      startTs: dayStart,
      endTs: dayEnd,
      totalActivities,
      tasksCompleted,
      tasksInProgress,
      tasksBlocked,
      agentsActive: activeAgentIds.size,
      messagesSent,
    };
  },
});
