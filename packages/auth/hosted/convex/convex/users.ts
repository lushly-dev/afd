import { getAuthUserId } from '@convex-dev/auth/server';
import { queryGeneric } from 'convex/server';
import { v } from 'convex/values';

export const me = queryGeneric({
	args: {},
	returns: v.union(
		v.null(),
		v.object({
			id: v.string(),
			email: v.string(),
			name: v.optional(v.string()),
			image: v.optional(v.string()),
		})
	),
	async handler(ctx) {
		const userId = await getAuthUserId(ctx);
		if (userId === null) return null;
		const user = await ctx.db.get('users', userId);
		if (!user || typeof user.email !== 'string') return null;
		return {
			id: user._id,
			email: user.email,
			...(typeof user.name === 'string' ? { name: user.name } : {}),
			...(typeof user.image === 'string' ? { image: user.image } : {}),
		};
	},
});
