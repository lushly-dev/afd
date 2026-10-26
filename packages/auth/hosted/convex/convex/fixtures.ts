import {
	type GenericMutationCtx,
	type GenericQueryCtx,
	mutationGeneric,
	queryGeneric,
} from 'convex/server';
import type { GenericId } from 'convex/values';
import { v } from 'convex/values';
import {
	hasForeignRunRecords,
	loadAuthIdentityConfig,
	preflightIdentityMatches,
} from './identity.js';
import { resolveCurrentPrincipal } from './principal.mjs';
import type { DataModel } from './schema.js';

type Reader = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

function configuredScope(runId: string) {
	const identity = loadAuthIdentityConfig(process.env);
	if (runId !== identity.runId) {
		throw new Error('Hosted auth fixture scope is not configured for this run');
	}
	return identity;
}

async function currentPrincipal(ctx: Reader, runId: string) {
	const identity = configuredScope(runId);
	return await resolveCurrentPrincipal(ctx, identity);
}

async function requirePrincipal(ctx: Reader, runId: string) {
	const principal = await currentPrincipal(ctx, runId);
	if (principal.kind === 'unauthenticated') throw new Error('UNAUTHENTICATED');
	if (principal.kind === 'forbidden') throw new Error('FORBIDDEN');
	return principal;
}

const expectedIdentityValidator = v.union(
	v.object({ principalKind: v.literal('password'), email: v.string() }),
	v.object({ principalKind: v.literal('github-run-scoped'), email: v.string() }),
	v.object({
		principalKind: v.literal('github-verified-primary'),
		email: v.string(),
		githubAccountId: v.string(),
	})
);

export const preflight = queryGeneric({
	args: { runId: v.string(), expectedIdentity: expectedIdentityValidator },
	returns: v.object({
		enabled: v.boolean(),
		principalId: v.string(),
		principalKind: v.union(
			v.literal('password'),
			v.literal('github-run-scoped'),
			v.literal('github-verified-primary')
		),
		identityMode: v.union(v.literal('run-scoped'), v.literal('verified-github-account')),
		revision: v.string(),
		capabilities: v.array(v.string()),
	}),
	async handler(ctx: GenericQueryCtx<DataModel>, { runId, expectedIdentity }) {
		const { userId, principalKind, identity, user, accounts } = await requirePrincipal(ctx, runId);
		if (
			!preflightIdentityMatches(
				{
					expected: expectedIdentity,
					actualEmail: user?.email,
					actualPrincipalKind: principalKind,
					accounts,
				},
				identity
			)
		) {
			throw new Error('Hosted auth preflight identity does not match the configured account');
		}
		const revision = process.env.AFD_AUTH_TEST_REVISION;
		if (!revision) throw new Error('Hosted auth fixture revision is not configured');
		const capabilities = [
			'afd-adapter',
			'cleanup-readback-v1',
			'cleanup-v1',
			'principal-isolation',
			'protected-read',
		];
		if (identity.oauthMode === 'verified-github-account') {
			capabilities.push('github-verified-primary-identity-v1');
		}
		return {
			enabled: true,
			principalId: userId,
			principalKind,
			identityMode: identity.oauthMode,
			revision,
			capabilities,
		};
	},
});

export const create = mutationGeneric({
	args: { runId: v.string(), value: v.string() },
	returns: v.id('harnessRecords'),
	async handler(ctx, { runId, value }) {
		const { userId } = await requirePrincipal(ctx, runId);
		return await ctx.db.insert('harnessRecords', { ownerId: userId, runId, value });
	},
});

export const protectedRead = queryGeneric({
	args: { runId: v.string(), recordId: v.id('harnessRecords') },
	returns: v.union(
		v.object({ ok: v.literal(true), value: v.string() }),
		v.object({
			ok: v.literal(false),
			reason: v.union(v.literal('UNAUTHENTICATED'), v.literal('FORBIDDEN')),
		})
	),
	async handler(ctx, { runId, recordId }) {
		const principal = await currentPrincipal(ctx, runId);
		if (principal.kind === 'unauthenticated') {
			return { ok: false as const, reason: 'UNAUTHENTICATED' as const };
		}
		if (principal.kind === 'forbidden') {
			return { ok: false as const, reason: 'FORBIDDEN' as const };
		}
		const { userId } = principal;
		const record = await ctx.db.get('harnessRecords', recordId);
		if (!record || record.runId !== runId || record.ownerId !== userId) {
			return { ok: false as const, reason: 'FORBIDDEN' as const };
		}
		return { ok: true as const, value: record.value };
	},
});

