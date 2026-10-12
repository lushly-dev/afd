import GitHub from '@auth/core/providers/github';
import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';

function requiredScope() {
	const runId = process.env.AFD_AUTH_TEST_RUN_ID;
	const emailSuffix = process.env.AFD_AUTH_TEST_EMAIL_SUFFIX;
	if (!runId || !emailSuffix) {
		throw new Error('Hosted auth fixture scope is not configured');
	}
	return { runId, emailSuffix: emailSuffix.toLowerCase() };
}

function assertSyntheticEmail(value: unknown) {
	const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
	const { runId, emailSuffix } = requiredScope();
	if (!email.endsWith(emailSuffix) || !email.includes(runId.toLowerCase())) {
		throw new Error('Account is outside the configured hosted auth test scope');
	}
	return email;
}

function oauthProvider() {
	const clientId = process.env.AUTH_GITHUB_ID;
	const clientSecret = process.env.AUTH_GITHUB_SECRET;
	if (!clientId && !clientSecret) return [];
	if (!clientId || !clientSecret) {
		throw new Error('Both AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are required for GitHub OAuth');
	}
	return [GitHub({ clientId, clientSecret })];
}

function urlOrigin(value: string) {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [
		Password({
			profile(params) {
				return { email: assertSyntheticEmail(params.email), name: String(params.name ?? '') };
			},
		}),
		...oauthProvider(),
	],
	callbacks: {
		async afterUserCreatedOrUpdated(ctx, { userId }) {
			const user = await ctx.db.get('users', userId);
			assertSyntheticEmail(user?.email);
		},
		async beforeSessionCreation(ctx, { userId }) {
			const user = await ctx.db.get('users', userId);
			assertSyntheticEmail(user?.email);
		},
		async redirect({ redirectTo }) {
			const expected = process.env.AFD_AUTH_TEST_RETURN_URL;
			const expectedOrigin = expected ? urlOrigin(expected) : null;
			if (!expectedOrigin || urlOrigin(redirectTo) !== expectedOrigin) {
				throw new Error('OAuth return URL is outside the configured hosted auth test origin');
			}
			return redirectTo;
		},
	},
});
