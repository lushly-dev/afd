import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    return await ctx.db
      .query("noteFolders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("noteFolders") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    const folder = await ctx.db.get(args.id);
    if (!folder || folder.userId !== userId) {
      return null;
    }
    return folder;
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const id = await ctx.db.insert("noteFolders", {
      name: args.name,
      userId: userId,
      createdAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id("noteFolders"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Folder not found");
    if (existing.userId !== userId) throw new Error("Unauthorized");

    await ctx.db.patch(args.id, {
      name: args.name,
    });
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("noteFolders") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Folder not found");
    if (existing.userId !== userId) throw new Error("Unauthorized");

    await ctx.db.delete(args.id);
    return { success: true, id: args.id };
  },
});
