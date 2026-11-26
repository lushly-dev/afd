/**
 * P5-S9-6's CLI side (phase 5's no-terminal amendment, 9.3): `loam deployment write` against the shared golden
 * projection in `@lushly-dev/loam-manifest`'s `test/fixtures/desktop-projection-golden.json`, which loam-desktop's Rust
 * materializer (step 9b) must match byte for byte. The fixture's `$comment` states the mapping from installed plugins to
 * instance entries; `entriesOf` below is that mapping, written once in TypeScript.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeploymentV4 } from '@lushly-dev/loam-manifest';
import { type PluginManifestV1, readPluginManifest } from '@lushly-dev/loam-manifest/plugin';
import { stringify } from 'smol-toml';
import { describe, expect, it, vi } from 'vitest';
import { writeDeployment } from './deployment.js';
import { temporaryDirectory } from './test-support.js';

// Elsewhere than Windows, the System32 tools that restrict an owner-only file do not exist: answer as they would, since
// the win32 run here pins bytes, not the ACL, which deployment.test.ts and the desktop suite hold.
vi.mock('node:child_process', async (original) => {
	const real = await original<typeof import('node:child_process')>();
	if (process.platform === 'win32') return real;
	return {
		...real,
		execFile: (
			file: string,
			_args: string[],
			_options: object,
			callback: (error: null, result: { stdout: string; stderr: string }) => void
		) => {
			const stdout = file.endsWith('whoami.exe') ? '"host\\person","S-1-5-21-1-2-3-1001"\r\n' : '';
			callback(null, { stdout, stderr: '' });
		},
	};
});

const FIXTURE = fileURLToPath(
	new URL('../../manifest/test/fixtures/desktop-projection-golden.json', import.meta.url)
);

interface GoldenPlugin {
	manifest: PluginManifestV1;
	files: Record<string, unknown>;
	install?: { port: number };
}

interface Golden {
	workspace: { id: string; name: string };
	inbound: boolean;
	plugins: GoldenPlugin[];
	copilot: NonNullable<DeploymentV4['copilot']>;
	bearer: string;
	expected: {
		linux?: { 'deployment.json': string; 'frame-src': string };
		win32?: { 'deployment.json': string; 'frame-src': string };
		'models.json'?: string;
		mounts?: { mounts: Array<{ instance: string; url: string }>; inbound: boolean };
	};
}

const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden;

const fileText = (value: unknown): string =>
	typeof value === 'string' ? value : `${JSON.stringify(value, null, '\t')}\n`;

/** The packed app manifests of a plugin, by `apps[].id`. */
const appsOf = ({ manifest, files }: GoldenPlugin): Record<string, unknown> =>
	Object.fromEntries(manifest.apps.map(({ id, path }) => [id, files[`${path}/app-manifest.json`]]));

type Entry = DeploymentV4['apps'][string];

/**
 * The amendment's 9.2: plugins in `plugin.id` order, each plugin's apps in `apps[].id` order. A package is where the
 * CLI's test layout puts it, and a bearer is a file beside the deployment; Rust's materializer has neither.
 */
function entriesOf(plugins: readonly GoldenPlugin[]): Record<string, Entry> {
	const apps: Record<string, Entry> = {};
	const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	for (const plugin of [...plugins].sort((a, b) => byId(a.manifest.plugin, b.manifest.plugin))) {
		const { manifest } = plugin;
		const engine = manifest.engine;
		for (const app of [...manifest.apps].sort(byId)) {
			const packed = plugin.files[`${app.path}/app-manifest.json`] as { plugin: { id: string } };
			const entry: Entry = {
				app: packed.plugin.id,
				package: `plugins/${manifest.plugin.id}/${app.path}`,
			};
			if (engine && engine.mount_app === app.id) {
				const { mount } = engine;
				Object.assign(entry, {
					audience: mount.audience,
					transport: 'http',
					url: `http://127.0.0.1:${plugin.install?.port}/mcp`,
					...(engine.auth.mode === 'none' ? {} : { bearer_file: `${manifest.plugin.id}.token` }),
					labels: mount.labels ?? 'whole',
					approvals: mount.approvals ?? 'none',
					...(mount.expose ? { expose: mount.expose } : {}),
					...(mount.commands ? { commands: mount.commands } : {}),
				});
			}
			apps[app.id] = entry;
		}
	}
	return apps;
}

const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

