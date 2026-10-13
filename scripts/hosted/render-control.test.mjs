import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLedger, createControl } from './render-control.mjs';

const H1 = {
	role: 'h1',
	name: 'afd-362-h1-better-auth',
	dedicated: true,
	serviceId: `srv-${'a'.repeat(20)}`,
	diskId: `dsk-${'b'.repeat(20)}`,
	serviceCreatedAt: '2026-10-13T00:00:00.000Z',
	diskCreatedAt: '2026-10-13T00:00:01.000Z',
	recordCleanupVerified: true,
};
const H3 = {
	role: 'h3',
	name: 'afd-362-h3-rest',
	dedicated: true,
	serviceId: `srv-${'c'.repeat(20)}`,
	diskId: `dsk-${'d'.repeat(20)}`,
	serviceCreatedAt: '2026-10-13T00:00:02.000Z',
	diskCreatedAt: '2026-10-13T00:00:03.000Z',
	recordCleanupVerified: true,
};
const source = 'e'.repeat(40);
const depOld = `dep-${'3'.repeat(20)}`;
const depNew = `dep-${'4'.repeat(20)}`;
const ledger = {
	schema: 1,
	purpose: 'afd-362-disposable-hosted-fixtures',
	dedicatedOwnershipVerified: true,
	runId: 'afd362-20261013-test',
	repo: 'https://github.com/lushly-dev/afd',
	ownerId: `tea-${'1'.repeat(20)}`,
	blueprintId: `exs-${'2'.repeat(20)}`,
	reviewedSource: source,
	roles: { h1: H1, h3: H3 },
};

function mock({
	role = 'h1',
	wrong = null,
	secret = 'top-secret-token',
	mutate = false,
	initialDiskAbsent = false,
	initialServiceAbsent = false,
} = {}) {
	const item = ledger.roles[role];
	const paths = [];
	let fault = wrong;
	let deletedDisk = initialDiskAbsent;
	let deletedService = initialServiceAbsent;
	let restarted = false;
	let suspended = 'not_suspended';
	let clock = 0;
	const fetchImpl = async (url, options) => {
		assert.equal(url.origin, 'https://api.render.com');
		assert.equal(options.headers.Authorization, `Bearer ${secret}`);
		assert.equal(options.redirect, 'error');
		paths.push(`${options.method} ${url.pathname}${url.search}`);
		const path = url.pathname;
		if (options.method === 'DELETE') {
			if (fault === 'disk-delete-http' && path === `/v1/disks/${item.diskId}`)
				return new Response(secret, { status: 500 });
			if (fault === 'service-delete-http' && path === `/v1/services/${item.serviceId}`)
				return new Response(secret, { status: 500 });
			if (path === `/v1/disks/${item.diskId}`) deletedDisk = true;
			else if (path === `/v1/services/${item.serviceId}`) deletedService = true;
			else return new Response(secret, { status: 404 });
			return new Response(null, { status: 204 });
		}
		if (options.method === 'POST') {
			if (path.endsWith('/restart')) {
				if (fault === 'restart-http') return new Response(secret, { status: 500 });
				restarted = mutate;
				return new Response(secret, { status: 200 });
			}
			if (path.endsWith('/suspend')) {
				suspended = 'suspended';
				return new Response(secret, { status: 202 });
			}
			if (path.endsWith('/resume')) {
				suspended = 'not_suspended';
				return new Response(secret, { status: 202 });
			}
		}
		if (path === `/v1/services/${item.serviceId}`) {
			if (deletedService)
				return new Response(null, { status: fault === 'service-410' ? 410 : 404 });
			return Response.json({
				id: fault === 'service' ? H3.serviceId : item.serviceId,
				name: item.name,
				type: 'web_service',
				ownerId: ledger.ownerId,
				createdAt: item.serviceCreatedAt,
				repo: ledger.repo,
				autoDeploy: 'no',
				suspended,
				serviceDetails: {
					plan: '0.5c-512mb',
					numInstances: 1,
					runtime: 'node',
					disk: deletedDisk ? undefined : { id: item.diskId },
					envSpecificDetails: {
						buildCommand: 'corepack enable && pnpm install --frozen-lockfile && pnpm build',
						startCommand:
							role === 'h1'
								? 'cd packages/auth && node hosted/better-auth/serve.mjs'
								: 'node packages/local-db/hosted/durable-rest-server.mjs',
					},
					healthCheckPath: role === 'h1' ? '/harness/info' : undefined,
				},
			});
		}
		if (path === `/v1/disks/${item.diskId}`) {
			if (deletedDisk && fault !== 'cleanup-readback')
				return new Response(null, { status: fault === 'disk-410' ? 410 : 404 });
			return Response.json({
				id: item.diskId,
				serviceId: fault === 'disk' ? H3.serviceId : item.serviceId,
				sizeGB: 1,
				mountPath: '/var/data',
				createdAt: item.diskCreatedAt,
			});
		}
		if (path === `/v1/services/${item.serviceId}/deploys`)
			return Response.json(
				fault === 'ambiguous'
					? [
							{ deploy: { id: `dep-${'5'.repeat(20)}`, status: 'queued', commit: { id: source } } },
							{ deploy: { id: `dep-${'6'.repeat(20)}`, status: 'queued', commit: { id: source } } },
						]
					: [
							{
								deploy: {
									id: fault === 'malicious-deploy-id' ? `${secret}\n` : restarted ? depNew : depOld,
									status: fault === 'status' ? 'failed' : 'live',
									commit: { id: fault === 'source' ? 'f'.repeat(40) : source, message: secret },
								},
							},
						]
			);
		if (path === '/v1/disks')
			return Response.json(deletedDisk ? [] : [{ disk: { id: item.diskId } }]);
		if (path === `/v1/blueprints/${ledger.blueprintId}`)
			return Response.json({
				id: ledger.blueprintId,
				repo: ledger.repo,
				path: 'scripts/hosted/render.yaml',
				autoSync: fault === 'sync',
				status: fault === 'syncing' ? 'syncing' : 'in_sync',
				resources: [{ id: item.serviceId, name: item.name, type: 'web_service' }],
			});
		return new Response(secret, { status: 404 });
	};
	return {
		fetchImpl,
		paths,
		setWrong: (value) => {
			fault = value;
		},
		now: () => clock,
		pause: async (ms) => {
			clock += ms;
		},
	};
}

