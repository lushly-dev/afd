#!/usr/bin/env node
import { ViewStateRegistry } from '../../view-state/dist/index.js';
/** Phase-separated H3 verifier. Imports the shipped adapters but is never packaged. */
import {
	adapterFor,
	assertAbsent,
	check,
	configuration,
	entityPath,
	equal,
	expectHttpFailure,
	HarnessError,
	handler,
	idsFor,
	storeIdentity,
} from './harness-support.mjs';

async function withoutRawViewStateWarnings(action) {
	const originalWarn = console.warn;
	let warnings = 0;
	let failure;
	console.warn = () => {
		warnings += 1;
	};
	try {
		await action();
	} catch (error) {
		failure = error;
	} finally {
		console.warn = originalWarn;
	}
	check(warnings === 0, 'View-state persistence emitted a redacted warning');
	if (failure) throw failure;
}

async function assertAuthentication(config, primary, secondary, ids) {
	if (!config.token || !config.secondaryToken) return [];
	const unauthorized = await fetch(`${config.baseURL}/health`, {
		signal: AbortSignal.timeout(config.deadlineMs),
	});
	check([401, 403].includes(unauthorized.status), 'An unauthenticated request was not rejected');
	if (config.expectFixtureAuth) {
		const forbidden = await fetch(`${config.baseURL}/health`, {
			headers: {
				authorization: `Bearer ${config.token}`,
				'x-afd-test-principal': 'principal-b',
			},
			signal: AbortSignal.timeout(config.deadlineMs),
		});
		check(forbidden.status === 403, 'Cross-principal selection was not forbidden');
	}
	await primary.create(config.table, { id: ids.isolation, owner: 'principal-a' });
	check(
		(await secondary.get(config.table, ids.isolation)) === null,
		'Secondary principal could read the primary record'
	);
	await secondary.create(config.table, { id: ids.isolation, owner: 'principal-b' });
	equal(
		await primary.get(config.table, ids.isolation),
		{ id: ids.isolation, owner: 'principal-a' },
		'Primary tenancy read-back failed'
	);
	equal(
		await secondary.get(config.table, ids.isolation),
		{ id: ids.isolation, owner: 'principal-b' },
		'Secondary tenancy read-back failed'
	);
	return ['unauthenticated-rejection', 'two-principal-isolation'];
}