export const updateProfile = mutationGeneric({
	args: { runId: v.string(), name: v.string() },
	returns: v.null(),
	async handler(ctx, { runId, name }) {
		const { userId } = await requirePrincipal(ctx, runId);
		await ctx.db.patch('users', userId, { name });
		return null;
	},
});

async function removeSessionRelations(
	ctx: GenericMutationCtx<DataModel>,
	sessionId: GenericId<'authSessions'>
) {
	const refreshTokens = await ctx.db
		.query('authRefreshTokens')
		.withIndex('sessionId', (query) => query.eq('sessionId', sessionId))
		.collect();
	for (const token of refreshTokens) await ctx.db.delete('authRefreshTokens', token._id);
	const verifiers = await ctx.db
		.query('authVerifiers')
		.filter((query) => query.eq(query.field('sessionId'), sessionId))
		.collect();
	for (const verifier of verifiers) await ctx.db.delete('authVerifiers', verifier._id);
}

async function removeAccountRelations(
	ctx: GenericMutationCtx<DataModel>,
	accountId: GenericId<'authAccounts'>
) {
	const codes = await ctx.db
		.query('authVerificationCodes')
		.withIndex('accountId', (query) => query.eq('accountId', accountId))
		.collect();
	for (const code of codes) await ctx.db.delete('authVerificationCodes', code._id);
}

export const cleanup = mutationGeneric({
	args: { runId: v.string(), proof: v.string(), expectedEmail: v.string() },
	returns: v.null(),
	async handler(ctx: GenericMutationCtx<DataModel>, { runId, proof, expectedEmail }) {
		if (!/^[0-9a-f-]{36}$/i.test(proof)) throw new Error('Invalid cleanup proof');
		const { userId, user } = await requirePrincipal(ctx, runId);
		if (
			typeof user?.email !== 'string' ||
			user.email.toLowerCase() !== expectedEmail.toLowerCase()
		) {
			throw new Error('Cleanup principal does not match the exact expected identity');
		}
		const records = await ctx.db
			.query('harnessRecords')
			.filter((query) => query.eq(query.field('ownerId'), userId))
			.collect();
		if (hasForeignRunRecords(records, runId)) {
			throw new Error('Cleanup refuses records outside the authenticated run scope');
		}
		for (const record of records) await ctx.db.delete('harnessRecords', record._id);

		const sessions = await ctx.db
			.query('authSessions')
			.withIndex('userId', (query) => query.eq('userId', userId))
			.collect();
		for (const session of sessions) {
			await removeSessionRelations(ctx, session._id);
			await ctx.db.delete('authSessions', session._id);
		}

		const accounts = await ctx.db
			.query('authAccounts')
			.filter((query) => query.eq(query.field('userId'), userId))
			.collect();
		for (const account of accounts) {
			await removeAccountRelations(ctx, account._id);
			await ctx.db.delete('authAccounts', account._id);
		}
		await ctx.db.delete('users', userId);
		const remainingRecords = await ctx.db
			.query('harnessRecords')
			.filter((query) => query.eq(query.field('ownerId'), userId))
			.collect();
		const remainingSessions = await ctx.db
			.query('authSessions')
			.withIndex('userId', (query) => query.eq('userId', userId))
			.collect();
		const remainingAccounts = await ctx.db
			.query('authAccounts')
			.filter((query) => query.eq(query.field('userId'), userId))
			.collect();
		const verified =
			remainingRecords.length === 0 &&
			remainingSessions.length === 0 &&
			remainingAccounts.length === 0 &&
			(await ctx.db.get('users', userId)) === null;
		await ctx.db.insert('cleanupReceipts', {
			runId,
			proof,
			records: records.length,
			sessions: sessions.length,
			accounts: accounts.length,
			verified,
		});
		return null;
	},
});

export const cleanupReadback = mutationGeneric({
	args: { runId: v.string(), proof: v.string() },
	returns: v.object({
		records: v.number(),
		sessions: v.number(),
		accounts: v.number(),
		verified: v.boolean(),
	}),
	async handler(ctx: GenericMutationCtx<DataModel>, { runId, proof }) {
		if (!process.env.AFD_AUTH_TEST_RUN_ID || runId !== process.env.AFD_AUTH_TEST_RUN_ID) {
			throw new Error('Hosted auth fixture scope is not configured for this run');
		}
		const receipt = await ctx.db
			.query('cleanupReceipts')
			.withIndex('run_proof', (query) => query.eq('runId', runId).eq('proof', proof))
			.unique();
		if (!receipt) throw new Error('Cleanup proof not found');
		await ctx.db.delete('cleanupReceipts', receipt._id);
		return {
			records: receipt.records,
			sessions: receipt.sessions,
			accounts: receipt.accounts,
			verified: receipt.verified,
		};
	},
});
