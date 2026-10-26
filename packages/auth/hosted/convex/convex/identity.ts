export type OAuthIdentityMode = 'run-scoped' | 'verified-github-account';
export type PrincipalKind = 'password' | 'github-run-scoped' | 'github-verified-primary';

export interface AuthIdentityConfig {
	runId: string;
	emailSuffix: string;
	oauthMode: OAuthIdentityMode;
	githubAccountId?: string;
	githubEmail?: string;
	primaryEmail?: string;
	secondaryEmail?: string;
}

export interface AccountIdentity {
	provider: string;
	providerAccountId: string;
	emailVerified?: string;
}

export type ExpectedPrincipalIdentity =
	| { principalKind: 'password'; email: string }
	| { principalKind: 'github-run-scoped'; email: string }
	| { principalKind: 'github-verified-primary'; email: string; githubAccountId: string };

const RUN_ID_PATTERN = /^[a-z0-9-]{8,64}$/i;
const GITHUB_ACCOUNT_ID_PATTERN = /^[1-9]\d*$/;

export function normalizeEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const email = value.trim().toLowerCase();
	if (
		!email ||
		/\s/.test(email) ||
		email.indexOf('@') <= 0 ||
		email.indexOf('@') !== email.lastIndexOf('@')
	) {
		return null;
	}
	return email;
}

export function isRunScopedEmail(value: unknown, runId: string, emailSuffix: string): boolean {
	const email = normalizeEmail(value);
	if (!email) return false;
	return email.endsWith(emailSuffix.toLowerCase()) && email.includes(runId.toLowerCase());
}

function requiredValue(env: Record<string, string | undefined>, key: string): string {
	const value = env[key];
	if (!value) throw new Error('Hosted auth fixture scope is not configured');
	return value;
}

export function loadAuthIdentityConfig(
	env: Record<string, string | undefined>
): AuthIdentityConfig {
	const runId = requiredValue(env, 'AFD_AUTH_TEST_RUN_ID');
	const emailSuffix = requiredValue(env, 'AFD_AUTH_TEST_EMAIL_SUFFIX').trim().toLowerCase();
	if (!RUN_ID_PATTERN.test(runId) || !emailSuffix) {
		throw new Error('Hosted auth fixture scope is invalid');
	}
	const mode = env.AFD_AUTH_TEST_OAUTH_IDENTITY_MODE ?? 'run-scoped';
	if (mode !== 'run-scoped' && mode !== 'verified-github-account') {
		throw new Error('Hosted OAuth identity mode is invalid');
	}
	if (mode === 'run-scoped') return { runId, emailSuffix, oauthMode: mode };

	const githubAccountId = requiredValue(env, 'AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID');
	const githubEmail = normalizeEmail(requiredValue(env, 'AFD_AUTH_TEST_OAUTH_EMAIL'));
	const primaryEmail = normalizeEmail(requiredValue(env, 'AFD_AUTH_TEST_PRIMARY_EMAIL'));
	const secondaryEmail = normalizeEmail(requiredValue(env, 'AFD_AUTH_TEST_SECONDARY_EMAIL'));
	if (
		!GITHUB_ACCOUNT_ID_PATTERN.test(githubAccountId) ||
		!Number.isSafeInteger(Number(githubAccountId))
	) {
		throw new Error('Hosted OAuth GitHub account ID is invalid');
	}
	if (!githubEmail || !primaryEmail || !secondaryEmail) {
		throw new Error('Hosted OAuth identity emails are invalid');
	}
	if (
		!isRunScopedEmail(primaryEmail, runId, emailSuffix) ||
		!isRunScopedEmail(secondaryEmail, runId, emailSuffix) ||
		primaryEmail === secondaryEmail ||
		githubEmail === primaryEmail ||
		githubEmail === secondaryEmail
	) {
		throw new Error('Hosted OAuth identity must be separate from the Password identities');
	}
	return {
		runId,
		emailSuffix,
		oauthMode: mode,
		githubAccountId,
		githubEmail,
		primaryEmail,
		secondaryEmail,
	};
}

