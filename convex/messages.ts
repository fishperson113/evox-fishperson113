import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

// CREATE
export const send = mutation({
  args: {
    from: v.id("agents"),
    content: v.string(),
    channel: v.union(
      v.literal("general"),
      v.literal("dev"),
      v.literal("design")
    ),
    mentions: v.optional(v.array(v.id("agents"))),
    threadId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      from: args.from,
      content: args.content,
      channel: args.channel,
      mentions: args.mentions ?? [],
      threadId: args.threadId,
      createdAt: now,
    });

    // Log activity
    await ctx.db.insert("activities", {
      agent: args.from,
      action: "sent_message",
      target: args.channel,
      metadata: { messageId, threadId: args.threadId },
      createdAt: now,
    });

    // Process @mentions and create notifications
    await ctx.scheduler.runAfter(0, internal.mentions.processMessageMentions, {
      messageId,
      fromAgentId: args.from,
      content: args.content,
    });

    return messageId;
  },
});

// READ - Get all messages
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db.query("messages").order("desc").collect();
    return args.limit ? messages.slice(0, args.limit) : messages;
  },
});

// READ - Get message by ID
export const get = query({
  args: { id: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// READ - Get messages by channel
export const getByChannel = query({
  args: {
    channel: v.union(
      v.literal("general"),
      v.literal("dev"),
      v.literal("design")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .order("desc")
      .collect();
    return args.limit ? messages.slice(0, args.limit) : messages;
  },
});

// READ - Get thread messages
export const getThread = query({
  args: {
    threadId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

// READ - Get messages with agent details
export const listWithAgents = query({
  args: {
    channel: v.optional(
      v.union(v.literal("general"), v.literal("dev"), v.literal("design"))
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const messages = args.channel
      ? await ctx.db
          .query("messages")
          .withIndex("by_channel", (q) => q.eq("channel", args.channel!))
          .order("desc")
          .collect()
      : await ctx.db.query("messages").order("desc").collect();
    const limitedMessages = args.limit
      ? messages.slice(0, args.limit)
      : messages;

    // Populate agent details
    const messagesWithAgents = await Promise.all(
      limitedMessages.map(async (msg) => {
        const agent = await ctx.db.get(msg.from);
        return {
          ...msg,
          agent,
        };
      })
    );

    return messagesWithAgents;
  },
});

// UPDATE - Edit message
export const edit = mutation({
  args: {
    id: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.id);
    if (!message) throw new Error("Message not found");

    await ctx.db.patch(args.id, {
      content: args.content,
    });

    // Log activity
    await ctx.db.insert("activities", {
      agent: message.from,
      action: "edited_message",
      target: args.id,
      createdAt: Date.now(),
    });
  },
});

// DELETE
export const remove = mutation({
  args: {
    id: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.id);
    if (!message) throw new Error("Message not found");

    // Log activity before deletion
    await ctx.db.insert("activities", {
      agent: message.from,
      action: "deleted_message",
      target: args.id,
      createdAt: Date.now(),
    });

    await ctx.db.delete(args.id);
  },
});
