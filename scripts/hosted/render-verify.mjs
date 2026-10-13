/** Exact identity and bounded response checks for AFD #362 Render controls. */
export const API = 'https://api.render.com';
const ROLES = {
	h1: {
		name: 'afd-362-h1-better-auth',
		start: 'cd packages/auth && node hosted/better-auth/serve.mjs',
		health: '/harness/info',
	},
	h3: {
		name: 'afd-362-h3-rest',
		start: 'node packages/local-db/hosted/durable-rest-server.mjs',
		health: null,
	},
};
const ID = {
	service: /^srv-[0-9a-z]{20}$/,
	disk: /^dsk-[0-9a-z]{20}$/,
	blueprint: /^exs-[0-9a-z]{20}$/,
	deploy: /^dep-[0-9a-z]{20}$/,
};
const SHA = /^[0-9a-f]{40}$/;
const OWNED_REPO = 'https://github.com/lushly-dev/afd';

export function insist(ok, code) {
	if (!ok) throw new Error(code);
}

export function checkLedger(ledger, role) {
	insist(Object.hasOwn(ROLES, role), 'invalid-role');
	insist(
		ledger?.schema === 1 && ledger?.purpose === 'afd-362-disposable-hosted-fixtures',
		'invalid-ledger'
	);
	insist(
		ledger?.dedicatedOwnershipVerified === true &&
			typeof ledger?.runId === 'string' &&
			/^afd362-[a-z0-9-]{8,64}$/.test(ledger.runId),
		'ownership-unverified'
	);
	insist(
		ledger?.repo === OWNED_REPO && SHA.test(ledger?.reviewedSource ?? ''),
		'invalid-reviewed-source'
	);
	insist(
		typeof ledger?.ownerId === 'string' && /^[a-z]{3}-[0-9a-z]{12,}$/.test(ledger.ownerId),
		'invalid-owner-id'
	);
	insist(ID.blueprint.test(ledger?.blueprintId ?? ''), 'invalid-blueprint-id');
	insist(
		ledger?.roles && Object.keys(ledger.roles).sort().join(',') === 'h1,h3',
		'role-set-mismatch'
	);
	const ids = new Set();
	for (const [key, expected] of Object.entries(ROLES)) {
		const item = ledger.roles[key];
		insist(
			item?.name === expected.name && item?.role === key && item?.dedicated === true,
			'role-ownership-mismatch'
		);
		insist(
			ID.service.test(item.serviceId ?? '') && ID.disk.test(item.diskId ?? ''),
			'invalid-resource-id'
		);
		insist(
			!Number.isNaN(Date.parse(item.serviceCreatedAt)) &&
				!Number.isNaN(Date.parse(item.diskCreatedAt)),
			'missing-creation-identity'
		);
		insist(!ids.has(item.serviceId) && !ids.has(item.diskId), 'duplicate-resource-id');
		ids.add(item.serviceId);
		ids.add(item.diskId);
	}
	return ledger.roles[role];
}

function sourceOf(deploy) {
	return deploy?.commit?.id;
}

export function receipt(action, role, ledger, item, details = {}) {
	return {
		schema: 1,
		action,
		role,
		runId: ledger.runId,
		serviceId: item.serviceId,
		diskId: item.diskId,
		source: ledger.reviewedSource,
		at: new Date().toISOString(),
		...details,
	};
}

