import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeProvider } from '../../../node_modules/@convex-dev/auth/dist/server/provider_utils.js';
import { createGitHubOAuthProvider } from './github_provider.mjs';
import {
	canCreateOrReuseAccount,
	canReuseExistingAccount,
	classifyAuthPrincipal,
	hasForeignRunRecords,
	loadAuthIdentityConfig,
	preflightIdentityMatches,
	trustedGitHubAuthProfile,
	trustedGitHubUserInfo,
	validateGitHubAuthProfile,
	validatePasswordAuthProfile,
	verifiedPrimaryGitHubEmail,
} from './identity.ts';

const runId = 'run-12345678';
const defaultEnvironment = {
	AFD_AUTH_TEST_RUN_ID: runId,
	AFD_AUTH_TEST_EMAIL_SUFFIX: '@fixture.example',
};
const stableEnvironment = {
	...defaultEnvironment,
	AFD_AUTH_TEST_OAUTH_IDENTITY_MODE: 'verified-github-account',
	AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '7654321',
	AFD_AUTH_TEST_OAUTH_EMAIL: 'Owner@External.Example',
	AFD_AUTH_TEST_PRIMARY_EMAIL: `${runId}-a@fixture.example`,
	AFD_AUTH_TEST_SECONDARY_EMAIL: `${runId}-b@fixture.example`,
};
const stableProfile = {
	id: '7654321',
	githubAccountId: '7654321',
	email: 'owner@external.example',
	emailVerified: true,
};

test('default backend identity mode remains run-scoped for OAuth and Password', () => {
	const identity = loadAuthIdentityConfig(defaultEnvironment);
	assert.equal(identity.oauthMode, 'run-scoped');
	assert.deepEqual(validatePasswordAuthProfile({ email: `${runId}-a@fixture.example` }, identity), {
		email: `${runId}-a@fixture.example`,
	});
	assert.deepEqual(
		validateGitHubAuthProfile(
			{
				id: '7654321',
				githubAccountId: '7654321',
				email: `${runId}-oauth@fixture.example`,
				emailVerified: true,
			},
			identity
		),
		{ accountId: '7654321', email: `${runId}-oauth@fixture.example` }
	);
	assert.throws(
		() => validatePasswordAuthProfile({ email: 'owner@external.example' }, identity),
		/run scope/
	);
});

test('reusable mode requires a canonical GitHub ID and three distinct configured identities', () => {
	const identity = loadAuthIdentityConfig(stableEnvironment);
	assert.equal(identity.oauthMode, 'verified-github-account');
	assert.equal(identity.githubAccountId, '7654321');
	assert.equal(identity.githubEmail, 'owner@external.example');
	for (const overrides of [
		{ AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '' },
		{ AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '07654321' },
		{ AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '999999999999999999999' },
		{ AFD_AUTH_TEST_OAUTH_EMAIL: 'not-an-email' },
		{ AFD_AUTH_TEST_OAUTH_EMAIL: `${runId}-a@fixture.example` },
		{ AFD_AUTH_TEST_PRIMARY_EMAIL: 'primary@fixture.example' },
		{ AFD_AUTH_TEST_SECONDARY_EMAIL: `${runId}-a@fixture.example` },
	]) {
		assert.throws(() => loadAuthIdentityConfig({ ...stableEnvironment, ...overrides }));
	}
	assert.throws(
		() =>
			loadAuthIdentityConfig({
				...stableEnvironment,
				AFD_AUTH_TEST_OAUTH_IDENTITY_MODE: 'email-only',
			}),
		/identity mode is invalid/
	);
});

