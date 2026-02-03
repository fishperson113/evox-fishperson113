import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Activity Logs — Linear-style event tracking
 * Tracks: created, assigned, moved, completed, commented
 */

// Helper to get agent name from ID
async function getAgentName(ctx: any, agentId: any): Promise<string> {
  const agent = await ctx.db.get(agentId);
  return agent?.name?.toLowerCase() ?? "unknown";
}

// Helper to get task linear identifier
async function getTaskIdentifier(ctx: any, taskId: any): Promise<string | undefined> {
  if (!taskId) return undefined;
  const task = await ctx.db.get(taskId);
  return task?.linearIdentifier;
}

// Log task created
export const logCreated = mutation({
  args: {
    agentId: v.id("agents"),
    taskId: v.id("tasks"),
    linearIdentifier: v.optional(v.string()),
  },
  handler: async (ctx, { agentId, taskId, linearIdentifier }) => {
    const agentName = await getAgentName(ctx, agentId);
    const identifier = linearIdentifier ?? await getTaskIdentifier(ctx, taskId);

    return await ctx.db.insert("activityLogs", {
      agentId,
      agentName,
      eventType: "created",
      taskId,
      linearIdentifier: identifier,
      timestamp: Date.now(),
    });
  },
});

// Log task moved (status change)
export const logMoved = mutation({
  args: {
    agentId: v.id("agents"),
    taskId: v.id("tasks"),
    fromStatus: v.string(),
    toStatus: v.string(),
  },
  handler: async (ctx, { agentId, taskId, fromStatus, toStatus }) => {
    const agentName = await getAgentName(ctx, agentId);
    const linearIdentifier = await getTaskIdentifier(ctx, taskId);

    return await ctx.db.insert("activityLogs", {
      agentId,
      agentName,
      eventType: "moved",
      taskId,
      linearIdentifier,
      fromStatus,
      toStatus,
      timestamp: Date.now(),
    });
  },
});

// Log task completed
export const logCompleted = mutation({
  args: {
    agentId: v.id("agents"),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, { agentId, taskId }) => {
    const agentName = await getAgentName(ctx, agentId);
    const linearIdentifier = await getTaskIdentifier(ctx, taskId);

    return await ctx.db.insert("activityLogs", {
      agentId,
      agentName,
      eventType: "completed",
      taskId,
      linearIdentifier,
      toStatus: "done",
      timestamp: Date.now(),
    });
  },
});

// Log task assigned
export const logAssigned = mutation({
  args: {
    agentId: v.id("agents"),
    taskId: v.id("tasks"),
    assignedTo: v.id("agents"),
  },
  handler: async (ctx, { agentId, taskId, assignedTo }) => {
    const agentName = await getAgentName(ctx, agentId);
    const linearIdentifier = await getTaskIdentifier(ctx, taskId);

    return await ctx.db.insert("activityLogs", {
      agentId,
      agentName,
      eventType: "assigned",
      taskId,
      linearIdentifier,
      assignedTo,
      timestamp: Date.now(),
    });
  },
});

// Log comment added
export const logCommented = mutation({
  args: {
    agentId: v.id("agents"),
    taskId: v.id("tasks"),
    comment: v.string(),
  },
  handler: async (ctx, { agentId, taskId, comment }) => {
    const agentName = await getAgentName(ctx, agentId);
    const linearIdentifier = await getTaskIdentifier(ctx, taskId);

    return await ctx.db.insert("activityLogs", {
      agentId,
      agentName,
      eventType: "commented",
      taskId,
      linearIdentifier,
      comment,
      timestamp: Date.now(),
    });
  },
});

// List recent activity logs
export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("activityLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit ?? 50);
  },
});

// List by agent
export const listByAgent = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { agentId, limit }) => {
    return await ctx.db
      .query("activityLogs")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .take(limit ?? 50);
  },
});

// List by task
export const listByTask = query({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, { taskId }) => {
    return await ctx.db
      .query("activityLogs")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .collect();
  },
});

// List by event type
export const listByType = query({
  args: {
    eventType: v.union(
      v.literal("created"),
      v.literal("assigned"),
      v.literal("moved"),
      v.literal("completed"),
      v.literal("commented")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventType, limit }) => {
    return await ctx.db
      .query("activityLogs")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .order("desc")
      .take(limit ?? 50);
  },
});