/** `loam deployment write --host desktop` for one platform, from the fixture's installed state. */
async function writeFor(platform: 'linux' | 'win32') {
	const root = await temporaryDirectory();
	const put = async (path: string, text: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), text);
	};
	const deployment = {
		deployment_version: 4,
		workspace: golden.workspace,
		host: { kind: 'desktop', inbound: golden.inbound },
		copilot: golden.copilot,
		apps: entriesOf(golden.plugins),
	};
	await put('deploy/loam.deployment.toml', stringify(deployment));
	for (const { manifest, files, install } of golden.plugins) {
		for (const [path, value] of Object.entries(files))
			await put(`deploy/plugins/${manifest.plugin.id}/${path}`, fileText(value));
		if (install && manifest.engine?.auth.mode !== 'none')
			await put(`deploy/${manifest.plugin.id}.token`, `${golden.bearer}\n`);
	}
	await put(
		'dist/index.html',
		`<!doctype html>\n<html><head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n</head></html>`
	);
	const out = join(root, 'out');
	const mountsOut = join(root, 'private/mounts.json');
	const modelsOut = join(root, 'private/models.json');
	if (platform === 'win32' && process.platform !== 'win32')
		vi.stubEnv('SystemRoot', join(root, 'Windows'));
	const written = await writeDeployment({
		config: join(root, 'deploy/loam.deployment.toml'),
		dist: join(root, 'dist'),
		out,
		mountsOut,
		modelsOut,
		platform,
	});
	vi.unstubAllEnvs();
	expect(written.ok ? [] : written.refusals).toEqual([]);
	expect(written.ok ? written.warnings : []).toEqual([]);
	const policy = /content="([^"]*)"/.exec(readFileSync(join(out, 'index.html'), 'utf8'))?.[1];
	return {
		deployment: readFileSync(join(out, 'deployment.json'), 'utf8'),
		frameSrc: /(?:^|;\s*)frame-src ([^;]*)/.exec(policy ?? '')?.[1],
		models: readFileSync(modelsOut, 'utf8'),
		mounts: JSON.parse(readFileSync(mountsOut, 'utf8')) as {
			mounts: Array<{ instance: string; url: string; bearer?: string }>;
			inbound: boolean;
		},
	};
}

describe('P5-S9-6: the shared golden projection, CLI side (9.3)', () => {
	it('holds plugins whose manifests and apps pass readPluginManifest', () => {
		for (const plugin of golden.plugins) {
			const read = readPluginManifest(plugin.manifest, appsOf(plugin));
			expect(read.ok ? [] : read.refusals, plugin.manifest.plugin.id).toEqual([]);
		}
		// What 9.3 asks the fixture to hold: a native app, a view app, an authenticated mounted engine and a provider.
		const kinds = golden.plugins.flatMap((plugin) =>
			Object.values(appsOf(plugin)).map((app) => (app as { plugin: { kind: string } }).plugin.kind)
		);
		expect(new Set(kinds)).toEqual(new Set(['native', 'view', 'mounted']));
		expect(golden.plugins.some(({ manifest }) => manifest.engine?.auth.mode === 'approver')).toBe(
			true
		);
		expect(golden.copilot.providers?.length).toBeGreaterThan(0);
	});

	it('P5-S9-6: `loam deployment write --host desktop` writes the golden bytes on each platform', async () => {
		const linux = await writeFor('linux');
		const win32 = await writeFor('win32');
		const actual = {
			linux: { 'deployment.json': linux.deployment, 'frame-src': linux.frameSrc },
			win32: { 'deployment.json': win32.deployment, 'frame-src': win32.frameSrc },
			'models.json': linux.models,
			mounts: {
				mounts: linux.mounts.mounts.map(({ instance, url }) => ({ instance, url })),
				inbound: linux.mounts.inbound,
			},
		};
		if (process.env.LOAM_GOLDEN_UPDATE === '1') {
			const document = JSON.parse(readFileSync(FIXTURE, 'utf8'));
			document.expected = actual;
			writeFileSync(FIXTURE, `${JSON.stringify(document, null, '\t')}\n`);
		}
		expect(actual).toEqual(golden.expected);
		// The platforms differ in the sandbox origin alone.
		expect(win32.models).toBe(linux.models);
		expect(win32.mounts).toEqual(linux.mounts);
		// A mounted entry's `expose` and `commands` keep plugin-manifest.json's key order, which Rust reads preserving it.
		const projected = JSON.parse(linux.deployment) as {
			apps: Array<{ instance: string; expose?: unknown; commands?: unknown }>;
		};
		for (const { manifest } of golden.plugins) {
			const mounted = projected.apps.find(
				({ instance }) => instance === manifest.engine?.mount_app
			);
			if (!manifest.engine || !mounted) continue;
			expect(JSON.stringify(mounted.commands)).toBe(JSON.stringify(manifest.engine.mount.commands));
			expect(JSON.stringify(mounted.expose)).toBe(JSON.stringify(manifest.engine.mount.expose));
		}
		// The CLI's credential is the file's bearer; Rust's is a keychain reference and a proof key (9.3), never this.
		expect(linux.mounts.mounts.map(({ bearer }) => bearer)).toEqual([golden.bearer]);
		for (const text of [linux.deployment, linux.models, win32.deployment]) {
			expect(text).not.toContain(golden.bearer);
			expect(text).not.toContain('17400');
		}
	});
});