export function verifiedPrimaryGitHubEmail(
	emails: readonly { email: unknown; primary: unknown; verified: unknown }[]
): string {
	const candidates = emails.filter((item) => item.primary === true && item.verified === true);
	if (candidates.length !== 1) {
		throw new Error('GitHub verified primary email is unavailable');
	}
	const primary = candidates.at(0);
	const email = normalizeEmail(primary?.email);
	if (!email) throw new Error('GitHub verified primary email is invalid');
	return email;
}

export function trustedGitHubUserInfo(
	profile: { id: unknown; [key: string]: unknown },
	emails: readonly { email: unknown; primary: unknown; verified: unknown }[]
) {
	const accountId = typeof profile.id === 'number' ? String(profile.id) : '';
	if (
		!Number.isSafeInteger(profile.id) ||
		Number(profile.id) <= 0 ||
		!GITHUB_ACCOUNT_ID_PATTERN.test(accountId)
	) {
		throw new Error('GitHub account identity is invalid');
	}
	const email = verifiedPrimaryGitHubEmail(emails);
	return {
		...profile,
		email,
		__afdGithubAccountId: accountId,
		__afdVerifiedPrimaryEmail: email,
	};
}

export function trustedGitHubAuthProfile(profile: Record<string, unknown>) {
	const accountId = profile.__afdGithubAccountId;
	const email = normalizeEmail(profile.__afdVerifiedPrimaryEmail);
	if (
		typeof accountId !== 'string' ||
		!GITHUB_ACCOUNT_ID_PATTERN.test(accountId) ||
		!email ||
		normalizeEmail(profile.email) !== email
	) {
		throw new Error('GitHub verified primary identity is unavailable');
	}
	const name = typeof profile.name === 'string' ? profile.name : profile.login;
	const image = profile.avatar_url;
	return {
		id: accountId,
		githubAccountId: accountId,
		email,
		emailVerified: true,
		...(typeof name === 'string' ? { name } : {}),
		...(typeof image === 'string' ? { image } : {}),
	};
}

export function validateGitHubAuthProfile(
	profile: Record<string, unknown>,
	identity: AuthIdentityConfig
): { accountId: string; email: string } {
	const accountId = profile.githubAccountId;
	const email = normalizeEmail(profile.email);
	if (
		typeof accountId !== 'string' ||
		!GITHUB_ACCOUNT_ID_PATTERN.test(accountId) ||
		profile.emailVerified !== true ||
		!email
	) {
		throw new Error('GitHub OAuth profile is not a verified primary identity');
	}
	if (identity.oauthMode === 'verified-github-account') {
		if (accountId !== identity.githubAccountId || email !== identity.githubEmail) {
			throw new Error('GitHub OAuth identity is outside the exact account allowlist');
		}
	} else if (!isRunScopedEmail(email, identity.runId, identity.emailSuffix)) {
		throw new Error('GitHub OAuth identity is outside the run scope');
	}
	return { accountId, email };
}

export function validatePasswordAuthProfile(
	profile: Record<string, unknown>,
	identity: AuthIdentityConfig
): { email: string; name?: string } {
	if (Object.keys(profile).some((key) => key !== 'email' && key !== 'name')) {
		throw new Error('Password profile contains unsupported identity fields');
	}
	const email = normalizeEmail(profile.email);
	if (!email || !isRunScopedEmail(email, identity.runId, identity.emailSuffix)) {
		throw new Error('Password identity is outside the run scope');
	}
	if (
		identity.oauthMode === 'verified-github-account' &&
		email !== identity.primaryEmail &&
		email !== identity.secondaryEmail
	) {
		throw new Error('Password identity is outside the two configured fixture accounts');
	}
	return { email, ...(typeof profile.name === 'string' ? { name: profile.name } : {}) };
}

