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

  lists: defineTable({
    name: v.string(),
    color: v.optional(v.string()),
    todoIds: v.array(v.id("todos")),
    userId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  notes: defineTable({
    title: v.string(),
    content: v.string(),
    folderId: v.optional(v.id("noteFolders")),
    userId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_folder", ["folderId"]),

  noteFolders: defineTable({
    name: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Agent sessions for lushx Control Center
  agentSessions: defineTable({
    agentId: v.string(), // Unique identifier (e.g., "agent-abc123")
    workflow: v.string(), // e.g., "review", "feature"
    issue: v.optional(v.string()), // GitHub issue reference
    state: v.union(
      v.literal("running"),
      v.literal("paused"),
      v.literal("stopped"),
      v.literal("complete")
    ),
    pane: v.number(), // 0 for MVP (single pane)
    outputLines: v.number(), // For progress tracking
    createdAt: v.number(), // Timestamp
    updatedAt: v.number(), // Last state change
  })
    .index("by_agentId", ["agentId"])
    .index("by_state", ["state"])
    .index("by_workflow", ["workflow"]),
});