test('GitHub email policy accepts only one verified primary email and ignores public profile email', () => {
	const emails = [
		{ email: 'unverified@external.example', primary: false, verified: false },
		{ email: 'Owner@External.Example', primary: true, verified: true },
	];
	assert.equal(verifiedPrimaryGitHubEmail(emails), 'owner@external.example');
	const userInfo = trustedGitHubUserInfo(
		{ id: 7654321, email: 'public@external.example', login: 'fixture-user' },
		emails
	);
	assert.equal(userInfo.email, 'owner@external.example');
	const authProfile = trustedGitHubAuthProfile(userInfo);
	assert.equal(authProfile.id, '7654321');
	assert.equal(authProfile.githubAccountId, '7654321');
	assert.equal(authProfile.email, 'owner@external.example');
	assert.equal(authProfile.emailVerified, true);
	for (const invalidEmails of [
		[{ email: 'private@external.example', primary: false, verified: true }],
		[{ email: 'private@external.example', primary: true, verified: false }],
		[
			{ email: 'first@external.example', primary: true, verified: true },
			{ email: 'second@external.example', primary: true, verified: true },
		],
	]) {
		assert.throws(() => verifiedPrimaryGitHubEmail(invalidEmails));
	}
	assert.throws(() => trustedGitHubUserInfo({ id: 0 }, emails), /account identity is invalid/);
});

test('configured GitHub provider bounds trusted userinfo and preserves identity through Auth Core profile stripping', async () => {
	const calls = [];
	const fetcher = async (url, options) => {
		calls.push({ url, options });
		const body =
			url === 'https://api.github.com/user'
				? { id: 7654321, email: 'public@external.example', login: 'fixture-user' }
				: [
						{
							email: 'owner@external.example',
							primary: true,
							verified: true,
							visibility: 'private',
						},
					];
		return new Response(JSON.stringify(body), {
			headers: { 'Content-Type': 'application/json' },
		});
	};
	const providerConfig = createGitHubOAuthProvider({
		clientId: 'fixture-client-id',
		clientSecret: 'fixture-client-secret',
		fetcher,
		trustedUserInfo: trustedGitHubUserInfo,
		trustedProfile: trustedGitHubAuthProfile,
	});
	const provider = materializeProvider(providerConfig);
	const tokens = { access_token: 'fixture-access-token' };
	const rawProfile = await provider.userinfo.request({ tokens, provider });
	const authProfile = provider.profile(rawProfile, tokens);
	assert.equal(authProfile.id, '7654321');
	assert.equal(authProfile.githubAccountId, '7654321');
	assert.equal(authProfile.email, 'owner@external.example');
	assert.equal(authProfile.emailVerified, true);
	assert.equal(provider.authorization.params.scope, 'read:user user:email');
	assert.equal(calls.length, 2);
	assert.deepEqual(calls.map(({ url }) => url).sort(), [
		'https://api.github.com/user',
		'https://api.github.com/user/emails',
	]);
	for (const { options } of calls) {
		assert.equal(options.redirect, 'error');
		assert.equal(options.headers.Authorization, 'Bearer fixture-access-token');
		assert.ok(options.signal instanceof AbortSignal);
	}

	// Convex Auth 0.0.95 materializes the configured Auth.js callbacks, then strips
	// the provider profile ID into providerAccountId before calling createOrUpdateUser.
	const { id: providerAccountId, ...callbackProfile } = authProfile;
	const identity = loadAuthIdentityConfig(stableEnvironment);
	assert.equal(providerAccountId, '7654321');
	assert.deepEqual(validateGitHubAuthProfile(callbackProfile, identity), {
		accountId: '7654321',
		email: 'owner@external.example',
	});
	assert.equal(canCreateOrReuseAccount(null, [], 'github', providerAccountId), true);
	const account = {
		provider: 'github',
		providerAccountId,
		emailVerified: callbackProfile.email,
	};
	assert.equal(validateGitHubAuthProfile(callbackProfile, identity).accountId, providerAccountId);
	assert.equal(
		canCreateOrReuseAccount('github-user-id', [account], 'github', providerAccountId),
		true
	);
	assert.equal(canCreateOrReuseAccount('github-user-id', [account], 'github', '7654322'), false);
	assert.equal(
		classifyAuthPrincipal({ email: callbackProfile.email, accounts: [account] }, identity),
		'github-verified-primary'
	);

	const oversizedFetcher = async () =>
		new Response(JSON.stringify({ id: 7654321, detail: 'x'.repeat(70 * 1024) }), {
			headers: { 'Content-Type': 'application/json' },
		});
	const boundedProviderConfig = createGitHubOAuthProvider({
		clientId: 'fixture-client-id',
		clientSecret: 'fixture-client-secret',
		fetcher: oversizedFetcher,
		trustedUserInfo: trustedGitHubUserInfo,
		trustedProfile: trustedGitHubAuthProfile,
	});
	const boundedProvider = materializeProvider(boundedProviderConfig);
	await assert.rejects(
		() => boundedProvider.userinfo.request({ tokens, provider: boundedProvider }),
		(error) => error.message === 'GitHub verified primary identity lookup failed'
	);
});

