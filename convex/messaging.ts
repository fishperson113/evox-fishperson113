/**
 * AGT-174: Unified Communication System
 *
 * Single module for all agent messaging: comments, DMs, dispatches, system messages.
 * Replaces separate taskComments and agentMessaging modules.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/**
 * Parse @mentions from content
 * Supports: @Max, @Sam, @Leo, @Son, @all
 */
export function parseMentions(content: string): string[] {
  const regex = /@(Max|Sam|Leo|Son|all)/gi;
  const matches = content.match(regex) || [];
  const names = matches.map((m) => m.slice(1).toLowerCase());

  // @all expands to all agents
  if (names.includes("all")) {
    return ["max", "sam", "leo", "son"];
  }

  return [...new Set(names)];
}

/**
 * Post a comment on a task
 */
export const postComment = mutation({
  args: {
    taskId: v.id("tasks"),
    agentName: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const agentNameLower = args.agentName.toLowerCase();

    // Get task for linearIdentifier
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error(`Task not found: ${args.taskId}`);
    }

    // Parse mentions from content
    const mentions = parseMentions(args.content);

    // Create message
    const messageId = await ctx.db.insert("unifiedMessages", {
      fromAgent: agentNameLower,
      taskId: args.taskId,
      linearIdentifier: task.linearIdentifier,
      content: args.content,
      type: "comment",
      mentions: mentions.length > 0 ? mentions : undefined,
      createdAt: Date.now(),
    });

    // Get agent for activity log
    const agents = await ctx.db.query("agents").collect();
    const agent = agents.find(
      (a) => a.name.toLowerCase() === agentNameLower
    );

    if (agent) {
      // Log activity
      const linearId = task.linearIdentifier || `task-${args.taskId}`;
      await ctx.db.insert("activityEvents", {
        agentId: agent._id,
        agentName: agentNameLower,
        category: "message",
        eventType: "comment",
        title: `${agent.name.toUpperCase()} commented on ${linearId}`,
        taskId: args.taskId,
        linearIdentifier: task.linearIdentifier,
        projectId: task.projectId,
        metadata: {
          source: "unified_messaging",
        },
        timestamp: Date.now(),
      });

      // Create notifications for mentioned agents
      for (const mentionName of mentions) {
        if (mentionName === agentNameLower) continue; // Don't notify self

        const mentionedAgent = agents.find(
          (a) => a.name.toLowerCase() === mentionName
        );
        if (mentionedAgent) {
          await ctx.db.insert("notifications", {
            to: mentionedAgent._id,
            from: agent._id,
            type: "mention",
            title: `${agent.name} mentioned you`,
            message: `In ${linearId}: ${args.content.slice(0, 100)}${args.content.length > 100 ? "..." : ""}`,
            read: false,
            relatedTask: args.taskId,
            createdAt: Date.now(),
          });
        }
      }
    }

    return {
      messageId,
      taskId: args.taskId,
      mentions,
      linearIdentifier: task.linearIdentifier,
    };
  },
});

/**
 * Send a direct message to another agent
 */
export const sendDM = mutation({
  args: {
    from: v.string(),
    to: v.string(),
    content: v.string(),
    relatedTaskId: v.optional(v.id("tasks")),
    priority: v.optional(v.union(v.literal("normal"), v.literal("urgent"))),
  },
  handler: async (ctx, args) => {
    const fromLower = args.from.toLowerCase();
    const toLower = args.to.toLowerCase();
    const priority = args.priority || "normal";

    // Get task for linearIdentifier if provided
    let linearIdentifier: string | undefined;
    if (args.relatedTaskId) {
      const task = await ctx.db.get(args.relatedTaskId);
      linearIdentifier = task?.linearIdentifier;
    }

    // Create DM message
    const messageId = await ctx.db.insert("unifiedMessages", {
      fromAgent: fromLower,
      toAgent: toLower,
      taskId: args.relatedTaskId,
      linearIdentifier,
      content: args.content,
      type: "dm",
      priority,
      read: false,
      createdAt: Date.now(),
    });

    // Get agents for notification
    const agents = await ctx.db.query("agents").collect();
    const fromAgent = agents.find((a) => a.name.toLowerCase() === fromLower);
    const toAgent = agents.find((a) => a.name.toLowerCase() === toLower);

    if (fromAgent && toAgent) {
      // Create notification
      const notificationTitle =
        priority === "urgent"
          ? `🔴 Urgent DM from ${fromAgent.name}`
          : `DM from ${fromAgent.name}`;

      const notificationMessage = linearIdentifier
        ? `Re: ${linearIdentifier} — ${args.content.slice(0, 100)}${args.content.length > 100 ? "..." : ""}`
        : args.content.slice(0, 150) + (args.content.length > 150 ? "..." : "");

      await ctx.db.insert("notifications", {
        to: toAgent._id,
        from: fromAgent._id,
        type: "dm",
        title: notificationTitle,
        message: notificationMessage,
        read: false,
        relatedTask: args.relatedTaskId,
        createdAt: Date.now(),
      });

      // Log activity
      await ctx.db.insert("activityEvents", {
        agentId: fromAgent._id,
        agentName: fromLower,
        category: "message",
        eventType: "dm_sent",
        title: `${fromAgent.name.toUpperCase()} sent DM to ${toAgent.name.toUpperCase()}`,
        taskId: args.relatedTaskId,
        linearIdentifier,
        metadata: {
          source: "unified_messaging",
        },
        timestamp: Date.now(),
      });
    }

    return {
      messageId,
      from: fromLower,
      to: toLower,
      priority,
    };
  },
});