export function preflightIdentityMatches(
	{
		expected,
		actualEmail,
		actualPrincipalKind,
		accounts,
	}: {
		expected: ExpectedPrincipalIdentity;
		actualEmail: unknown;
		actualPrincipalKind: PrincipalKind;
		accounts: readonly AccountIdentity[];
	},
	identity: AuthIdentityConfig
): boolean {
	const email = normalizeEmail(actualEmail);
	if (
		!email ||
		normalizeEmail(expected.email) !== email ||
		expected.principalKind !== actualPrincipalKind
	) {
		return false;
	}
	if (actualPrincipalKind === 'password') {
		if (identity.oauthMode === 'verified-github-account') {
			return email === identity.primaryEmail || email === identity.secondaryEmail;
		}
		return isRunScopedEmail(email, identity.runId, identity.emailSuffix);
	}
	const account = accounts.at(0);
	if (!account || accounts.length !== 1 || account.provider !== 'github') return false;
	if (actualPrincipalKind === 'github-run-scoped') {
		return (
			expected.principalKind === 'github-run-scoped' &&
			identity.oauthMode === 'run-scoped' &&
			isRunScopedEmail(email, identity.runId, identity.emailSuffix) &&
			normalizeEmail(account.emailVerified) === email
		);
	}
	return (
		expected.principalKind === 'github-verified-primary' &&
		identity.oauthMode === 'verified-github-account' &&
		expected.githubAccountId === identity.githubAccountId &&
		email === identity.githubEmail &&
		account.providerAccountId === identity.githubAccountId &&
		normalizeEmail(account.emailVerified) === email
	);
}

export function hasForeignRunRecords(
	records: readonly { runId: string }[],
	runId: string
): boolean {
	return records.some((record) => record.runId !== runId);
}

export function canReuseExistingAccount(
	accounts: readonly AccountIdentity[],
	provider: 'password' | 'github',
	providerAccountId: string
): boolean {
	const account = accounts.at(0);
	return (
		accounts.length === 1 &&
		account !== undefined &&
		account.provider === provider &&
		account.providerAccountId === providerAccountId
	);
}

export function canCreateOrReuseAccount(
	existingUserId: string | null,
	accounts: readonly AccountIdentity[],
	provider: 'password' | 'github',
	providerAccountId: string
): boolean {
	if (existingUserId === null) return accounts.length === 0;
	return canReuseExistingAccount(accounts, provider, providerAccountId);
}

export function classifyAuthPrincipal(
	value: {
		email: unknown;
		accounts: readonly AccountIdentity[];
	},
	identity: AuthIdentityConfig
): PrincipalKind | null {
	const email = normalizeEmail(value.email);
	if (!email || value.accounts.length === 0) return null;

	const githubAccounts = value.accounts.filter((account) => account.provider === 'github');
	if (githubAccounts.length > 0) {
		const account = githubAccounts.at(0);
		if (value.accounts.length !== 1 || githubAccounts.length !== 1 || !account) return null;
		if (normalizeEmail(account.emailVerified) !== email) return null;
		if (identity.oauthMode === 'verified-github-account') {
			return email === identity.githubEmail &&
				account.providerAccountId === identity.githubAccountId
				? 'github-verified-primary'
				: null;
		}
		return isRunScopedEmail(email, identity.runId, identity.emailSuffix)
			? 'github-run-scoped'
			: null;
	}

	const passwordAccount = value.accounts.at(0);
	if (
		value.accounts.length !== 1 ||
		!passwordAccount ||
		passwordAccount.provider !== 'password' ||
		passwordAccount.providerAccountId !== email ||
		!isRunScopedEmail(email, identity.runId, identity.emailSuffix) ||
		(identity.oauthMode === 'verified-github-account' &&
			email !== identity.primaryEmail &&
			email !== identity.secondaryEmail)
	) {
		return null;
	}
	return 'password';
}
