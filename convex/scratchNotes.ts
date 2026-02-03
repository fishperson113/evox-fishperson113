import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("scratchNotes").order("desc").first();
  },
});

export const update = mutation({
  args: { content: v.string() },
  handler: async (ctx, { content }) => {
    const existing = await ctx.db.query("scratchNotes").first();
    if (existing) {
      await ctx.db.patch(existing._id, { content, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("scratchNotes", {
      content,
      updatedAt: Date.now(),
    });
  },
});
