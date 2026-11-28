/**
 * @fileoverview P5-S9-6's CLI half (phase 5 no-terminal amendment, 9.3; D168): `deployment write --host desktop` writes
 * exactly the golden projection's `deployment.json`, `models.json`, `frame-src` and `mounts.json` fields from the shared
 * fixture's input and from each of its variants. loam-desktop's Rust materializer (step 9b) is held to the same file.
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
		labels?: string;
		approvals?: string;
		views?: boolean;
		expose?: Record<string, boolean>;
		commands?: Record<string, unknown>;
	};
}

interface Expected {
	deployment: unknown;
	models: unknown;
	mounts: { mounts: { instance: string; url: string }[]; inbound: boolean };
	frameSrc: string;
}

/** One input and what both writers write from it. */
interface Scenario {
	name: string;
	platform: NodeJS.Platform;
	workspace: { id: string; name: string };
	identity: { mode: 'local' };
	inbound: boolean;
	copilot?: { default: string; providers: Record<string, unknown>[] };
	apps: GoldenApp[];
	expected: Expected;
}

type Input = Omit<Scenario, 'name' | 'expected'>;

interface Golden extends Input {
	expected: Expected;
	variants: { name: string; patch: Record<string, unknown>; expected: Expected }[];
}

const FIXTURE = join(
	import.meta.dirname,
	'../../manifest/test/fixtures/desktop-projection-golden.json'
);
const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden;

/** RFC 7386: `null` removes a key, an object merges, anything else replaces; as `materialize_tests.rs` applies it. */
function mergePatch(target: unknown, patch: unknown): unknown {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
	const out: Record<string, unknown> =
		typeof target === 'object' && target !== null && !Array.isArray(target)
			? { ...(target as Record<string, unknown>) }
			: {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete out[key];
		else out[key] = mergePatch(out[key], value);
	}
	return out;
}

const {
	description: _description,
	expected: _expected,
	variants,
	...input
} = golden as Golden & {
	description: string;
};
const scenarios: Scenario[] = [
	{ name: 'the input', ...input, expected: golden.expected },
	...variants.map(({ name, patch, expected }) => ({
		...(mergePatch(input, patch) as Input),
		name,
		expected,
	})),
];
const TOKEN = 'golden-bearer-that-only-mounts-json-holds';
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

/** The bytes an expected object stands for: tab-indented, keys in the fixture's order, a trailing newline. */
const bytesOf = (value: unknown): string => `${JSON.stringify(value, null, '\t')}\n`;

async function write(path: string, text: string, mode?: number): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text, mode === undefined ? {} : { mode });
}

/** A scenario's input as the deployer's file, with each package and the engine's bearer beside it. */
async function layout(root: string, golden: Scenario): Promise<string> {
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
				// What the input leaves out, the entry leaves out too, so its defaults are the writer's.
				...Object.fromEntries(
					(['labels', 'approvals', 'views', 'expose', 'commands'] as const).flatMap((key) =>
						app.mount?.[key] === undefined ? [] : [[key, app.mount[key]]]
					)
				),
			});
		}
		apps[app.instance] = entry;
	}
	const file = {
		deployment_version: 4,
		workspace: golden.workspace,
		identity: golden.identity,
		host: { kind: 'desktop', inbound: golden.inbound },
		...(golden.copilot ? { copilot: golden.copilot } : {}),
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

/**
 * Runs `write` for `platform`. Off Windows, a Windows deployment's owner-only files are restricted by stand-ins for
 * System32's `whoami` and `icacls`, which name a user and change nothing, so its every file is written and compared.
 */
async function withWindowsTools<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
	if (platform !== 'win32' || process.platform === 'win32') return run();
	const root = await temporaryDirectory();
	await write(
		join(root, 'System32/whoami.exe'),
		'#!/bin/sh\necho \'"golden\\\\user","S-1-5-21-1-2-3-1001"\'\n',
		0o755
	);
	await write(join(root, 'System32/icacls.exe'), '#!/bin/sh\nexit 0\n', 0o755);
	const saved = process.env.SystemRoot;
	process.env.SystemRoot = root;
	try {
		return await run();
	} finally {
		if (saved === undefined) delete process.env.SystemRoot;
		else process.env.SystemRoot = saved;
	}
}