async function writePhase(config, ids) {
	const writer = adapterFor(config);
	const reader = adapterFor(config);
	const secondary = config.secondaryToken ? adapterFor(config, config.secondaryToken) : null;
	const allIds = Object.values(ids);
	await assertAbsent(reader, config.table, allIds, 'Write preflight');
	if (secondary) await assertAbsent(secondary, config.table, allIds, 'Secondary write preflight');

	const health = await writer.health();
	check(health.status === 'ok', 'Health did not report ok');
	const identity = storeIdentity(config, health);
	await writer.create(config.table, {
		id: ids.marker,
		kind: 'run-marker',
		runId: config.runId,
		storeIdentity: identity,
		applicationRevision: config.appRevision,
		applicationInstance: typeof health.instanceId === 'string' ? health.instanceId : null,
	});

	const input = { id: ids.base, kind: 'durable', score: 1, nested: { value: 1 } };
	await writer.create(config.table, input);
	input.nested.value = 99;
	equal(
		await reader.get(config.table, ids.base),
		{ id: ids.base, kind: 'durable', score: 1, nested: { value: 1 } },
		'Create did not preserve a JSON copy'
	);
	await writer.update(config.table, ids.base, { score: 4, value: 'after' });
	await writer.create(config.table, { id: ids.encoded, kind: 'encoded-path' });
	check(
		(await reader.get(config.table, ids.encoded))?.kind === 'encoded-path',
		'Encoded record path did not round-trip'
	);
	await writer.create(config.table, { id: ids.removed, kind: 'remove' });
	await writer.remove(config.table, ids.removed);
	await writer.remove(config.table, ids.removed);
	check((await reader.get(config.table, ids.removed)) === null, 'Idempotent remove failed');
	await expectHttpFailure(
		writer.update(config.table, ids.missing, { value: 'must-fail' }),
		404,
		'Missing PATCH'
	);

	await writer.create(config.table, { id: ids.queryA, group: config.runId, score: 10 });
	await writer.create(config.table, { id: ids.queryB, group: config.runId, score: 20 });
	await writer.create(config.table, { id: ids.queryC, group: 'other', score: 30 });
	await writer.create(config.table, { id: ids.batchOld, kind: 'batch-old' });
	const committed = await writer.batch([
		{ method: 'POST', path: entityPath(config.table), body: { id: ids.batch, value: 1 } },
		{ method: 'PATCH', path: entityPath(config.table, ids.batch), body: { value: 2 } },
		{ method: 'PUT', path: entityPath(config.table, ids.batchUpsert), body: { value: 3 } },
		{ method: 'DELETE', path: entityPath(config.table, ids.batchOld) },
		{ method: 'GET', path: entityPath(config.table, ids.batch) },
	]);
	equal(
		committed.results.map((entry) => entry.status),
		[201, 200, 200, 204, 200],
		'Successful batch status contract failed'
	);
	equal(committed.summary, { total: 5, success: 5, failed: 0 }, 'Successful batch summary failed');

	const rolledBack = await writer.batch([
		{ method: 'PATCH', path: entityPath(config.table, ids.base), body: { value: 'rolled-back' } },
		{ method: 'POST', path: entityPath(config.table), body: { id: ids.rollback } },
		{ method: 'PATCH', path: entityPath(config.table, ids.missing), body: {} },
	]);
	equal(
		rolledBack.results.map((entry) => entry.status),
		[424, 424, 404],
		'Failed batch status contract failed'
	);
	equal(rolledBack.summary, { total: 3, success: 0, failed: 3 }, 'Failed batch summary failed');
	equal(
		(await reader.get(config.table, ids.base))?.value,
		'after',
		'Failed batch changed an existing record'
	);
	check((await reader.get(config.table, ids.rollback)) === null, 'Failed batch created a record');

	const category = `afd362-view-${config.runId}`;
	await withoutRawViewStateWarnings(async () => {
		const first = new ViewStateRegistry({
			adapter: writer,
			table: config.table,
			category,
			debounceMs: 60_000,
		});
		first.register(ids.view, handler({ open: false, panel: 'start' }));
		first.set(ids.view, { open: true, nested: { level: 2 } });
		await first.flush();
		let persisted = await reader.get(config.table, ids.view);
		check(
			persisted?.category === category && persisted?.value?.open === true,
			'Flush lacked independent storage read-back'
		);
		first.set(ids.view, { panel: 'destroyed' });
		await first.destroy();
		persisted = await reader.get(config.table, ids.view);
		check(persisted?.value?.panel === 'destroyed', 'Destroy lacked independent storage read-back');
	});

	const authChecks = secondary ? await assertAuthentication(config, writer, secondary, ids) : [];
	return {
		storeIdentity: identity,
		checks: [
			'health',
			'crud',
			'json-copy',
			'encoded-path',
			'idempotent-remove',
			'missing-patch-404',
			'successful-ordered-batch',
			'failed-atomic-batch',
			'flush-independent-readback',
			'destroy-independent-readback',
			...authChecks,
		],
	};
}

