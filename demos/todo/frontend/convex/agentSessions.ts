import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// Agent session state type
const sessionState = v.union(
  v.literal("running"),
  v.literal("paused"),
  v.literal("stopped"),
  v.literal("complete")
);

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES (Read operations)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get status of a specific agent session by agentId
 * Used by: agent-status MCP tool
 */
export const getStatus = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("agentSessions")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();

    if (!session) {
      return null;
    }

    return {
      agentId: session.agentId,
      state: session.state,
      pane: session.pane,
      outputLines: session.outputLines,
      updatedAt: session.updatedAt,
      workflow: session.workflow,
      issue: session.issue,
    };
  },
});

/**
 * List all agent sessions, optionally filtered by state
 * Used by: Control Center for session list, lushx-entry for active sessions
 */
export const list = query({
  args: {
    state: v.optional(sessionState),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sessions = args.state
      ? await ctx.db.query("agentSessions").withIndex("by_state", (q) => q.eq("state", args.state!)).order("desc").collect()
      : await ctx.db.query("agentSessions").order("desc").collect();

    // Apply limit if provided
    const limited = args.limit ? sessions.slice(0, args.limit) : sessions;

    return limited.map((session) => ({
      agentId: session.agentId,
      workflow: session.workflow,
      issue: session.issue,
      state: session.state,
      pane: session.pane,
      outputLines: session.outputLines,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATIONS (Write operations)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new agent session
 * Used by: agent-spawn MCP tool
 */
export const create = mutation({
  args: {
    agentId: v.string(),
    workflow: v.string(),
    issue: v.optional(v.string()),
    pane: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if session with this agentId already exists
    const existing = await ctx.db
      .query("agentSessions")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();

    if (existing) {
      throw new Error(`Session with agentId "${args.agentId}" already exists`);
    }

    const now = Date.now();
    const id = await ctx.db.insert("agentSessions", {
      agentId: args.agentId,
      workflow: args.workflow,
      issue: args.issue,
      state: "running",
      pane: args.pane ?? 0, // MVP: single pane (0)
      outputLines: 0,
      createdAt: now,
      updatedAt: now,
    });

    const session = await ctx.db.get(id);
    return {
      agentId: session!.agentId,
      workflow: session!.workflow,
      issue: session!.issue,
      state: session!.state,
      pane: session!.pane,
      createdAt: session!.createdAt,
    };
  },
});

/**
 * Update session status (state and/or outputLines)
 * Used by: agent-finish MCP tool, Control Center buttons
 */
export const updateStatus = mutation({
  args: {
    agentId: v.string(),
    state: v.optional(sessionState),
    outputLines: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("agentSessions")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();

    if (!session) {
      throw new Error(`Session with agentId "${args.agentId}" not found`);
    }

    // Build update object with only provided fields
    const updates: {
      state?: "running" | "paused" | "stopped" | "complete";
      outputLines?: number;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.state !== undefined) {
      updates.state = args.state;
    }
    if (args.outputLines !== undefined) {
      updates.outputLines = args.outputLines;
    }

    await ctx.db.patch(session._id, updates);

    const updated = await ctx.db.get(session._id);
    return {
      agentId: updated!.agentId,
      state: updated!.state,
      pane: updated!.pane,
      outputLines: updated!.outputLines,
      updatedAt: updated!.updatedAt,
    };
  },
});