test('dry run and local doctor never read the API or require a key', async () => {
	const client = mock();
	const control = createControl({ ...client, apiKey: undefined });
	assert.equal((await control.operate('doctor', ledger, 'h1')).network, false);
	assert.equal((await control.operate('restart', ledger, 'h1')).status, 'dry-run');
	await assert.rejects(control.operate('create', ledger, 'h1'), /invalid-action/);
	assert.deepEqual(client.paths, []);
});

test('role and dedicated ownership bind exact resources before mutation', async () => {
	const client = mock({ secret: 'local-secret' });
	const control = createControl({ ...client, apiKey: 'local-secret' });
	await assert.rejects(
		control.operate('restart', { ...ledger, dedicatedOwnershipVerified: false }, 'h1', {
			apply: true,
		}),
		/ownership-unverified/
	);
	await assert.rejects(
		control.operate(
			'restart',
			{ ...ledger, roles: { h1: { ...H1, serviceId: H3.serviceId }, h3: H3 } },
			'h1',
			{ apply: true }
		),
		/duplicate-resource-id/
	);
	assert.deepEqual(client.paths, []);
	assert.equal(checkLedger(ledger, 'h1'), H1);
});

for (const wrong of [
	'service',
	'disk',
	'source',
	'status',
	'sync',
	'syncing',
	'ambiguous',
	'malicious-deploy-id',
]) {
	test(`${wrong} drift blocks restart without a POST`, async () => {
		const client = mock({ wrong, secret: 'local-secret' });
		const control = createControl({ ...client, apiKey: 'local-secret' });
		await assert.rejects(
			control.operate('restart', ledger, 'h1', { apply: true }),
			(error) => !error.message.includes('local-secret') && !error.receipt
		);
		assert.equal(
			client.paths.some((path) => path.startsWith('POST')),
			false
		);
	});
}

