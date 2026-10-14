import type { GitHubProfile } from '@auth/core/providers/github';
import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { createGitHubOAuthProvider } from './github_provider.mjs';
import {
	classifyAuthPrincipal,
	loadAuthIdentityConfig,
	trustedGitHubAuthProfile,
	trustedGitHubUserInfo,
	validatePasswordAuthProfile,
} from './identity.js';
import { createOrUpdateFixtureUser } from './oauth_user.mjs';

type AuthCallbacks = NonNullable<Parameters<typeof convexAuth>[0]['callbacks']>;
type CreateOrUpdateUser = NonNullable<AuthCallbacks['createOrUpdateUser']>;
type BeforeSessionCreation = NonNullable<AuthCallbacks['beforeSessionCreation']>;
type AuthMutationContext = Parameters<CreateOrUpdateUser>[0];
type AuthUserId = NonNullable<Parameters<CreateOrUpdateUser>[1]['existingUserId']>;
type SessionMutationContext = Parameters<BeforeSessionCreation>[0];

function oauthProvider() {
	const clientId = process.env.AUTH_GITHUB_ID;
	const clientSecret = process.env.AUTH_GITHUB_SECRET;
	const identity = loadAuthIdentityConfig(process.env);
	if (!clientId && !clientSecret) {
		if (identity.oauthMode === 'verified-github-account') {
			throw new Error('GitHub OAuth credentials are required for the configured identity mode');
		}
		return [];
	}
	if (!clientId || !clientSecret) {
		throw new Error('Both AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are required for GitHub OAuth');
	}
	return [
		createGitHubOAuthProvider({
			clientId,
			clientSecret,
			trustedUserInfo: (profile, emails) =>
				trustedGitHubUserInfo(profile, emails) as unknown as GitHubProfile,
			trustedProfile: trustedGitHubAuthProfile,
		}),
	];
}

async function accountsForUser(ctx: AuthMutationContext, userId: AuthUserId) {
	return await ctx.db
		.query('authAccounts')
		.filter((query) => query.eq(query.field('userId'), userId))
		.collect();
}

async function validateSessionPrincipal(ctx: SessionMutationContext, userId: AuthUserId) {
	const identity = loadAuthIdentityConfig(process.env);
	const user = await ctx.db.get('users', userId);
	const accounts = await accountsForUser(ctx, userId);
	if (!classifyAuthPrincipal({ email: user?.email, accounts }, identity)) {
		throw new Error('Hosted auth principal is outside the configured identity scope');
	}
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [
		Password({
			profile(params) {
				const identity = loadAuthIdentityConfig(process.env);
				return validatePasswordAuthProfile(
					{ email: params.email, name: String(params.name ?? '') },
					identity
				);
			},
		}),
		...oauthProvider(),
	],
	callbacks: {
		createOrUpdateUser: createOrUpdateFixtureUser,
		async beforeSessionCreation(ctx, { userId }) {
			await validateSessionPrincipal(ctx, userId);
		},
		async redirect({ redirectTo }) {
			const expected = process.env.AFD_AUTH_TEST_RETURN_URL;
			let expectedOrigin: string | null = null;
			let actualOrigin: string | null = null;
			try {
				expectedOrigin = expected ? new URL(expected).origin : null;
				actualOrigin = new URL(redirectTo).origin;
			} catch {
				// The safe failure below avoids retaining any URL supplied by a caller.
			}
			if (!expectedOrigin || actualOrigin !== expectedOrigin) {
				throw new Error('OAuth return URL is outside the configured hosted auth test origin');
			}
			return redirectTo;
		},
	},
});