async function readPhase(config, ids) {
	const reader = adapterFor(config);
	const health = await reader.health();
	const identity = storeIdentity(config, health);
	const marker = await reader.get(config.table, ids.marker);
	check(marker?.runId === config.runId, 'Durable run marker was not restored after restart');
	check(marker.storeIdentity === identity, 'Durable store identity changed across restart');
	const currentInstance = typeof health.instanceId === 'string' ? health.instanceId : null;
	if (marker.applicationInstance && currentInstance) {
		check(
			marker.applicationInstance !== currentInstance,
			'Application instance did not change across the claimed restart'
		);
	}
	check(
		(await reader.get(config.table, ids.base))?.value === 'after',
		'Updated CRUD record was not durable'
	);
	check(
		(await reader.get(config.table, ids.encoded))?.kind === 'encoded-path',
		'Encoded-path record was not durable'
	);
	check(
		(await reader.get(config.table, ids.removed)) === null,
		'Removed record reappeared after restart'
	);

	const page = await reader.list(config.table, {
		group: config.runId,
		sort: 'score',
		order: 'desc',
		limit: 1,
		offset: 1,
	});
	equal(
		page,
		{ data: [{ id: ids.queryA, group: config.runId, score: 10 }], total: 2 },
		'Filter/sort/pagination read-back failed'
	);
	check(
		(await reader.get(config.table, ids.batch))?.value === 2,
		'Committed PATCH was not durable'
	);
	check(
		(await reader.get(config.table, ids.batchUpsert))?.value === 3,
		'Committed PUT upsert was not durable'
	);
	check(
		(await reader.get(config.table, ids.batchOld)) === null,
		'Committed DELETE was not durable'
	);
	check(
		(await reader.get(config.table, ids.rollback)) === null,
		'Rolled-back record appeared after restart'
	);

	const category = `afd362-view-${config.runId}`;
	await withoutRawViewStateWarnings(async () => {
		const wrongHandler = handler({ untouched: true });
		const wrongCategory = new ViewStateRegistry({
			adapter: reader,
			table: config.table,
			category: `${category}-wrong`,
		});
		wrongCategory.register(ids.view, wrongHandler);
		await wrongCategory.hydrate();
		equal(wrongHandler.state, { untouched: true }, 'Category filter hydrated unrelated state');
		await wrongCategory.destroy();

		const restoredHandler = handler({ open: false });
		const restored = new ViewStateRegistry({ adapter: reader, table: config.table, category });
		restored.register(ids.view, restoredHandler);
		await restored.hydrate();
		check(
			restoredHandler.state.open === true &&
				restoredHandler.state.panel === 'destroyed' &&
				restoredHandler.state.nested?.level === 2,
			'New registry did not hydrate the complete persisted state'
		);
		await restored.destroy();
	});

	if (config.secondaryToken) {
		const secondary = adapterFor(config, config.secondaryToken);
		equal(
			(await reader.get(config.table, ids.isolation))?.owner,
			'principal-a',
			'Primary tenant changed after restart'
		);
		equal(
			(await secondary.get(config.table, ids.isolation))?.owner,
			'principal-b',
			'Secondary tenant changed after restart'
		);
	}
	return {
		storeIdentity: identity,
		restartEvidence: {
			beforeRevision: marker.applicationRevision,
			afterRevision: config.appRevision,
			acknowledged: true,
			independentInstance: Boolean(marker.applicationInstance && currentInstance),
		},
		checks: [
			'restart-marker',
			'unchanged-store-identity',
			'durable-crud',
			'durable-encoded-path',
			'query-contract',
			'durable-successful-batch',
			'durable-rollback',
			'category-filter',
			'new-registry-hydration',
		],
	};
}

async function unavailablePhase(config) {
	const client = adapterFor(config);
	try {
		await client.health();
	} catch (error) {
		check(
			!(error && typeof error === 'object' && 'status' in error),
			'Unavailable request returned an HTTP application error'
		);
		return { checks: ['deadline-bounded-native-fetch-rejection'] };
	}
	throw new HarnessError('ASSERTION', 'Controlled unavailable request unexpectedly succeeded');
}

async function cleanupPhase(config, ids) {
	const clients = [adapterFor(config)];
	if (config.secondaryToken) clients.push(adapterFor(config, config.secondaryToken));
	const failures = [];
	for (const [principal, client] of clients.entries()) {
		for (const id of Object.values(ids)) {
			try {
				await client.remove(config.table, id);
				check((await client.get(config.table, id)) === null, 'Deletion read-back failed');
			} catch {
				failures.push(`principal-${principal + 1}:${id}`);
			}
		}
	}
	check(failures.length === 0, `Exact-ID cleanup failed for ${failures.join(',')}`);
	return { checks: ['exact-id-cleanup', 'deletion-readback'] };
}

async function main() {
	const config = configuration();
	const ids = idsFor(config.runId);
	if (config.phase === 'preflight') {
		return {
			status: 'not-run',
			phase: config.phase,
			runId: config.runId,
			checks: ['configuration-valid'],
		};
	}
	let result;
	if (config.phase === 'write') result = await writePhase(config, ids);
	else if (config.phase === 'read') result = await readPhase(config, ids);
	else if (config.phase === 'unavailable') result = await unavailablePhase(config);
	else result = await cleanupPhase(config, ids);
	return { status: 'passed', phase: config.phase, runId: config.runId, ...result };
}

try {
	process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (error) {
	const config = (() => {
		try {
			return configuration();
		} catch {
			return null;
		}
	})();
	process.stderr.write(
		`${JSON.stringify({
			status: 'failed',
			phase: config?.phase ?? process.env.AFD_TEST_HTTP_PHASE ?? 'unknown',
			runId: config?.runId ?? process.env.AFD_TEST_HTTP_RUN_ID ?? 'unknown',
			code: error instanceof HarnessError ? error.code : 'UNEXPECTED',
			message:
				error instanceof HarnessError
					? error.message
					: 'Persistence phase failed without a safe diagnostic',
			exactIds: config ? Object.values(idsFor(config.runId)) : [],
		})}\n`
	);
	process.exitCode = 1;
}
