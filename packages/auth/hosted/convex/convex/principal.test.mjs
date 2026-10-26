import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAuthIdentityConfig } from './identity.ts';
import { currentUserProfile } from './principal.mjs';

const runId = 'run-12345678';
const stableIdentity = loadAuthIdentityConfig({
	AFD_AUTH_TEST_RUN_ID: runId,
	AFD_AUTH_TEST_EMAIL_SUFFIX: '@fixture.example',
	AFD_AUTH_TEST_OAUTH_IDENTITY_MODE: 'verified-github-account',
	AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '7654321',
	AFD_AUTH_TEST_OAUTH_EMAIL: 'owner@external.example',
	AFD_AUTH_TEST_PRIMARY_EMAIL: `${runId}-a@fixture.example`,
	AFD_AUTH_TEST_SECONDARY_EMAIL: `${runId}-b@fixture.example`,
});

function context({ userId = 'user-fixture', user = null, accounts = [] } = {}) {
	return {
		auth: {
			async getUserIdentity() {
				return userId === null ? null : { subject: userId };
			},
		},
		db: {
			async get(table, id) {
				return table === 'users' && id === userId ? user : null;
			},
			query(table) {
				return {
					filter(predicate) {
						const query = {
							field: (name) => name,
							eq: (field, value) => (row) => row[field] === value,
						};
						const filterRows = predicate(query);
						return {
							async collect() {
								return table === 'authAccounts' ? accounts.filter(filterRows) : [];
							},
						};
					},
				};
			},
		},
	};
}

test('users:me profile is available only while the current account matches exact identity policy', async () => {
	const validGithubUser = {
		_id: 'user-fixture',
		email: 'owner@external.example',
		name: 'Fixture user',
		image: 'https://example.invalid/avatar.png',
	};
	const validGithubAccount = {
		userId: 'user-fixture',
		provider: 'github',
		providerAccountId: '7654321',
		emailVerified: 'owner@external.example',
	};
	assert.deepEqual(
		await currentUserProfile(
			context({ user: validGithubUser, accounts: [validGithubAccount] }),
			stableIdentity
		),
		{
			id: 'user-fixture',
			email: 'owner@external.example',
			name: 'Fixture user',
			image: 'https://example.invalid/avatar.png',
		}
	);

	const driftedIdentity = loadAuthIdentityConfig({
		AFD_AUTH_TEST_RUN_ID: runId,
		AFD_AUTH_TEST_EMAIL_SUFFIX: '@fixture.example',
		AFD_AUTH_TEST_OAUTH_IDENTITY_MODE: 'verified-github-account',
		AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '7654322',
		AFD_AUTH_TEST_OAUTH_EMAIL: 'owner@external.example',
		AFD_AUTH_TEST_PRIMARY_EMAIL: `${runId}-a@fixture.example`,
		AFD_AUTH_TEST_SECONDARY_EMAIL: `${runId}-b@fixture.example`,
	});
	assert.equal(
		await currentUserProfile(
			context({ user: validGithubUser, accounts: [validGithubAccount] }),
			driftedIdentity
		),
		null,
		'stale GitHub sessions fail closed after allowlist account ID drift'
	);

	const runScopedIdentity = loadAuthIdentityConfig({
		AFD_AUTH_TEST_RUN_ID: runId,
		AFD_AUTH_TEST_EMAIL_SUFFIX: '@fixture.example',
	});
	assert.equal(
		await currentUserProfile(
			context({ user: validGithubUser, accounts: [validGithubAccount] }),
			runScopedIdentity
		),
		null,
		'stable GitHub sessions fail closed if the deployment reverts to run-scoped mode'
	);

	const passwordEmail = `${runId}-a@fixture.example`;
	for (const forgedAccount of [
		{ userId: 'user-fixture', provider: 'github', providerAccountId: '7654321' },
		{ userId: 'user-fixture', provider: 'password', providerAccountId: '7654321' },
	]) {
		assert.equal(
			await currentUserProfile(
				context({
					user: { _id: 'user-fixture', email: passwordEmail },
					accounts: [forgedAccount],
				}),
				stableIdentity
			),
			null,
			'Password profiles cannot acquire access through a forged or cross-provider account association'
		);
	}

	assert.equal(await currentUserProfile(context({ userId: null }), stableIdentity), null);
});
