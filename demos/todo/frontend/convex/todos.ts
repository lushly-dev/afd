import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES (Read operations)
// ═══════════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("todos").order("desc").collect();
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    // Use indexes for better performance - get completed and pending counts separately
    const completedTodos = await ctx.db
      .query("todos")
      .withIndex("by_completed", (q) => q.eq("completed", true))
      .collect();
    const pendingTodos = await ctx.db
      .query("todos")
      .withIndex("by_completed", (q) => q.eq("completed", false))
      .collect();

    const completed = completedTodos.length;
    const pending = pendingTodos.length;
    const total = completed + pending;

    // Calculate priority stats from both completed and pending todos
    const allTodos = [...completedTodos, ...pendingTodos];
    const byPriority = {
      high: allTodos.filter((t) => t.priority === "high").length,
      medium: allTodos.filter((t) => t.priority === "medium").length,
      low: allTodos.filter((t) => t.priority === "low").length,
    };

    return { total, completed, pending, byPriority };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATIONS (Write operations)
// ═══════════════════════════════════════════════════════════════════════════════

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("todos", {
      title: args.title,
      description: args.description,
      completed: false,
      priority: args.priority ?? "medium",
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id("todos"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Todo not found");
    
    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const toggle = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Todo not found");
    
    await ctx.db.patch(args.id, {
      completed: !existing.completed,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Todo not found");
    await ctx.db.delete(args.id);
    return { success: true, id: args.id };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const batchToggle = mutation({
  args: { ids: v.array(v.id("todos")), completed: v.boolean() },
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.ids) {
      await ctx.db.patch(id, { completed: args.completed, updatedAt: Date.now() });
      results.push(await ctx.db.get(id));
    }
    return results;
  },
});

export const batchDelete = mutation({
  args: { ids: v.array(v.id("todos")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
    return { success: true, count: args.ids.length };
  },
});

export const clearCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const completed = await ctx.db
      .query("todos")
      .withIndex("by_completed", (q) => q.eq("completed", true))
      .collect();
    for (const todo of completed) {
      await ctx.db.delete(todo._id);
    }
    return { success: true, count: completed.length };
  },
});