/**
 * Get comments for a task (ordered oldest first for chat view)
 */
export const getTaskComments = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("unifiedMessages")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    // Filter to only comments and sort by createdAt ASC
    const filtered = comments
      .filter((m) => m.type === "comment")
      .sort((a, b) => a.createdAt - b.createdAt);

    // Enrich with agent info
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    return filtered.map((m) => {
      const agent = agentMap.get(m.fromAgent);
      return {
        ...m,
        agentName: agent?.name || m.fromAgent,
        agentAvatar: agent?.avatar || "🤖",
      };
    });
  },
});

/**
 * Get comments by Linear identifier (e.g., "AGT-112")
 */
export const getCommentsByLinearId = query({
  args: { linearIdentifier: v.string() },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("unifiedMessages")
      .withIndex("by_linearId", (q) =>
        q.eq("linearIdentifier", args.linearIdentifier)
      )
      .collect();

    // Filter to only comments and sort by createdAt ASC
    const filtered = comments
      .filter((m) => m.type === "comment")
      .sort((a, b) => a.createdAt - b.createdAt);

    // Enrich with agent info
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    return filtered.map((m) => {
      const agent = agentMap.get(m.fromAgent);
      return {
        ...m,
        agentName: agent?.name || m.fromAgent,
        agentAvatar: agent?.avatar || "🤖",
      };
    });
  },
});

/**
 * Get DMs for an agent
 */
export const getDMs = query({
  args: {
    agentName: v.string(),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const agentNameLower = args.agentName.toLowerCase();

    let messages;
    if (args.unreadOnly) {
      messages = await ctx.db
        .query("unifiedMessages")
        .withIndex("by_to_agent_unread", (q) =>
          q.eq("toAgent", agentNameLower).eq("read", false)
        )
        .order("desc")
        .collect();
    } else {
      messages = await ctx.db
        .query("unifiedMessages")
        .withIndex("by_to_agent", (q) => q.eq("toAgent", agentNameLower))
        .order("desc")
        .collect();
    }

    // Filter to only DMs
    const dms = messages.filter((m) => m.type === "dm");

    // Enrich with sender info
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    return dms.map((m) => {
      const fromAgent = agentMap.get(m.fromAgent);
      return {
        ...m,
        fromAgentName: fromAgent?.name || m.fromAgent,
        fromAgentAvatar: fromAgent?.avatar || "🤖",
      };
    });
  },
});

/**
 * Get unread count for an agent (DMs + mentions)
 */
export const getUnreadCount = query({
  args: { agentName: v.string() },
  handler: async (ctx, args) => {
    const agentNameLower = args.agentName.toLowerCase();

    // Unread DMs
    const unreadDMs = await ctx.db
      .query("unifiedMessages")
      .withIndex("by_to_agent_unread", (q) =>
        q.eq("toAgent", agentNameLower).eq("read", false)
      )
      .collect();

    // Unread mentions (in comments)
    const allMessages = await ctx.db.query("unifiedMessages").collect();
    const unreadMentions = allMessages.filter(
      (m) =>
        m.type === "comment" &&
        m.read !== true &&
        m.mentions?.includes(agentNameLower) &&
        m.fromAgent !== agentNameLower
    );

    return {
      dms: unreadDMs.length,
      mentions: unreadMentions.length,
      total: unreadDMs.length + unreadMentions.length,
    };
  },
});

