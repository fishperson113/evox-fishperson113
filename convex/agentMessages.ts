/**
 * Agent-to-agent messages (AGT-123): handoff, update, request, fyi.
 * Resolve agent names via agentMappings for getUnreadMessages / getConversation.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveAgentIdByName } from "./agentMappings";

const messageType = v.union(
  v.literal("handoff"),
  v.literal("update"),
  v.literal("request"),
  v.literal("fyi")
);
const messageStatus = v.union(v.literal("unread"), v.literal("read"));

/** Send a message from one agent to another. */
export const sendMessage = mutation({
  args: {
    fromAgentName: v.string(),
    toAgentName: v.string(),
    type: messageType,
    content: v.string(),
    taskRef: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const fromId = await resolveAgentIdByName(ctx.db, args.fromAgentName);
    const toId = await resolveAgentIdByName(ctx.db, args.toAgentName);
    const now = Date.now();
    return await ctx.db.insert("agentMessages", {
      from: fromId,
      to: toId,
      type: args.type,
      content: args.content,
      taskRef: args.taskRef,
      status: "unread",
      timestamp: now,
    });
  },
});

/** Unread counts for all mapped agents (max, sam, leo). For dashboard boot. */
export const getUnreadCounts = query({
  args: {},
  handler: async (ctx) => {
    const names = ["max", "sam", "leo"] as const;
    const counts: Record<string, number> = {};
    for (const name of names) {
      try {
        const toId = await resolveAgentIdByName(ctx.db, name);
        const list = await ctx.db
          .query("agentMessages")
          .withIndex("by_to_status", (q) =>
            q.eq("to", toId).eq("status", "unread")
          )
          .collect();
        counts[name] = list.length;
      } catch {
        counts[name] = 0;
      }
    }
    return counts;
  },
});

/** Get unread messages for an agent (by canonical name). Used in agent boot sequence. */
export const getUnreadMessages = query({
  args: {
    agentName: v.string(),
  },
  handler: async (ctx, args) => {
    let toId;
    try {
      toId = await resolveAgentIdByName(ctx.db, args.agentName);
    } catch {
      return [];
    }
    const messages = await ctx.db
      .query("agentMessages")
      .withIndex("by_to_status", (q) =>
        q.eq("to", toId).eq("status", "unread")
      )
      .order("desc")
      .collect();
    const withSenders = await Promise.all(
      messages.map(async (m) => {
        const from = await ctx.db.get(m.from);
        const task = m.taskRef ? await ctx.db.get(m.taskRef) : null;
        return {
          ...m,
          fromAgent: from
            ? { name: from.name, avatar: from.avatar }
            : null,
          taskRefDisplay: task
            ? { linearIdentifier: task.linearIdentifier, title: task.title }
            : null,
        };
      })
    );
    return withSenders;
  },
});

/** Mark a message as read. */
export const markAsRead = mutation({
  args: {
    messageId: v.id("agentMessages"),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) throw new Error("Message not found");
    await ctx.db.patch(args.messageId, { status: "read" });
  },
});

/** List all messages to or from an agent (for Agent Profile Messages tab). */
export const listForAgent = query({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const [toMe, fromMe] = await Promise.all([
      ctx.db
        .query("agentMessages")
        .withIndex("by_to_status", (q) => q.eq("to", args.agentId))
        .collect(),
      ctx.db
        .query("agentMessages")
        .withIndex("by_from_to", (q) => q.eq("from", args.agentId))
        .collect(),
    ]);
    const merged = [...toMe, ...fromMe].sort((a, b) => b.timestamp - a.timestamp);
    const limited = merged.slice(0, limit);
    const withAgents = await Promise.all(
      limited.map(async (m) => {
        const from = await ctx.db.get(m.from);
        const to = await ctx.db.get(m.to);
        const task = m.taskRef ? await ctx.db.get(m.taskRef) : null;
        return {
          ...m,
          fromAgent: from ? { name: from.name, avatar: from.avatar } : null,
          toAgent: to ? { name: to.name, avatar: to.avatar } : null,
          taskRefDisplay: task
            ? { linearIdentifier: task.linearIdentifier, title: task.title }
            : null,
        };
      })
    );
    return withAgents;
  },
});

/** Get conversation between two agents (by canonical names), ordered by timestamp. */
export const getConversation = query({
  args: {
    agent1: v.string(),
    agent2: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const a1 = await resolveAgentIdByName(ctx.db, args.agent1);
    const a2 = await resolveAgentIdByName(ctx.db, args.agent2);
    const fromAtoB = await ctx.db
      .query("agentMessages")
      .withIndex("by_from_to", (q) => q.eq("from", a1).eq("to", a2))
      .order("desc")
      .collect();
    const fromBtoA = await ctx.db
      .query("agentMessages")
      .withIndex("by_from_to", (q) => q.eq("from", a2).eq("to", a1))
      .order("desc")
      .collect();
    const merged = [...fromAtoB, ...fromBtoA].sort(
      (x, y) => x.timestamp - y.timestamp
    );
    const limited = args.limit ? merged.slice(-args.limit) : merged;
    const withAgents = await Promise.all(
      limited.map(async (m) => {
        const from = await ctx.db.get(m.from);
        const to = await ctx.db.get(m.to);
        const task = m.taskRef ? await ctx.db.get(m.taskRef) : null;
        return {
          ...m,
          fromAgent: from
            ? { name: from.name, avatar: from.avatar }
            : null,
          toAgent: to ? { name: to.name, avatar: to.avatar } : null,
          taskRefDisplay: task
            ? { linearIdentifier: task.linearIdentifier, title: task.title }
            : null,
        };
      })
    );
    return withAgents;
  },
});

/**
 * Clean up spam messages (from invalid/non-existent agents)
 * Run: npx convex run agentMessages:cleanupSpam
 */
export const cleanupSpam = mutation({
  args: {},
  handler: async (ctx) => {
    const allMessages = await ctx.db.query("agentMessages").collect();
    let deleted = 0;
    for (const msg of allMessages) {
      const fromAgent = await ctx.db.get(msg.from);
      if (!fromAgent) {
        await ctx.db.delete(msg._id);
        deleted++;
      }
    }
    return { deleted, message: `Cleaned up ${deleted} spam messages` };
  },
});
