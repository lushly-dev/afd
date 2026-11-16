/**
 * P6-E1 (phase 6 specification, section 19): deployment and projection version 4. `[host] kind`, read as
 * `static` from every earlier version; the hosted server's own first segments reserved as workspace ids; 3.3's
 * rules between the host and the identity; and the projection's `host`, read by hand and held equal to
 * `projection.v4.json`.
 */

import { describe, expect, it } from 'vitest';
import { readSchema, schemaAjv } from '../scripts/compile.mjs';
import { readBoot } from './read-boot.js';
import { readDeployment } from './read-deployment.js';
import { readProjection } from './read-projection.js';

const file = (
	host?: Record<string, unknown>,
	identity?: Record<string, unknown>,
	extra: Record<string, unknown> = {}
) => ({
	deployment_version: 4,
	workspace: { id: 'acme', name: 'Acme' },
	apps: {},
	...(host !== undefined ? { host } : {}),
	...(identity !== undefined ? { identity } : {}),
	...extra,
});
const provider = { mode: 'provider', organization: 'acme' };
const findings = (json: unknown) => {
	const read = readDeployment(json);
	return read.ok
		? { refusals: [], warnings: read.warnings.map(({ code, key }) => [code, key]) }
		: { refusals: read.refusals.map(({ code, key }) => [code, key]), warnings: [] };
};

const PROJECTION = {
	deployment_version: 4,
	generation: 'empty',
	workspace: { id: 'acme', name: 'Acme' },
	sandbox_origin: null,
	apps: [],
};

describe('P6-E1: the deployment, version 4', () => {
	it('P6-E1: reads `[host] kind`, and no `[host]` as static', () => {
		for (const kind of ['static', 'hosted', 'desktop'] as const) {
			const read = readDeployment(file({ kind }));
			expect(read.ok && read.host, kind).toBe(kind);
		}
		const none = readDeployment(file());
		expect(none.ok && none.host).toBe('static');
		const empty = readDeployment(file({}));
		expect(empty.ok && empty.host).toBe('static');
	});

	it('P6-E1: reads every version 1 to 3 file as static', () => {
		for (const json of [
			{ deployment_version: 1, apps: {} },
			{ deployment_version: 2, apps: {} },
			{ deployment_version: 3, apps: {}, identity: provider },
		]) {
			const read = readDeployment(json);
			expect(read.ok && read.host, JSON.stringify(json)).toBe('static');
		}
	});

	it('P6-E1: needs version 4 for `[host]`, and refuses a kind or a key it does not know', () => {
		expect(findings({ ...file({ kind: 'hosted' }), deployment_version: 3 }).refusals).toEqual([
			['DEPLOYMENT_INVALID', 'host'],
		]);
		expect(findings(file({ kind: 'cloud' })).refusals).toEqual([
			['DEPLOYMENT_INVALID', 'host.kind'],
		]);
		expect(findings(file({ kind: 'hosted', port: 1 })).refusals).toEqual([
			['DEPLOYMENT_INVALID', 'host.port'],
		]);
	});

	it("P6-E1: reserves the hosted server's first segments as workspace ids, in version 4 only (the step 1 obligation)", () => {
		for (const id of ['api', 'mcp', 'mounts']) {
			expect(findings(file(undefined, undefined, { workspace: { id } })).refusals, id).toEqual([
				['DEPLOYMENT_WORKSPACE_INVALID', 'workspace.id'],
			]);
		}
		// `.well-known` is reserved too; the pattern already admits no dot.
		const refused = readDeployment(
			file(undefined, undefined, { workspace: { id: '.well-known' } })
		);
		expect(refused.ok).toBe(false);
		// Version 3 keeps its own list: a static host serves no route of the hosted server's.
		for (const id of ['api', 'mcp']) {
			expect(readDeployment({ deployment_version: 3, workspace: { id }, apps: {} }).ok, id).toBe(
				true
			);
		}
		const read = readDeployment(file(undefined, undefined, { workspace: { id: 'api' } }));
		expect(read.ok === false && read.refusals[0]?.suggestion).toContain('`api`, `mcp`');
	});

	it("P6-E1: reserves the workspace id the identity path's first segment takes, as version 3 does", () => {
		expect(findings(file({ kind: 'hosted' }, { ...provider, path: 'acme/auth' })).refusals).toEqual(
			[['DEPLOYMENT_IDENTITY_INVALID', 'identity.path']]
		);
	});

	it('P6-E1: a provider deployment for a static host is DEPLOYMENT_PROVIDER_NEEDS_HOST, a warning', () => {
		for (const json of [
			file({ kind: 'static' }, provider),
			file(undefined, provider),
			{ deployment_version: 3, workspace: { id: 'acme' }, apps: {}, identity: provider },
		]) {
			const found = findings(json);
			expect(found.refusals, JSON.stringify(json)).toEqual([]);
			expect(found.warnings).toEqual([['DEPLOYMENT_PROVIDER_NEEDS_HOST', 'host.kind']]);
		}
		const read = readDeployment(file(undefined, provider));
		expect(read.ok && read.warnings[0]?.suggestion).toContain('loam-host');
	});

	it('P6-E1: a provider deployment for the desktop is DEPLOYMENT_DESKTOP_PROVIDER, refused', () => {
		const found = findings(file({ kind: 'desktop' }, provider));
		expect(found.refusals).toEqual([['DEPLOYMENT_DESKTOP_PROVIDER', 'host.kind']]);
		const read = readDeployment(file({ kind: 'desktop' }, provider));
		expect(read.ok === false && read.refusals[0]?.suggestion).toContain('kind = "hosted"');
	});

	it('P6-E1: a provider deployment for the hosted server, and a local one for any host, has no host finding', () => {
		expect(findings(file({ kind: 'hosted' }, provider))).toEqual({ refusals: [], warnings: [] });
		for (const kind of ['static', 'hosted', 'desktop'])
			expect(findings(file({ kind }, { mode: 'local' })), kind).toEqual({
				refusals: [],
				warnings: [],
			});
	});

	it('P6-E1: a provider deployment with a stdio instance is DEPLOYMENT_STDIO_TEAM in version 4 too (D95)', () => {
		const apps = {
			tools: {
				app: 'tools',
				package: './apps/tools',
				audience: 'person',
				transport: 'stdio',
				command: ['tools'],
			},
		};
		expect(findings(file({ kind: 'hosted' }, provider, { apps })).refusals).toEqual([
			['DEPLOYMENT_STDIO_TEAM', 'apps.tools.transport'],
		]);
	});
});

