import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

export const list = query({
	args: {
		folderId: v.optional(v.id('noteFolders')),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		if (args.folderId) {
			return await ctx.db
				.query('notes')
				.withIndex('by_folder', (q) => q.eq('folderId', args.folderId))
				.filter((q) => q.eq(q.field('userId'), userId))
				.collect();
		}

		return await ctx.db
			.query('notes')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect();
	},
});

export const get = query({
	args: { id: v.id('notes') },
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}
		const note = await ctx.db.get(args.id);
		if (!note || note.userId !== userId) {
			return null;
		}
		return note;
	},
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const create = mutation({
	args: {
		title: v.string(),
		content: v.optional(v.string()),
		folderId: v.optional(v.id('noteFolders')),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		const now = Date.now();
		const id = await ctx.db.insert('notes', {
			title: args.title,
			content: args.content ?? '',
			folderId: args.folderId,
			userId: userId,
			createdAt: now,
			updatedAt: now,
		});
		return await ctx.db.get(id);
	},
});

export const update = mutation({
	args: {
		id: v.id('notes'),
		title: v.optional(v.string()),
		content: v.optional(v.string()),
		folderId: v.optional(v.id('noteFolders')),
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Note not found');
		if (existing.userId !== userId) throw new Error('Unauthorized');

		await ctx.db.patch(id, {
			...updates,
			updatedAt: Date.now(),
		});
		return await ctx.db.get(id);
	},
});

export const remove = mutation({
	args: { id: v.id('notes') },
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) {
			throw new Error('Unauthorized');
		}

		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error('Note not found');
		if (existing.userId !== userId) throw new Error('Unauthorized');

		await ctx.db.delete(args.id);
		return { success: true, id: args.id };
	},
});
