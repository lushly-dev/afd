import {
	canCreateOrReuseAccount,
	loadAuthIdentityConfig,
	validateGitHubAuthProfile,
	validatePasswordAuthProfile,
} from './identity.ts';

async function accountsForUser(ctx, userId) {
	return await ctx.db
		.query('authAccounts')
		.filter((query) => query.eq(query.field('userId'), userId))
		.collect();
}

async function assertEmailHasNoOtherOwner(ctx, email, existingUserId) {
	const users = await ctx.db
		.query('users')
		.filter((query) => query.eq(query.field('email'), email))
		.collect();
	if (users.some((user) => user._id !== existingUserId)) {
		throw new Error('Hosted auth identity cannot link by email');
	}
}

export async function createOrUpdateFixtureUser(ctx, { existingUserId, type, provider, profile }) {
	const identity = loadAuthIdentityConfig(process.env);
	let providerAccountId;
	let providerId;
	let userData;

	if (provider.id === 'password' && type === 'credentials') {
		const passwordProfile = validatePasswordAuthProfile(profile, identity);
		providerId = 'password';
		providerAccountId = passwordProfile.email;
		userData = passwordProfile;
	} else if (provider.id === 'github' && type === 'oauth') {
		const githubProfile = validateGitHubAuthProfile(profile, identity);
		providerId = 'github';
		providerAccountId = githubProfile.accountId;
		userData = {
			email: githubProfile.email,
			...(typeof profile.name === 'string' ? { name: profile.name } : {}),
			...(typeof profile.image === 'string' ? { image: profile.image } : {}),
			emailVerificationTime: Date.now(),
		};
	} else {
		throw new Error('Hosted auth provider is outside the fixture scope');
	}

	const accounts = existingUserId === null ? [] : await accountsForUser(ctx, existingUserId);
	if (!canCreateOrReuseAccount(existingUserId, accounts, providerId, providerAccountId)) {
		throw new Error('Hosted auth identity cannot link to another provider account');
	}
	await assertEmailHasNoOtherOwner(ctx, userData.email, existingUserId);
	if (existingUserId === null) return await ctx.db.insert('users', userData);
	await ctx.db.patch('users', existingUserId, userData);
	return existingUserId;
}
