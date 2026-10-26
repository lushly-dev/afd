#!/usr/bin/env node
/** Bounded control for the two disposable AFD #362 Render fixtures only. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
	API,
	boundedJson,
	checkLedger,
	insist,
	receipt,
	verifyBlueprint,
	verifyDeploys,
	verifyDisk,
	verifyDiskRows,
	verifyInstances,
	verifyService,
} from './render-verify.mjs';

export { checkLedger } from './render-verify.mjs';

export function createControl({
	fetchImpl = fetch,
	now = () => Date.now(),
	pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	apiKey = process.env.RENDER_API_KEY,
	deadlineMs = 80_000,
	pollMs = 2_000,
} = {}) {
	insist(
		Number.isInteger(deadlineMs) && deadlineMs >= 1 && deadlineMs <= 120_000,
		'invalid-deadline'
	);
	insist(Number.isInteger(pollMs) && pollMs >= 1 && pollMs <= 10_000, 'invalid-poll');
	async function request(method, path, deadline, expected = [200]) {
		insist(apiKey && typeof apiKey === 'string', 'missing-local-render-api-key');
		insist(path.startsWith('/v1/') && !path.includes('://'), 'invalid-api-path');
		const url = new URL(path, API);
		insist(url.origin === API && url.protocol === 'https:', 'invalid-api-origin');
		const remaining = deadline - now();
		insist(remaining > 0, 'deadline-exceeded');
		let response;
		try {
			response = await fetchImpl(url, {
				method,
				headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(Math.min(remaining, 15_000)),
				redirect: 'error',
			});
		} catch {
			throw new Error('render-request-failed');
		}
		insist(
			response && expected.includes(response.status),
			`render-http-${response?.status ?? 'unknown'}`
		);
		if (method !== 'GET' || response.status === 404) return null;
		return boundedJson(response, Math.min(deadline - now(), 15_000));
	}
	async function snapshot(ledger, role, deadline, instanceMode = null) {
		const item = checkLedger(ledger, role);
		const [service, disk, deployRows, diskRows, blueprint, instanceRows] = await Promise.all([
			request('GET', `/v1/services/${item.serviceId}`, deadline),
			request('GET', `/v1/disks/${item.diskId}`, deadline),
			request('GET', `/v1/services/${item.serviceId}/deploys?limit=100`, deadline),
			request('GET', `/v1/disks?serviceId=${item.serviceId}&limit=100`, deadline),
			request('GET', `/v1/blueprints/${ledger.blueprintId}`, deadline),
			instanceMode
				? request('GET', `/v1/services/${item.serviceId}/instances`, deadline)
				: Promise.resolve(null),
		]);
		verifyBlueprint(blueprint, ledger, item, role, true);
		verifyService(service, ledger, item, role, true);
		verifyDisk(disk, item);
		verifyDiskRows(diskRows, item, true);
		const deploy = verifyDeploys(deployRows, ledger);
		const instance = instanceMode
			? verifyInstances(instanceRows, item, { requireReady: instanceMode === 'ready' })
			: null;
		return { service, disk, deploy, instance, item };
	}
	async function cleanupSnapshot(ledger, role, deadline) {
		const item = checkLedger(ledger, role);
		const [service, disk, diskRows, blueprint] = await Promise.all([
			request('GET', `/v1/services/${item.serviceId}`, deadline, [200, 404]),
			request('GET', `/v1/disks/${item.diskId}`, deadline, [200, 404]),
			request('GET', `/v1/disks?serviceId=${item.serviceId}&limit=100`, deadline),
			request('GET', `/v1/blueprints/${ledger.blueprintId}`, deadline),
		]);
		verifyBlueprint(blueprint, ledger, item, role, service !== null);
		if (disk !== null) verifyDisk(disk, item);
		verifyDiskRows(diskRows, item, disk !== null);
		let deploy = null;
		if (service !== null) {
			verifyService(service, ledger, item, role, disk !== null);
			const deployRows = await request(
				'GET',
				`/v1/services/${item.serviceId}/deploys?limit=100`,
				deadline
			);
			deploy = verifyDeploys(deployRows, ledger);
		}
		return { service, disk, deploy, item };
	}
	async function operate(action, ledger, role, { apply = false, recordsCleaned = false } = {}) {
		ledger = structuredClone(ledger);
		const item = checkLedger(ledger, role);
		Object.freeze(ledger.roles.h1);
		Object.freeze(ledger.roles.h3);
		Object.freeze(ledger.roles);
		Object.freeze(ledger);
		insist(
			['doctor', 'status', 'restart', 'suspend', 'resume', 'cleanup'].includes(action),
			'invalid-action'
		);
		if (action === 'doctor')
			return receipt('doctor', role, ledger, item, {
				status: 'local-config-valid',
				network: false,
			});
		if (!apply && action !== 'status')
			return receipt(action, role, ledger, item, { status: 'dry-run', network: false });
		const deadline = now() + deadlineMs;
		if (action === 'cleanup') {
			let stage = 'preflight';
			let diskState = 'unknown';
			let serviceState = 'unknown';
			let mutated = false;
			try {
				insist(recordsCleaned && item.recordCleanupVerified === true, 'record-cleanup-unverified');
				let current = await cleanupSnapshot(ledger, role, deadline);
				diskState = current.disk === null ? 'absent' : 'present';
				serviceState = current.service === null ? 'absent' : 'present';
				if (current.disk !== null) {
					stage = 'delete-disk';
					mutated = true;
					await request('DELETE', `/v1/disks/${item.diskId}`, deadline, [204]);
					diskState = 'unknown';
					stage = 'read-disk';
					while (true) {
						current = await cleanupSnapshot(ledger, role, deadline);
						diskState = current.disk === null ? 'absent' : 'present';
						serviceState = current.service === null ? 'absent' : 'present';
						if (current.disk === null) break;
						const remaining = deadline - now();
						insist(remaining > 0, 'deadline-exceeded');
						await pause(Math.min(pollMs, remaining));
					}
				}
				if (current.service !== null) {
					stage = 'delete-service';
					mutated = true;
					await request('DELETE', `/v1/services/${item.serviceId}`, deadline, [204]);
					serviceState = 'unknown';
				}
				stage = 'readback';
				while (true) {
					current = await cleanupSnapshot(ledger, role, deadline);
					diskState = current.disk === null ? 'absent' : 'present';
					serviceState = current.service === null ? 'absent' : 'present';
					if (current.disk === null && current.service === null) break;
					const remaining = deadline - now();
					insist(remaining > 0, 'deadline-exceeded');
					await pause(Math.min(pollMs, remaining));
				}
				return receipt(action, role, ledger, item, {
					status: 'absent',
					disk: 'absent',
					service: 'absent',
				});
			} catch (error) {
				const code =
					error instanceof Error && /^[a-z][a-z0-9-]{0,80}$/.test(error.message)
						? error.message
						: 'cleanup-failed';
				const failure = new Error(code);
				failure.receipt = receipt(action, role, ledger, item, {
					status: mutated ? 'partial' : 'failed',
					stage,
					disk: diskState,
					service: serviceState,
					reason: code,
				});
				throw failure;
			}
		}
		const before = await snapshot(ledger, role, deadline, action === 'restart' ? 'ready' : null);
		const prior = before.deploy.id;
		const priorInstance = before.instance?.id;
		if (action === 'status')
			return receipt(action, role, ledger, item, {
				status: before.service.suspended,
				deployId: prior,
				deployStatus: before.deploy.status,
				disk: 'attached',
			});
		insist(
			action !== 'suspend' || before.service.suspended === 'not_suspended',
			'wrong-initial-state'
		);
		insist(action !== 'resume' || before.service.suspended === 'suspended', 'wrong-initial-state');
		insist(
			action !== 'restart' || before.service.suspended === 'not_suspended',
			'wrong-initial-state'
		);
		await request(
			'POST',
			`/v1/services/${item.serviceId}/${action}`,
			deadline,
			action === 'restart' ? [200] : [202]
		);
		const wanted = action === 'suspend' ? 'suspended' : 'not_suspended';
		while (true) {
			let after;
			try {
				after = await snapshot(ledger, role, deadline, action === 'restart' ? 'poll' : null);
			} catch (error) {
				if (!(error instanceof Error) || error.message !== 'ambiguous-deploy-state') throw error;
				const remaining = deadline - now();
				insist(remaining > 0, 'deadline-exceeded');
				await pause(Math.min(pollMs, remaining));
				continue;
			}
			if (
				after.service.suspended === wanted &&
				(action !== 'restart' || (after.instance && after.instance.id !== priorInstance))
			) {
				return receipt(action, role, ledger, item, {
					status: after.service.suspended,
					deployId: after.deploy.id,
					previousDeployId: prior,
					deployStatus: after.deploy.status,
					...(action === 'restart'
						? { instanceId: after.instance.id, previousInstanceId: priorInstance }
						: {}),
					restartTime: action === 'restart' ? new Date().toISOString() : undefined,
				});
			}
			const remaining = deadline - now();
			insist(remaining > 0, 'deadline-exceeded');
			await pause(Math.min(pollMs, remaining));
		}
	}
	return { operate };
}

function parseArgs(argv) {
	const [action, ...rest] = argv;
	const options = Object.fromEntries(
		rest.map((arg) => {
			insist(/^--(role|ledger|apply|records-cleaned)(=|$)/.test(arg), 'invalid-argument');
			const [name, ...value] = arg.slice(2).split('=');
			return [name, value.length ? value.join('=') : true];
		})
	);
	insist(
		typeof options.role === 'string' && typeof options.ledger === 'string',
		'role-and-ledger-required'
	);
	return { action, options };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		const { action, options } = parseArgs(process.argv.slice(2));
		let ledger;
		try {
			ledger = JSON.parse(await readFile(options.ledger, 'utf8'));
		} catch {
			throw new Error('invalid-ledger-file');
		}
		if (action === 'restart-command') {
			checkLedger(ledger, options.role);
			process.stdout.write(
				`${JSON.stringify([process.execPath, fileURLToPath(import.meta.url), 'restart', `--role=${options.role}`, `--ledger=${options.ledger}`, '--apply'])}\n`
			);
		} else {
			const result = await createControl().operate(action, ledger, options.role, {
				apply: options.apply === true,
				recordsCleaned: options['records-cleaned'] === true,
			});
			process.stdout.write(`${JSON.stringify(result)}\n`);
		}
	} catch (error) {
		if (error instanceof Error && error.receipt) {
			process.stdout.write(`${JSON.stringify(error.receipt)}\n`);
		}
		const code =
			error instanceof Error && /^[a-z][a-z0-9-]{0,80}$/.test(error.message)
				? error.message
				: 'render-control-failed';
		process.stderr.write(`${code}\n`);
		process.exitCode = 1;
	}
}