export async function boundedJson(response, timeoutMs) {
	let reader;
	try {
		reader = response.body?.getReader();
	} catch {
		throw new Error('render-body-failed');
	}
	insist(reader, 'render-invalid-json');
	let timer;
	try {
		return await Promise.race([
			(async () => {
				const chunks = [];
				let bytes = 0;
				while (true) {
					let next;
					try {
						next = await reader.read();
					} catch {
						throw new Error('render-body-failed');
					}
					const { done, value } = next;
					if (done) break;
					bytes += value.byteLength;
					insist(bytes <= 262_144, 'render-response-too-large');
					chunks.push(value);
				}
				try {
					return JSON.parse(Buffer.concat(chunks).toString('utf8'));
				} catch {
					throw new Error('render-invalid-json');
				}
			})(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('render-body-timeout')), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
		try {
			void reader.cancel().catch(() => {});
		} catch {
			// No provider error text leaves the bounded reader.
		}
	}
}

export function verifyBlueprint(blueprint, ledger, item, role, servicePresent) {
	const boundResource = blueprint?.resources?.some(
		(resource) =>
			resource?.id === item.serviceId &&
			resource?.name === ROLES[role].name &&
			resource?.type === 'web_service'
	);
	insist(
		blueprint?.id === ledger.blueprintId &&
			blueprint?.repo?.replace(/\.git$/, '') === ledger.repo &&
			blueprint?.path === 'scripts/hosted/render.yaml' &&
			blueprint?.autoSync === false &&
			['in_sync', 'paused'].includes(blueprint?.status) &&
			(!servicePresent || boundResource),
		'blueprint-ownership-or-sync-drift'
	);
}

export function verifyService(service, ledger, item, role, diskPresent) {
	const expected = ROLES[role];
	const details = service?.serviceDetails;
	insist(
		service?.id === item.serviceId &&
			service?.name === expected.name &&
			service?.type === 'web_service' &&
			service?.ownerId === ledger.ownerId &&
			service?.createdAt === item.serviceCreatedAt,
		'service-identity-mismatch'
	);
	insist(
		service?.repo?.replace(/\.git$/, '') === ledger.repo &&
			service?.autoDeploy === 'no' &&
			(service?.autoDeployTrigger === undefined || service.autoDeployTrigger === 'off'),
		'service-source-or-autodeploy-drift'
	);
	insist(
		details?.plan === '0.5c-512mb' &&
			details?.numInstances === 1 &&
			details?.runtime === 'node' &&
			details?.envSpecificDetails?.startCommand === expected.start &&
			details?.envSpecificDetails?.buildCommand ===
				'corepack enable && pnpm install --frozen-lockfile && pnpm build' &&
			(diskPresent
				? details?.disk?.id === item.diskId
				: !details?.disk || details.disk.id === item.diskId),
		'service-shape-drift'
	);
	insist((details?.healthCheckPath || null) === expected.health, 'health-check-drift');
	insist(['suspended', 'not_suspended'].includes(service.suspended), 'unknown-service-state');
}

export function verifyDisk(disk, item) {
	insist(
		disk?.id === item.diskId &&
			disk?.serviceId === item.serviceId &&
			disk?.sizeGB === 1 &&
			disk?.mountPath === '/var/data' &&
			disk?.createdAt === item.diskCreatedAt,
		'disk-identity-mismatch'
	);
}

export function verifyDiskRows(rows, item, present) {
	insist(
		Array.isArray(rows) &&
			rows.length === (present ? 1 : 0) &&
			(!present || rows[0]?.disk?.id === item.diskId),
		'ambiguous-service-disks'
	);
}

export function verifyDeploys(rows, ledger) {
	insist(Array.isArray(rows) && rows.length > 0 && rows.length < 100, 'ambiguous-deploy-history');
	const deploys = rows.map((row) => row?.deploy);
	const knownStatuses = new Set([
		'created',
		'queued',
		'build_in_progress',
		'update_in_progress',
		'live',
		'deactivated',
		'build_failed',
		'update_failed',
		'canceled',
		'pre_deploy_in_progress',
		'pre_deploy_failed',
	]);
	insist(
		deploys.every(
			(deploy) => ID.deploy.test(deploy?.id ?? '') && knownStatuses.has(deploy?.status)
		),
		'unknown-deploy-state'
	);
	const live = deploys.filter((deploy) => deploy?.status === 'live');
	const pending = deploys.filter((deploy) =>
		[
			'created',
			'queued',
			'build_in_progress',
			'update_in_progress',
			'pre_deploy_in_progress',
		].includes(deploy?.status)
	);
	insist(pending.length <= 1, 'ambiguous-deploy-state');
	insist(
		pending.every(
			(deploy) =>
				ID.deploy.test(deploy?.id ?? '') &&
				(!sourceOf(deploy) || sourceOf(deploy) === ledger.reviewedSource)
		),
		'provider-source-drift'
	);
	insist(live.length === 1 && pending.length === 0, 'ambiguous-deploy-state');
	insist(
		sourceOf(live[0]) === ledger.reviewedSource && ID.deploy.test(live[0].id ?? ''),
		'provider-source-drift'
	);
	return live[0];
}