test('OAuth backend rejects unverified, mismatched, forged, and non-allowlisted profiles', () => {
	const identity = loadAuthIdentityConfig(stableEnvironment);
	assert.deepEqual(validateGitHubAuthProfile(stableProfile, identity), {
		accountId: '7654321',
		email: 'owner@external.example',
	});
	for (const profile of [
		{ ...stableProfile, githubAccountId: '7654322' },
		{ ...stableProfile, email: 'other@external.example' },
		{ ...stableProfile, emailVerified: false },
		{ ...stableProfile, email: 'owner@external.example', emailVerified: 'owner@external.example' },
	]) {
		assert.throws(() => validateGitHubAuthProfile(profile, identity));
	}
	const runScoped = loadAuthIdentityConfig(defaultEnvironment);
	assert.throws(() => validateGitHubAuthProfile(stableProfile, runScoped), /run scope/);
});

test('Password profile cannot forge GitHub identity or verified-email fields', () => {
	const identity = loadAuthIdentityConfig(stableEnvironment);
	const allowedEmail = `${runId}-a@fixture.example`;
	assert.throws(
		() =>
			validatePasswordAuthProfile(
				{ email: allowedEmail, githubAccountId: '7654321', emailVerified: true },
				identity
			),
		/unsupported identity fields/
	);
	assert.throws(
		() => validatePasswordAuthProfile({ email: 'owner@external.example', name: 'spoof' }, identity),
		/run scope/
	);
	assert.throws(
		() => validatePasswordAuthProfile({ email: `${runId}-third@fixture.example` }, identity),
		/two configured fixture accounts/
	);
});

test('account reuse blocks Password-to-GitHub linking and unexpected accounts', () => {
	const githubAccount = {
		provider: 'github',
		providerAccountId: '7654321',
		emailVerified: 'owner@external.example',
	};
	assert.equal(canCreateOrReuseAccount(null, [], 'github', '7654321'), true);
	assert.equal(
		canCreateOrReuseAccount('github-user-id', [githubAccount], 'github', '7654321'),
		true
	);
	assert.equal(
		canCreateOrReuseAccount('github-user-id', [githubAccount], 'github', '7654322'),
		false
	);
	assert.equal(canReuseExistingAccount([githubAccount], 'github', '7654321'), true);
	assert.equal(canReuseExistingAccount([githubAccount], 'github', '7654322'), false);
	assert.equal(
		canCreateOrReuseAccount(
			'password-user-id',
			[{ provider: 'password', providerAccountId: `${runId}-a@fixture.example` }],
			'github',
			'7654321'
		),
		false
	);
	assert.equal(
		canCreateOrReuseAccount(
			'github-user-id',
			[{ provider: 'github', providerAccountId: '7654321', emailVerified: stableProfile.email }],
			'password',
			`${runId}-a@fixture.example`
		),
		false
	);
	assert.equal(canCreateOrReuseAccount(null, [githubAccount], 'github', '7654321'), false);
	assert.equal(canReuseExistingAccount([githubAccount, githubAccount], 'github', '7654321'), false);
});