test('restart requires a new provider live deploy under one deadline', async () => {
	const client = mock({ mutate: true, secret: 'local-secret' });
	const control = createControl({ ...client, apiKey: 'local-secret' });
	const result = await control.operate('restart', ledger, 'h1', { apply: true });
	assert.equal(result.previousDeployId, depOld);
	assert.equal(result.deployId, depNew);
	assert.equal(result.source, source);
	assert.equal(client.paths.filter((path) => path.endsWith('/restart')).length, 1);
});

test('H3 status binds its separate service and disk with TCP readiness', async () => {
	const client = mock({ role: 'h3', secret: 'local-secret' });
	const result = await createControl({ ...client, apiKey: 'local-secret' }).operate(
		'status',
		ledger,
		'h3'
	);
	assert.equal(result.serviceId, H3.serviceId);
	assert.equal(result.diskId, H3.diskId);
	assert.equal(result.deployStatus, 'live');
});

test('restart timeout and HTTP failures are bounded and redact bodies', async () => {
	const client = mock({ secret: 'top-secret-token' });
	const control = createControl({
		...client,
		apiKey: 'top-secret-token',
		deadlineMs: 4,
		pollMs: 2,
	});
	await assert.rejects(
		control.operate('restart', ledger, 'h1', { apply: true }),
		/deadline-exceeded/
	);
	const failing = createControl({
		fetchImpl: async () => new Response('top-secret-token', { status: 403 }),
		apiKey: 'top-secret-token',
	});
	await assert.rejects(failing.operate('status', ledger, 'h1'), (error) => {
		assert.equal(error.message, 'render-http-403');
		assert.equal(error.message.includes('top-secret-token'), false);
		return true;
	});
});

test('cleanup requires record readback then exact disk and service absence', async () => {
	const client = mock({ secret: 'local-secret' });
	const control = createControl({ ...client, apiKey: 'local-secret' });
	await assert.rejects(
		control.operate('cleanup', ledger, 'h1', { apply: true }),
		/record-cleanup-unverified/
	);
	assert.equal(
		client.paths.some((path) => path.startsWith('DELETE')),
		false
	);
	const result = await control.operate('cleanup', ledger, 'h1', {
		apply: true,
		recordsCleaned: true,
	});
	assert.equal(result.status, 'absent');
	assert.deepEqual(
		client.paths.filter((path) => path.startsWith('DELETE')),
		[`DELETE /v1/disks/${H1.diskId}`, `DELETE /v1/services/${H1.serviceId}`]
	);
	assert.equal(
		client.paths.some((path) => path === `GET /v1/disks/${H1.diskId}`),
		true
	);
});

test('uncertain cleanup readback and a failed restart remain failures without leaking response bodies', async () => {
	const stale = mock({ wrong: 'cleanup-readback', secret: 'local-secret' });
	await assert.rejects(
		createControl({ ...stale, apiKey: 'local-secret' }).operate('cleanup', ledger, 'h1', {
			apply: true,
			recordsCleaned: true,
		}),
		(error) => error.receipt?.status === 'partial' && error.receipt?.stage === 'read-disk'
	);
	const failed = mock({ wrong: 'restart-http', secret: 'local-secret' });
	await assert.rejects(
		createControl({ ...failed, apiKey: 'local-secret' }).operate('restart', ledger, 'h1', {
			apply: true,
		}),
		(error) => error.message === 'render-http-500' && !error.message.includes('local-secret')
	);
});

