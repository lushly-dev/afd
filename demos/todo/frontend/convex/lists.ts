import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

export const list = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}
		return await ctx.db
			.query('lists')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect();
	},
});

export const get = query({
	args: { id: v.id('lists') },
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}
		const list = await ctx.db.get(args.id);
		if (!list || list.userId !== userId) {
			return null;
		}
		return list;
	},
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const create = mutation({
	args: {
		name: v.string(),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		const now = Date.now();
		const id = await ctx.db.insert('lists', {
			name: args.name,
			color: args.color,
			todoIds: [],
			userId: userId,
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: {
		id: v.id('lists'),
		name: v.optional(v.string()),
		color: v.optional(v.string()),
		todoIds: v.optional(v.array(v.id('todos'))),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('List not found');
		if (existing.userId !== userId) throw new Error('Unauthorized');

		await ctx.db.patch(id, {
			...updates,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(id);
	},
});

export const remove = mutation({
	args: { id: v.id('lists') },
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error('List not found');
		if (existing.userId !== userId) throw new Error('Unauthorized');

		await ctx.db.delete(args.id);
		return { success: true, id: args.id };
	},
});
