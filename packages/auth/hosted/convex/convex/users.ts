import { queryGeneric } from 'convex/server';
import { v } from 'convex/values';
import { currentUserProfile } from './principal.mjs';

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
		return await currentUserProfile(ctx);
	},
});
