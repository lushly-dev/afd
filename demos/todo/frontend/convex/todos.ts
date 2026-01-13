import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES (Read operations)
// ═══════════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    return await ctx.db
      .query("todos")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    // Use indexes for better performance - get completed and pending counts separately
    const completedTodos = await ctx.db
      .query("todos")
      .withIndex("by_user_completed", (q) => q.eq("userId", userId).eq("completed", true))
      .collect();
    const pendingTodos = await ctx.db
      .query("todos")
      .withIndex("by_user_completed", (q) => q.eq("userId", userId).eq("completed", false))
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const id = await ctx.db.insert("todos", {
      title: args.title,
      description: args.description,
      completed: false,
      priority: args.priority ?? "medium",
      createdAt: now,
      updatedAt: now,
      userId: userId,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Todo not found");
    if (existing.userId !== userId) throw new Error("Unauthorized to update this todo");

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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Todo not found");
    if (existing.userId !== userId) throw new Error("Unauthorized to toggle this todo");

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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Todo not found");
    if (existing.userId !== userId) throw new Error("Unauthorized to delete this todo");

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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const results = [];
    for (const id of args.ids) {
      const existing = await ctx.db.get(id);
      if (!existing) throw new Error(`Todo ${id} not found`);
      if (existing.userId !== userId) throw new Error(`Unauthorized to toggle todo ${id}`);

      await ctx.db.patch(id, { completed: args.completed, updatedAt: Date.now() });
      results.push(await ctx.db.get(id));
    }
    return results;
  },
});

export const batchDelete = mutation({
  args: { ids: v.array(v.id("todos")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    for (const id of args.ids) {
      const existing = await ctx.db.get(id);
      if (!existing) throw new Error(`Todo ${id} not found`);
      if (existing.userId !== userId) throw new Error(`Unauthorized to delete todo ${id}`);

      await ctx.db.delete(id);
    }
    return { success: true, count: args.ids.length };
  },
});

export const clearCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const completed = await ctx.db
      .query("todos")
      .withIndex("by_user_completed", (q) => q.eq("userId", userId).eq("completed", true))
      .collect();
    for (const todo of completed) {
      await ctx.db.delete(todo._id);
    }
    return { success: true, count: completed.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL QUERIES/MUTATIONS (For system/chat access - no auth required)
// Used by HTTP endpoints for AI chat integration
// ═══════════════════════════════════════════════════════════════════════════════

import { internalQuery, internalMutation } from "./_generated/server";

export const systemList = internalQuery({
  args: {
    userId: v.optional(v.string()),
    completed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let todos;
    if (args.userId) {
      todos = await ctx.db
        .query("todos")
        .order("desc")
        .collect();
      // Filter by userId (as string comparison, since system may not have proper Id)
      todos = todos.filter(t => String(t.userId) === args.userId);
    } else {
      // Return all todos (for system overview)
      todos = await ctx.db.query("todos").order("desc").take(args.limit ?? 100);
    }
    
    if (args.completed !== undefined) {
      todos = todos.filter(t => t.completed === args.completed);
    }
    if (args.limit && todos.length > args.limit) {
      todos = todos.slice(0, args.limit);
    }
    return todos;
  },
});

export const systemStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const todos = await ctx.db.query("todos").collect();
    const completed = todos.filter(t => t.completed).length;
    const pending = todos.filter(t => !t.completed).length;
    return {
      total: todos.length,
      completed,
      pending,
      byPriority: {
        high: todos.filter(t => t.priority === "high").length,
        medium: todos.filter(t => t.priority === "medium").length,
        low: todos.filter(t => t.priority === "low").length,
      },
    };
  },
});

export const systemCreate = internalMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // For system creates, we need a valid user ID
    // Get the first user if none specified
    let userId = args.userId;
    if (!userId) {
      const users = await ctx.db.query("users").first();
      userId = users?._id;
    }
    if (!userId) {
      throw new Error("No users found - cannot create todo without user");
    }
    
    const id = await ctx.db.insert("todos", {
      title: args.title,
      description: args.description,
      completed: false,
      priority: args.priority ?? "medium",
      createdAt: now,
      updatedAt: now,
      userId: userId as any, // Allow string or Id
    });
    return await ctx.db.get(id);
  },
});

export const systemToggle = internalMutation({
  args: {
    id: v.id("todos"),
  },
  handler: async (ctx, args) => {
    const todo = await ctx.db.get(args.id);
    if (!todo) {
      throw new Error("Todo not found");
    }
    await ctx.db.patch(args.id, {
      completed: !todo.completed,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

export const systemDelete = internalMutation({
  args: {
    id: v.id("todos"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