describe('P6-E1: the projection, version 4', () => {
	const admitted = [
		undefined,
		{ kind: 'static' },
		{ kind: 'desktop' },
		{ kind: 'hosted', kernel: 'api/kernel' },
	];
	const refused = [
		{ kind: 'hosted' },
		{ kind: 'static', kernel: 'api/kernel' },
		{ kind: 'hosted', kernel: 'api/other' },
		{ kind: 'hosted', kernel: 'api/kernel', origin: 'https://evil.example' },
		{ kind: 'cloud' },
		{},
		'hosted',
		null,
		[],
	];

	it('P6-E1: holds `host` and nothing more of it: its kind, and the transport path for the hosted server', () => {
		for (const host of admitted) {
			const json = host === undefined ? PROJECTION : { ...PROJECTION, host };
			expect(readProjection(json).ok, JSON.stringify(host)).toBe(true);
		}
		for (const host of refused) {
			const read = readProjection({ ...PROJECTION, host });
			expect(read.ok === false && read.refusals.map(({ code, key }) => [code, key])).toEqual([
				['DEPLOYMENT_INVALID', 'host'],
			]);
		}
	});

	it('P6-E1: a projection before version 4 holds no `host`', () => {
		for (const version of [2, 3]) {
			const read = readProjection({
				...PROJECTION,
				deployment_version: version,
				host: { kind: 'static' },
			});
			expect(read.ok, String(version)).toBe(false);
		}
	});

	it("P6-E1: `projection.v4.json` and `readProjection` agree on every case, since the page's reader checks `host` by hand", () => {
		const validate = schemaAjv().getSchema(readSchema('projection', 4).$id);
		if (!validate) throw new Error('projection.v4.json is not compiled');
		for (const host of [...admitted, ...refused]) {
			for (const version of [2, 3, 4]) {
				const json = {
					...PROJECTION,
					deployment_version: version,
					...(host === undefined ? {} : { host }),
				};
				expect(readProjection(json).ok, `${version} ${JSON.stringify(host)}`).toBe(
					validate(json) === true
				);
			}
		}
	});

	it('P6-E1: stage A boots a version 4 projection and reads no `host`', () => {
		const boot = readBoot({ ...PROJECTION, host: { kind: 'hosted', kernel: 'api/kernel' } });
		expect(boot).toBeDefined();
		expect(Object.keys(boot ?? {})).not.toContain('host');
		expect(boot?.identity).toEqual({ mode: 'local' });
		expect(readBoot({ ...PROJECTION, identity: provider })?.identity?.mode).toBe('provider');
	});
});

describe("P6-E1: a version 4 identity path never shadows the hosted server's own routes (I1 of step 3's review)", () => {
	it('refuses mcp, .well-known, api, api/kernel and api/health, at the start or inside, as DEPLOYMENT_IDENTITY_INVALID', () => {
		for (const path of [
			'mcp',
			'mcp/auth',
			'.well-known',
			'.well-known/auth',
			'api',
			'api/kernel',
			'api/kernel/auth',
			'api/health',
			'api/health/x',
			'auth/api/kernel',
			// NIT 4: any case, as a proxy that folds a path's case would read it.
			'API/Health',
			'Api',
			'MCP',
			'.Well-Known',
			'api/Kernel',
		]) {
			expect(findings(file({ kind: 'hosted' }, { ...provider, path })).refusals, path).toEqual([
				['DEPLOYMENT_IDENTITY_INVALID', 'identity.path'],
			]);
		}
		const read = readDeployment(file({ kind: 'hosted' }, { ...provider, path: 'api/health' }));
		expect(read.ok === false && read.refusals[0]?.suggestion).toContain('api/auth');
	});

	it('admits the default, other paths under api/, and the same paths in version 3, whose static host has no such routes', () => {
		for (const path of ['api/auth', 'api/identity', 'api/kernelx', 'auth/v1'])
			expect(readDeployment(file({ kind: 'hosted' }, { ...provider, path })).ok, path).toBe(true);
		expect(
			readDeployment({
				deployment_version: 3,
				workspace: { id: 'acme' },
				apps: {},
				identity: { ...provider, path: 'api/health' },
			}).ok
		).toBe(true);
	});
});
