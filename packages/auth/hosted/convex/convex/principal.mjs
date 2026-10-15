import { getAuthUserId } from '@convex-dev/auth/server';
import { classifyAuthPrincipal, loadAuthIdentityConfig } from './identity.ts';

export async function resolveCurrentPrincipal(ctx, configuredIdentity) {
	const userId = await getAuthUserId(ctx);
	if (userId === null) return { kind: 'unauthenticated' };

	const identity = configuredIdentity ?? loadAuthIdentityConfig(process.env);
	const user = await ctx.db.get('users', userId);
	const accounts = await ctx.db
		.query('authAccounts')
		.filter((query) => query.eq(query.field('userId'), userId))
		.collect();
	const principalKind = classifyAuthPrincipal({ email: user?.email, accounts }, identity);
	if (!principalKind) return { kind: 'forbidden' };
	return { kind: 'authenticated', principalKind, userId, user, accounts, identity };
}

export async function currentUserProfile(ctx, configuredIdentity) {
	const principal = await resolveCurrentPrincipal(ctx, configuredIdentity);
	if (principal.kind !== 'authenticated' || typeof principal.user?.email !== 'string') return null;
	return {
		id: principal.userId,
		email: principal.user.email,
		...(typeof principal.user.name === 'string' ? { name: principal.user.name } : {}),
		...(typeof principal.user.image === 'string' ? { image: principal.user.image } : {}),
	};
}