test('partial disk deletion retries against the exact surviving service', async () => {
	const client = mock({ wrong: 'service-delete-http', secret: 'local-secret' });
	const control = createControl({ ...client, apiKey: 'local-secret' });
	await assert.rejects(
		control.operate('cleanup', ledger, 'h1', { apply: true, recordsCleaned: true }),
		(error) =>
			error.receipt?.status === 'partial' &&
			error.receipt?.disk === 'absent' &&
			error.receipt?.service === 'present' &&
			error.receipt?.reason === 'render-http-500'
	);
	client.setWrong(null);
	const result = await control.operate('cleanup', ledger, 'h1', {
		apply: true,
		recordsCleaned: true,
	});
	assert.equal(result.status, 'absent');
	assert.equal(client.paths.filter((path) => path === `DELETE /v1/disks/${H1.diskId}`).length, 1);
	assert.equal(
		client.paths.filter((path) => path === `DELETE /v1/services/${H1.serviceId}`).length,
		2
	);
});

test('service-already-absent cleanup validates the exact surviving disk before deleting', async () => {
	const client = mock({ initialServiceAbsent: true, secret: 'local-secret' });
	const result = await createControl({ ...client, apiKey: 'local-secret' }).operate(
		'cleanup',
		ledger,
		'h1',
		{ apply: true, recordsCleaned: true }
	);
	assert.equal(result.status, 'absent');
	assert.deepEqual(
		client.paths.filter((path) => path.startsWith('DELETE')),
		[`DELETE /v1/disks/${H1.diskId}`]
	);
	const wrong = mock({ initialServiceAbsent: true, wrong: 'disk', secret: 'local-secret' });
	await assert.rejects(
		createControl({ ...wrong, apiKey: 'local-secret' }).operate('cleanup', ledger, 'h1', {
			apply: true,
			recordsCleaned: true,
		}),
		/disk-identity-mismatch/
	);
	assert.equal(
		wrong.paths.some((path) => path.startsWith('DELETE')),
		false
	);
});

test('fully absent owned resources require readback and no repeat DELETE', async () => {
	const client = mock({
		initialServiceAbsent: true,
		initialDiskAbsent: true,
		secret: 'local-secret',
	});
	const result = await createControl({ ...client, apiKey: 'local-secret' }).operate(
		'cleanup',
		ledger,
		'h1',
		{ apply: true, recordsCleaned: true }
	);
	assert.equal(result.status, 'absent');
	assert.equal(
		client.paths.some((path) => path.startsWith('DELETE')),
		false
	);
	assert.equal(
		client.paths.some((path) => path === `GET /v1/services/${H1.serviceId}`),
		true
	);
	assert.equal(
		client.paths.some((path) => path === `GET /v1/disks/${H1.diskId}`),
		true
	);
});

test('only exact 404 counts as cleanup absence; failed delete and uncertain readback retain failure receipts', async () => {
	for (const wrong of ['disk-delete-http', 'disk-410', 'service-410']) {
		const client = mock({ wrong, secret: 'local-secret' });
		await assert.rejects(
			createControl({ ...client, apiKey: 'local-secret' }).operate('cleanup', ledger, 'h1', {
				apply: true,
				recordsCleaned: true,
			}),
			(error) =>
				error.receipt?.status === 'partial' &&
				!JSON.stringify(error.receipt).includes('local-secret')
		);
	}
});

test('provider JSON size and body time are bounded without exposing contents', async () => {
	const rejectedStream = createControl({
		apiKey: 'local-secret',
		fetchImpl: async () => ({
			status: 200,
			body: {
				getReader: () => ({
					read: async () => {
						throw new Error('local-secret');
					},
					cancel: () => {
						throw new Error('local-secret');
					},
				}),
			},
		}),
	});
	await assert.rejects(
		rejectedStream.operate('status', ledger, 'h1'),
		(error) => error.message === 'render-body-failed'
	);
	const oversized = createControl({
		apiKey: 'local-secret',
		fetchImpl: async () =>
			new Response(JSON.stringify({ secret: 's'.repeat(262_145) }), { status: 200 }),
	});
	await assert.rejects(oversized.operate('status', ledger, 'h1'), /render-response-too-large/);
	const hanging = createControl({
		apiKey: 'local-secret',
		deadlineMs: 10,
		fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { status: 200 }),
	});
	await assert.rejects(hanging.operate('status', ledger, 'h1'), /render-body-timeout/);
});
