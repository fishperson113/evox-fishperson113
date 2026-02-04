import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// AGT-222: Session Learning System
// Auto-report learnings after each session for team knowledge sharing

/**
 * Submit a learning from a completed session
 */
export const submitLearning = mutation({
  args: {
    agentName: v.string(),
    taskId: v.optional(v.string()),
    taskTitle: v.string(),
    summary: v.string(),
    filesChanged: v.array(v.string()),
    challenges: v.optional(v.string()),
    patterns: v.optional(v.string()),
    codeSnippets: v.optional(
      v.array(
        v.object({
          file: v.string(),
          code: v.string(),
          explanation: v.string(),
        })
      )
    ),
    feedbackGood: v.optional(v.string()),
    feedbackImprove: v.optional(v.string()),
    tags: v.array(v.string()),
    timeSpentMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const id = await ctx.db.insert("learnings", {
      agentName: args.agentName.toLowerCase(),
      taskId: args.taskId,
      taskTitle: args.taskTitle,
      summary: args.summary,
      filesChanged: args.filesChanged,
      challenges: args.challenges,
      patterns: args.patterns,
      codeSnippets: args.codeSnippets,
      feedbackGood: args.feedbackGood,
      feedbackImprove: args.feedbackImprove,
      tags: args.tags.map((t) => t.toLowerCase()),
      timeSpentMinutes: args.timeSpentMinutes,
      createdAt: now,
    });

    return { success: true, id };
  },
});

/**
 * Get learnings by agent
 */
export const getByAgent = query({
  args: {
    agentName: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { agentName, limit }) => {
    const learnings = await ctx.db
      .query("learnings")
      .withIndex("by_agent", (q) => q.eq("agentName", agentName.toLowerCase()))
      .order("desc")
      .take(limit ?? 50);

    return learnings;
  },
});

/**
 * Get learnings by topic/tag
 */
export const getByTopic = query({
  args: {
    topic: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { topic, limit }) => {
    const allLearnings = await ctx.db
      .query("learnings")
      .order("desc")
      .take(500);

    const topicLower = topic.toLowerCase();
    const filtered = allLearnings.filter(
      (l) =>
        l.tags.includes(topicLower) ||
        l.summary.toLowerCase().includes(topicLower) ||
        l.patterns?.toLowerCase().includes(topicLower)
    );

    return filtered.slice(0, limit ?? 50);
  },
});

/**
 * Search learnings
 */
export const search = query({
  args: {
    query: v.string(),
    agentName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query: searchQuery, agentName, limit }) => {
    let learnings;

    if (agentName) {
      learnings = await ctx.db
        .query("learnings")
        .withIndex("by_agent", (q) => q.eq("agentName", agentName.toLowerCase()))
        .order("desc")
        .take(500);
    } else {
      learnings = await ctx.db.query("learnings").order("desc").take(500);
    }

    const queryLower = searchQuery.toLowerCase();
    const filtered = learnings.filter(
      (l) =>
        l.summary.toLowerCase().includes(queryLower) ||
        l.taskTitle.toLowerCase().includes(queryLower) ||
        l.patterns?.toLowerCase().includes(queryLower) ||
        l.challenges?.toLowerCase().includes(queryLower) ||
        l.tags.some((t) => t.includes(queryLower))
    );

    return filtered.slice(0, limit ?? 50);
  },
});

/**
 * Get recent learnings across all agents
 */
export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("learnings")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit ?? 50);
  },
});

/**
 * Get learning by task ID
 */
export const getByTask = query({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, { taskId }) => {
    return await ctx.db
      .query("learnings")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .first();
  },
});

/**
 * Get a specific learning by ID
 */
export const get = query({
  args: {
    id: v.id("learnings"),
  },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * Get learning stats by agent
 */
export const getStats = query({
  handler: async (ctx) => {
    const learnings = await ctx.db.query("learnings").collect();

    const byAgent: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    let totalChallenges = 0;
    let totalPatterns = 0;

    for (const l of learnings) {
      byAgent[l.agentName] = (byAgent[l.agentName] ?? 0) + 1;
      for (const tag of l.tags) {
        byTag[tag] = (byTag[tag] ?? 0) + 1;
      }
      if (l.challenges) totalChallenges++;
      if (l.patterns) totalPatterns++;
    }

    return {
      total: learnings.length,
      byAgent,
      topTags: Object.entries(byTag)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      challengesDocumented: totalChallenges,
      patternsDiscovered: totalPatterns,
    };
  },
});
