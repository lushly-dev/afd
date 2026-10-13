import assert from 'node:assert/strict';
import test from 'node:test';
import { userOAuthImpl } from '../../../node_modules/@convex-dev/auth/dist/server/implementation/mutations/userOAuth.js';
import { materializeProvider } from '../../../node_modules/@convex-dev/auth/dist/server/provider_utils.js';
import { createGitHubOAuthProvider } from './github-provider.mjs';
import { trustedGitHubAuthProfile, trustedGitHubUserInfo } from './identity.ts';
import { createOrUpdateFixtureUser } from './oauth-user.mjs';

const stableEnvironment = {
	AFD_AUTH_TEST_RUN_ID: 'run-12345678',
	AFD_AUTH_TEST_EMAIL_SUFFIX: '@fixture.example',
	AFD_AUTH_TEST_OAUTH_IDENTITY_MODE: 'verified-github-account',
	AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID: '7654321',
	AFD_AUTH_TEST_OAUTH_EMAIL: 'owner@external.example',
	AFD_AUTH_TEST_PRIMARY_EMAIL: 'run-12345678-a@fixture.example',
	AFD_AUTH_TEST_SECONDARY_EMAIL: 'run-12345678-b@fixture.example',
};

function createAuthContext() {
	const tables = new Map();
	let nextId = 0;
	const rowsFor = (table) => {
		if (!tables.has(table)) tables.set(table, []);
		return tables.get(table);
	};
	const db = {
		query(table) {
			const filters = [];
			const query = {
				filter(callback) {
					filters.push(
						callback({
							field: (name) => name,
							eq: (field, value) => (row) => row[field] === value,
						})
					);
					return query;
				},
				withIndex(_indexName, callback) {
					const constraints = [];
					const indexedQuery = {
						eq(field, value) {
							constraints.push([field, value]);
							return indexedQuery;
						},
					};
					callback(indexedQuery);
					filters.push((row) => constraints.every(([field, value]) => row[field] === value));
					return query;
				},
				async collect() {
					return rowsFor(table).filter((row) => filters.every((filter) => filter(row)));
				},
				async unique() {
					const rows = await query.collect();
					if (rows.length > 1) throw new Error('Expected a unique indexed row');
					return rows[0] ?? null;
				},
			};
			return query;
		},
		async insert(table, value) {
			const row = { ...value, _id: `${table}-${++nextId}` };
			rowsFor(table).push(row);
			return row._id;
		},
		async patch(tableOrId, idOrValue, maybeValue) {
			const table = maybeValue === undefined ? null : tableOrId;
			const id = maybeValue === undefined ? tableOrId : idOrValue;
			const value = maybeValue === undefined ? idOrValue : maybeValue;
			const targetTable =
				table ?? [...tables.keys()].find((name) => rowsFor(name).some((row) => row._id === id));
			const row = targetTable ? rowsFor(targetTable).find((item) => item._id === id) : null;
			if (!row) throw new Error('Patch target does not exist');
			Object.assign(row, value);
		},
		async delete(id) {
			for (const table of tables.keys()) {
				const rows = rowsFor(table);
				const index = rows.findIndex((row) => row._id === id);
				if (index >= 0) {
					rows.splice(index, 1);
					return;
				}
			}
			throw new Error('Delete target does not exist');
		},
		async get(table, id) {
			return rowsFor(table).find((row) => row._id === id) ?? null;
		},
	};
	return { db, rowsFor };
}

test('pinned userOAuthImpl creates and reuses the exact GitHub account through the fixture callback', async () => {
	const previousEnvironment = new Map(
		Object.keys(stableEnvironment).map((key) => [key, process.env[key]])
	);
	Object.assign(process.env, stableEnvironment);
	try {
		const authContext = createAuthContext();
		const provider = materializeProvider(
			createGitHubOAuthProvider({
				clientId: 'fixture-id',
				clientSecret: 'fixture-secret',
				trustedUserInfo: trustedGitHubUserInfo,
				trustedProfile: trustedGitHubAuthProfile,
			})
		);
		const profileFromProvider = provider.profile(
			trustedGitHubUserInfo(
				{ id: 7654321, email: 'public@external.example', login: 'fixture-user' },
				[{ email: 'owner@external.example', primary: true, verified: true }]
			),
			{}
		);
		const { id: providerAccountId, ...profile } = profileFromProvider;
		assert.equal(providerAccountId, '7654321');
		assert.equal(Object.hasOwn(profile, 'id'), false);
		const invokeCallback = (signature) =>
			userOAuthImpl(
				authContext,
				{ provider: 'github', providerAccountId, profile, signature },
				() => provider,
				{ callbacks: { createOrUpdateUser: createOrUpdateFixtureUser } }
			);
		await authContext.db.insert('authVerifiers', { signature: 'oauth-first', sessionId: null });
		const firstCode = await invokeCallback('oauth-first');
		const firstUsers = authContext.rowsFor('users');
		const firstAccounts = authContext.rowsFor('authAccounts');
		assert.equal(typeof firstCode, 'string');
		assert.equal(firstUsers.length, 1);
		assert.equal(firstUsers[0].email, 'owner@external.example');
		assert.equal(firstAccounts.length, 1);
		assert.equal(firstAccounts[0].providerAccountId, providerAccountId);
		assert.equal(firstAccounts[0].emailVerified, 'owner@external.example');

		await authContext.db.insert('authVerifiers', { signature: 'oauth-repeat', sessionId: null });
		const repeatCode = await invokeCallback('oauth-repeat');
		assert.equal(typeof repeatCode, 'string');
		assert.equal(authContext.rowsFor('users').length, 1);
		assert.equal(authContext.rowsFor('authAccounts').length, 1);
		assert.equal(authContext.rowsFor('authVerificationCodes').length, 1);
	} finally {
		for (const [key, value] of previousEnvironment) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
