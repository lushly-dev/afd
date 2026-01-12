import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  todos: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    completed: v.boolean(),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    createdAt: v.number(),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_completed", ["completed"])
    .index("by_priority", ["priority"])
    .index("by_createdAt", ["createdAt"])
    .index("by_user", ["userId"])
    .index("by_user_completed", ["userId", "completed"]),
});