test('session and protected-function principal classification is exact in both modes', () => {
	const stableIdentity = loadAuthIdentityConfig(stableEnvironment);
	assert.equal(
		classifyAuthPrincipal(
			{
				email: stableProfile.email,
				accounts: [
					{ provider: 'github', providerAccountId: '7654321', emailVerified: stableProfile.email },
				],
			},
			stableIdentity
		),
		'github-verified-primary'
	);
	for (const accounts of [
		[{ provider: 'github', providerAccountId: '7654322', emailVerified: stableProfile.email }],
		[{ provider: 'github', providerAccountId: '7654321', emailVerified: 'other@external.example' }],
		[
			{ provider: 'github', providerAccountId: '7654321', emailVerified: stableProfile.email },
			{ provider: 'password', providerAccountId: `${runId}-a@fixture.example` },
		],
	]) {
		assert.equal(
			classifyAuthPrincipal({ email: stableProfile.email, accounts }, stableIdentity),
			null
		);
	}
	assert.equal(
		classifyAuthPrincipal(
			{
				email: `${runId}-a@fixture.example`,
				accounts: [{ provider: 'password', providerAccountId: `${runId}-a@fixture.example` }],
			},
			stableIdentity
		),
		'password'
	);
	const expectedOAuthIdentity = {
		principalKind: 'github-verified-primary',
		email: stableProfile.email,
		githubAccountId: '7654321',
	};
	const stableAccount = {
		provider: 'github',
		providerAccountId: '7654321',
		emailVerified: stableProfile.email,
	};
	assert.equal(
		preflightIdentityMatches(
			{
				expected: expectedOAuthIdentity,
				actualEmail: stableProfile.email,
				actualPrincipalKind: 'github-verified-primary',
				accounts: [stableAccount],
			},
			stableIdentity
		),
		true
	);
	assert.equal(
		preflightIdentityMatches(
			{
				expected: { ...expectedOAuthIdentity, email: 'different@external.example' },
				actualEmail: stableProfile.email,
				actualPrincipalKind: 'github-verified-primary',
				accounts: [stableAccount],
			},
			stableIdentity
		),
		false
	);
	assert.equal(
		preflightIdentityMatches(
			{
				expected: { ...expectedOAuthIdentity, githubAccountId: '7654322' },
				actualEmail: stableProfile.email,
				actualPrincipalKind: 'github-verified-primary',
				accounts: [stableAccount],
			},
			stableIdentity
		),
		false
	);
	assert.equal(
		preflightIdentityMatches(
			{
				expected: { principalKind: 'password', email: `${runId}-third@fixture.example` },
				actualEmail: `${runId}-third@fixture.example`,
				actualPrincipalKind: 'password',
				accounts: [{ provider: 'password', providerAccountId: `${runId}-third@fixture.example` }],
			},
			stableIdentity
		),
		false
	);
	assert.equal(
		classifyAuthPrincipal(
			{
				email: `${runId}-oauth@fixture.example`,
				accounts: [
					{
						provider: 'github',
						providerAccountId: '7654321',
						emailVerified: `${runId}-oauth@fixture.example`,
					},
				],
			},
			loadAuthIdentityConfig(defaultEnvironment)
		),
		'github-run-scoped'
	);
	assert.equal(
		classifyAuthPrincipal(
			{
				email: `${runId}-a@fixture.example`,
				accounts: [{ provider: 'password', providerAccountId: 'different@fixture.example' }],
			},
			stableIdentity
		),
		null
	);
	assert.equal(
		classifyAuthPrincipal(
			{
				email: `${runId}-third@fixture.example`,
				accounts: [
					{
						provider: 'password',
						providerAccountId: `${runId}-third@fixture.example`,
					},
				],
			},
			stableIdentity
		),
		null
	);
});

test('cleanup refuses an authenticated principal with records from another run', () => {
	assert.equal(hasForeignRunRecords([{ runId }], runId), false);
	assert.equal(hasForeignRunRecords([{ runId }, { runId: 'run-87654321' }], runId), true);
});
