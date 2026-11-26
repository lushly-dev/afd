/**
 * @fileoverview P5-S9-6's CLI half (phase 5 no-terminal amendment, 9.3; D168): `deployment write --host desktop` writes
 * exactly the golden projection's `deployment.json`, `models.json`, `frame-src` and `mounts.json` fields from the shared
 * fixture's input. loam-desktop's Rust materializer (step 9b) is held to the same file.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { writeDeployment } from './deployment.js';
import { temporaryDirectory } from './test-support.js';

interface GoldenApp {
	plugin: string;
	instance: string;
	manifest: { plugin: { kind: string } } & Record<string, unknown>;
	mount?: {
		port: number;
		auth: 'approver' | 'agent' | 'none';
		labels: string;
		approvals: string;
		expose: Record<string, boolean>;
		commands: Record<string, unknown>;
	};
}

interface Golden {
	platform: NodeJS.Platform;
	workspace: { id: string; name: string };
	identity: { mode: 'local' };
	inbound: boolean;
	copilot: { default: string; providers: Record<string, unknown>[] };
	apps: GoldenApp[];
	expected: {
		deployment: unknown;
		models: unknown;
		mounts: { mounts: { instance: string; url: string }[]; inbound: boolean };
		frameSrc: string;
	};
}

const FIXTURE = join(
	import.meta.dirname,
	'../../manifest/test/fixtures/desktop-projection-golden.json'
);
const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden;
const TOKEN = 'golden-bearer-that-only-mounts-json-holds';
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

/** The bytes an expected object stands for: tab-indented, keys in the fixture's order, a trailing newline. */
const bytesOf = (value: unknown): string => `${JSON.stringify(value, null, '\t')}\n`;

async function write(path: string, text: string, mode?: number): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text, mode === undefined ? {} : { mode });
}

/** The fixture's input as the deployer's file, with each package and the engine's bearer beside it. */
async function layout(root: string): Promise<string> {
	const apps: Record<string, unknown> = {};
	for (const app of golden.apps) {
		const dir = join(root, 'deploy/packages', app.instance);
		await write(join(dir, 'app-manifest.json'), JSON.stringify(app.manifest));
		if (app.manifest.plugin.kind === 'native')
			await write(join(dir, 'dist/native.js'), 'export default {};\n');
		const entry: Record<string, unknown> = {
			app: (app.manifest.plugin as unknown as { id: string }).id,
			package: `packages/${app.instance}`,
		};
		if (app.mount) {
			await write(join(root, 'deploy/keys', `${app.instance}.token`), `${TOKEN}\n`, 0o600);
			Object.assign(entry, {
				prefix: (app.manifest.mount as { prefix: string }).prefix,
				audience: 'person',
				transport: 'http',
				url: `http://127.0.0.1:${app.mount.port}/mcp`,
				...(app.mount.auth === 'none' ? {} : { bearer_file: `keys/${app.instance}.token` }),
				labels: app.mount.labels,
				approvals: app.mount.approvals,
				expose: app.mount.expose,
				commands: app.mount.commands,
			});
		}
		apps[app.instance] = entry;
	}
	const file = {
		deployment_version: 4,
		workspace: golden.workspace,
		identity: golden.identity,
		host: { kind: 'desktop', inbound: golden.inbound },
		copilot: golden.copilot,
		apps,
	};
	const config = join(root, 'deploy/loam.deployment.toml');
	await write(config, stringify(file));
	await write(
		join(root, 'dist/index.html'),
		`<!doctype html>\n<html><head>\n<meta\n\thttp-equiv="Content-Security-Policy"\n\tcontent="${CSP}"\n/>\n</head></html>`
	);
	await write(join(root, 'dist/assets/app.js'), '1;');
	return config;
}

describe('the golden desktop projection (P5-S9-6, the CLI half)', () => {
	it('is what deployment write --host desktop writes, byte for byte', async () => {
		const root = await temporaryDirectory();
		const config = await layout(root);
		const out = join(root, 'site');
		const mountsOut = join(root, 'private/mounts.json');
		const modelsOut = join(root, 'private/models.json');
		const written = await writeDeployment({
			config,
			dist: join(root, 'dist'),
			out,
			mountsOut,
			modelsOut,
			host: 'desktop',
			platform: golden.platform,
		});
		expect(written.ok ? [] : written.refusals).toEqual([]);

		expect(readFileSync(join(out, 'deployment.json'), 'utf8')).toBe(
			bytesOf(golden.expected.deployment)
		);
		expect(readFileSync(modelsOut, 'utf8')).toBe(bytesOf(golden.expected.models));
		const policy = /content="([^"]*)"/.exec(readFileSync(join(out, 'index.html'), 'utf8'))?.[1];
		expect(policy).toContain(`; frame-src ${golden.expected.frameSrc};`);

		// The fields both write; the CLI's credential is the bearer itself, which the materializer never writes.
		const mounts = JSON.parse(readFileSync(mountsOut, 'utf8')) as {
			inbound: boolean;
			mounts: Record<string, unknown>[];
		};
		expect(mounts.inbound).toBe(golden.expected.mounts.inbound);
		expect(mounts.mounts).toEqual(
			golden.expected.mounts.mounts.map((entry) => ({ ...entry, bearer: TOKEN }))
		);
	});

	it('holds no location, credential or key in what is served', () => {
		const served = bytesOf(golden.expected.deployment);
		for (const secret of ['127.0.0.1', '17400', 'bearer', 'keychain', 'proof', TOKEN])
			expect(served).not.toContain(secret);
	});

	it('covers a native app, a view, an authenticated mount and a provider', () => {
		const kinds = golden.apps.map((app) => app.manifest.plugin.kind).sort();
		expect(kinds).toEqual(['mounted', 'native', 'view']);
		expect(golden.apps.some((app) => app.mount && app.mount.auth !== 'none')).toBe(true);
		expect(golden.copilot.providers.length).toBeGreaterThan(0);
		const order = golden.apps.map((app) => `${app.plugin}/${app.instance}`);
		expect(order).toEqual([...order].sort());
	});
});