/**
 * Get unread messages for an agent (for boot protocol)
 */
export const getUnread = query({
  args: { agentName: v.string() },
  handler: async (ctx, args) => {
    const agentNameLower = args.agentName.toLowerCase();

    // Unread DMs
    const unreadDMs = await ctx.db
      .query("unifiedMessages")
      .withIndex("by_to_agent_unread", (q) =>
        q.eq("toAgent", agentNameLower).eq("read", false)
      )
      .order("desc")
      .take(10)
      .then((msgs) => msgs.filter((m) => m.type === "dm"));

    // Unread mentions (in comments)
    const allMessages = await ctx.db.query("unifiedMessages").collect();
    const unreadMentions = allMessages
      .filter(
        (m) =>
          m.type === "comment" &&
          m.read !== true &&
          m.mentions?.includes(agentNameLower) &&
          m.fromAgent !== agentNameLower
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);

    // Enrich with agent info
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    const enrichDM = (m: typeof unreadDMs[0]) => {
      const fromAgent = agentMap.get(m.fromAgent);
      return {
        ...m,
        fromAgentName: fromAgent?.name || m.fromAgent,
        fromAgentAvatar: fromAgent?.avatar || "🤖",
      };
    };

    return {
      dms: unreadDMs.map(enrichDM),
      mentions: unreadMentions.map(enrichDM),
      count: {
        dms: unreadDMs.length,
        mentions: unreadMentions.length,
        total: unreadDMs.length + unreadMentions.length,
      },
    };
  },
});

/**
 * Mark a message as read
 */
export const markRead = mutation({
  args: { messageId: v.id("unifiedMessages") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { read: true });
    return { success: true };
  },
});

/**
 * Mark all messages as read for an agent
 */
export const markAllRead = mutation({
  args: { agentName: v.string() },
  handler: async (ctx, args) => {
    const agentNameLower = args.agentName.toLowerCase();

    // Get all unread DMs
    const unreadDMs = await ctx.db
      .query("unifiedMessages")
      .withIndex("by_to_agent_unread", (q) =>
        q.eq("toAgent", agentNameLower).eq("read", false)
      )
      .collect();

    // Get all unread mentions
    const allMessages = await ctx.db.query("unifiedMessages").collect();
    const unreadMentions = allMessages.filter(
      (m) =>
        m.type === "comment" &&
        m.read !== true &&
        m.mentions?.includes(agentNameLower)
    );

    // Mark all as read
    const toMark = [...unreadDMs, ...unreadMentions];
    for (const msg of toMark) {
      await ctx.db.patch(msg._id, { read: true });
    }

    return { marked: toMark.length };
  },
});

/**
 * Get conversation between two agents
 */
export const getConversation = query({
  args: {
    agent1: v.string(),
    agent2: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const a1 = args.agent1.toLowerCase();
    const a2 = args.agent2.toLowerCase();

    // Get all DMs between these two agents
    const allMessages = await ctx.db.query("unifiedMessages").collect();
    const conversation = allMessages
      .filter(
        (m) =>
          m.type === "dm" &&
          ((m.fromAgent === a1 && m.toAgent === a2) ||
            (m.fromAgent === a2 && m.toAgent === a1))
      )
      .sort((a, b) => a.createdAt - b.createdAt); // Oldest first for chat view

    const limited = args.limit
      ? conversation.slice(-args.limit)
      : conversation;

    // Enrich with agent info
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    return limited.map((m) => {
      const fromAgent = agentMap.get(m.fromAgent);
      return {
        ...m,
        fromAgentName: fromAgent?.name || m.fromAgent,
        fromAgentAvatar: fromAgent?.avatar || "🤖",
      };
    });
  },
});

/**
 * Get recent messages across all types (for activity feed)
 */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const messages = await ctx.db
      .query("unifiedMessages")
      .order("desc")
      .take(limit);

    // Enrich with agent info
    const agents = await ctx.db.query("agents").collect();
    const agentMap = new Map(agents.map((a) => [a.name.toLowerCase(), a]));

    return messages.map((m) => {
      const fromAgent = agentMap.get(m.fromAgent);
      return {
        ...m,
        fromAgentName: fromAgent?.name || m.fromAgent,
        fromAgentAvatar: fromAgent?.avatar || "🤖",
      };
    });
  },
});