describe('the golden desktop projection (P5-S9-6, the CLI half)', () => {
	it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
		'is what deployment write --host desktop writes from %s, byte for byte',
		async (_name, golden) => {
			const root = await temporaryDirectory();
			const config = await layout(root, golden);
			const out = join(root, 'site');
			const mountsOut = join(root, 'private/mounts.json');
			const modelsOut = join(root, 'private/models.json');
			const written = await withWindowsTools(golden.platform, () =>
				writeDeployment({
					config,
					dist: join(root, 'dist'),
					out,
					mountsOut,
					modelsOut,
					host: 'desktop',
					platform: golden.platform,
				})
			);
			expect(written.ok ? [] : written.refusals).toEqual([]);

			expect(readFileSync(join(out, 'deployment.json'), 'utf8')).toBe(
				bytesOf(golden.expected.deployment)
			);
			const policy = /content="([^"]*)"/.exec(readFileSync(join(out, 'index.html'), 'utf8'))?.[1];
			expect(policy).toContain(`; frame-src ${golden.expected.frameSrc};`);
			expect(readFileSync(modelsOut, 'utf8')).toBe(bytesOf(golden.expected.models));

			// The fields both write; the CLI's credential is the bearer itself, which the materializer never writes.
			const mounts = JSON.parse(readFileSync(mountsOut, 'utf8')) as {
				inbound: boolean;
				mounts: Record<string, unknown>[];
			};
			expect(mounts.inbound).toBe(golden.expected.mounts.inbound);
			// An engine that authenticates nothing is reached with no bearer.
			const authenticates = (instance: string) =>
				golden.apps.find((app) => app.instance === instance)?.mount?.auth !== 'none';
			expect(mounts.mounts).toEqual(
				golden.expected.mounts.mounts.map((entry) =>
					authenticates(entry.instance) ? { ...entry, bearer: TOKEN } : entry
				)
			);
		}
	);

	it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
		'holds no location, credential or key in what is served from %s',
		(_name, golden) => {
			const served = bytesOf(golden.expected.deployment);
			const ports = golden.apps.flatMap((app) => (app.mount ? [String(app.mount.port)] : []));
			for (const secret of ['127.0.0.1', ...ports, 'bearer', 'keychain', 'proof', TOKEN])
				expect(served).not.toContain(secret);
		}
	);

	it('covers a native app, a view, an authenticated mount that lets its views render, and a provider', () => {
		const kinds = golden.apps.map((app) => app.manifest.plugin.kind).sort();
		expect(kinds).toEqual(['mounted', 'native', 'view']);
		expect(golden.apps.some((app) => app.mount && app.mount.auth !== 'none')).toBe(true);
		expect(golden.apps.some((app) => app.mount?.views === true)).toBe(true);
		expect(golden.copilot?.providers.length).toBeGreaterThan(0);
		const order = golden.apps.map((app) => `${app.plugin}/${app.instance}`);
		expect(order).toEqual([...order].sort());
	});

	it('varies it on Windows, and as a bare desktop whose renamed instance authenticates nothing and takes the defaults', () => {
		const [, windows, bare] = scenarios;
		expect(windows?.platform).toBe('win32');
		expect(windows?.apps).toEqual(golden.apps);
		expect(windows?.expected.frameSrc).toBe('http://loam-sandbox.localhost');
		// No view, no mount whose views render and no provider: nothing is framed.
		expect(bare?.copilot).toBeUndefined();
		expect(bare?.apps.some((app) => app.manifest.plugin.kind === 'view' || app.mount?.views)).toBe(
			false
		);
		expect(bare?.expected.frameSrc).toBe("'none'");
		const mounted = bare?.apps.find((app) => app.mount);
		expect(mounted?.mount?.auth).toBe('none');
		expect(mounted?.mount?.labels).toBeUndefined();
		expect(mounted?.mount?.approvals).toBeUndefined();
		// The instance is not its package's id, so a writer that swaps the two cannot match.
		const id = (mounted?.manifest.plugin as unknown as { id: string } | undefined)?.id;
		expect(id).toBeDefined();
		expect(mounted?.instance).not.toBe(id);
		const order = bare?.apps.map((app) => `${app.plugin}/${app.instance}`) ?? [];
		expect(order).toEqual([...order].sort());
	});
});
