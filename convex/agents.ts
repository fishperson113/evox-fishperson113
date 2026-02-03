import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// CREATE
export const create = mutation({
  args: {
    name: v.string(),
    role: v.union(v.literal("pm"), v.literal("backend"), v.literal("frontend")),
    avatar: v.string(),
  },
  handler: async (ctx, args) => {
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      role: args.role,
      status: "offline",
      avatar: args.avatar,
      lastSeen: Date.now(),
    });
    return agentId;
  },
});

// READ - Get all agents (never throw — dashboard/layout depend on this)
export const list = query({
  handler: async (ctx) => {
    try {
      return await ctx.db.query("agents").collect();
    } catch {
      return [];
    }
  },
});

// READ - Get agent by ID
export const get = query({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** AGT-170: List agents with currentTask linearIdentifier for Agent Strip */
export const listForStrip = query({
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    return Promise.all(
      agents.map(async (a) => {
        let currentTaskIdentifier: string | null = null;
        if (a.currentTask) {
          const task = await ctx.db.get(a.currentTask);
          currentTaskIdentifier = task?.linearIdentifier ?? null;
        }
        return {
          _id: a._id,
          name: a.name,
          role: a.role,
          status: a.status,
          avatar: a.avatar,
          currentTaskIdentifier,
        };
      })
    );
  },
});

// READ - Get agents by status
export const getByStatus = query({
  args: {
    status: v.union(
      v.literal("online"),
      v.literal("idle"),
      v.literal("offline"),
      v.literal("busy")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});

// UPDATE - Update agent status
export const updateStatus = mutation({
  args: {
    id: v.id("agents"),
    status: v.union(
      v.literal("online"),
      v.literal("idle"),
      v.literal("offline"),
      v.literal("busy")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      lastSeen: Date.now(),
    });
  },
});

// UPDATE - Assign task to agent
export const assignTask = mutation({
  args: {
    id: v.id("agents"),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      currentTask: args.taskId,
      lastSeen: Date.now(),
    });
  },
});

// UPDATE - Update agent details
export const update = mutation({
  args: {
    id: v.id("agents"),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
    role: v.optional(
      v.union(v.literal("pm"), v.literal("backend"), v.literal("frontend"))
    ),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, {
      ...updates,
      lastSeen: Date.now(),
    });
  },
});

// UPDATE - Heartbeat (full version with status)
export const heartbeat = mutation({
  args: {
    id: v.id("agents"),
    status: v.union(
      v.literal("online"),
      v.literal("idle"),
      v.literal("offline"),
      v.literal("busy")
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { id, status, metadata } = args;
    const now = Date.now();

    // Update agent - AGT-190: Update both lastSeen AND lastHeartbeat
    await ctx.db.patch(id, {
      status,
      lastSeen: now,
      lastHeartbeat: now,
    });

    // Record heartbeat
    await ctx.db.insert("heartbeats", {
      agent: id,
      status,
      timestamp: now,
      metadata,
    });
  },
});

/**
 * AGT-190: Simple heartbeat mutation - just updates lastSeen timestamp
 * Use this for lightweight "I'm alive" pings without changing status
 */
export const ping = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      lastSeen: now,
      lastHeartbeat: now,
    });
    return { success: true, lastSeen: now };
  },
});

/**
 * AGT-190: Set agent to offline manually
 */
export const setOffline = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      status: "offline",
      lastSeen: now,
      lastHeartbeat: now,
    });
    return { success: true };
  },
});

/** Update agent lastSeen (AGT-133: when sync runs, touch sync-runner agent)
 * AGT-190: Also updates lastHeartbeat for consistency
 */
export const touchLastSeen = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      lastSeen: now,
      lastHeartbeat: now,
    });
  },
});

/** AGT-171: Update agent soul data */
export const updateSoul = mutation({
  args: {
    id: v.id("agents"),
    soul: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { soul: args.soul });
  },
});

// UPDATE - Preferred model
export const updatePreferredModel = mutation({
  args: {
    agentId: v.id("agents"),
    model: v.union(v.literal("claude"), v.literal("codex"))
  },
  handler: async (ctx, { agentId, model }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch(agentId, {
      metadata: { ...agent.metadata, preferredModel: model }
    });
  },
});

// DELETE
export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
