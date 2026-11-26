import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot, pluginAjv, readSchema } from '../scripts/compile.mjs';
import {
	bundlePathProblem,
	PLUGIN_ADMITTED_KEYS_V1,
	PLUGIN_FORBIDDEN_KEYS_V1,
	PLUGIN_TARGETS_V1,
	type PluginManifestV1,
	pluginAppsRefusals,
	readPluginManifest,
} from './plugin.js';
import type { ManifestV2 } from './types.js';

type Json = Record<string, unknown>;
interface Case {
	name: string;
	patch: Json;
}
interface Refused extends Case {
	refusals: { code: string; key: string }[];
}
interface AppCase extends Refused {
	apps: Record<string, Pick<ManifestV2, 'plugin' | 'mount'>>;
}

const cases = JSON.parse(
	readFileSync(join(packageRoot, 'test/fixtures/loam-plugin-cases.json'), 'utf8')
) as { base: Json; valid: Case[]; refused: Refused[]; appCases: AppCase[] };

/** RFC 7386: `null` removes a key, an object merges, anything else replaces. */
function mergePatch(target: unknown, patch: unknown): unknown {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
	const out: Json =
		typeof target === 'object' && target !== null && !Array.isArray(target)
			? { ...(target as Json) }
			: {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete out[key];
		else out[key] = mergePatch(out[key], value);
	}
	return out;
}

const manifestOf = (patch: Json) => mergePatch(cases.base, patch);
const sorted = (refusals: readonly { code: string; key: string }[]) =>
	refusals.map(({ code, key }) => `${code} ${key}`).sort();

describe('readPluginManifest (P5-S9-2, the manifest alone)', () => {
	it.each(cases.valid.map((entry) => [entry.name, entry] as const))('reads %s', (_name, entry) => {
		const read = readPluginManifest(manifestOf(entry.patch));
		expect(read.ok ? [] : read.refusals).toEqual([]);
	});

	it.each(cases.refused.map((entry) => [entry.name, entry] as const))(
		'refuses %s',
		(_name, entry) => {
			const read = readPluginManifest(manifestOf(entry.patch));
			expect(read.ok).toBe(false);
			if (read.ok) return;
			expect(sorted(read.refusals)).toEqual(sorted(entry.refusals));
			for (const refusal of read.refusals) {
				expect(refusal.message).not.toBe('');
				expect(refusal.suggestion).not.toBe('');
			}
		}
	);

	it('refuses every key that would run, reach or authenticate an engine, wherever it is', () => {
		for (const key of PLUGIN_FORBIDDEN_KEYS_V1) {
			for (const at of [[], ['plugin'], ['engine'], ['engine', 'mount'], ['engine', 'auth']]) {
				const patch: Json = {};
				let table = patch;
				for (const name of at) {
					const inner: Json = {};
					table[name] = inner;
					table = inner;
				}
				table[key] = 'x';
				const read = readPluginManifest(manifestOf(patch));
				expect(read.ok, `${[...at, key].join('.')}`).toBe(false);
				if (!read.ok) {
					expect(read.refusals.map((refusal) => refusal.key)).toContain([...at, key].join('.'));
					expect(read.refusals[0]?.suggestion).toMatch(/serve --port/);
				}
			}
		}
	});

	it("refuses a lone surrogate, which a strict JSON reader such as Rust's cannot read (so it is not in the shared cases)", () => {
		const read = readPluginManifest(
			manifestOf({ plugin: { title: `Mail${String.fromCharCode(0xd800)}` } })
		);
		expect(read.ok ? [] : sorted(read.refusals)).toEqual(['PLUGIN_MANIFEST_INVALID plugin.title']);
	});

	it('suggests the key meant', () => {
		const read = readPluginManifest(manifestOf({ engine: { mount: { aprovals: 'shell' } } }));
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.refusals[0]?.suggestion).toMatch(/Did you mean `approvals`\?/);
	});

	it('reads what is not an object as refused, not as a throw', () => {
		for (const value of [null, 1, 'mail', [], undefined]) {
			expect(readPluginManifest(value).ok).toBe(false);
		}
	});

	it('names every path problem', () => {
		expect(bundlePathProblem('apps/mail')).toBeUndefined();
		expect(bundlePathProblem('engines/linux-x64/loam-mail')).toBeUndefined();
		for (const path of [
			'',
			'apps//mail',
			'./apps',
			'apps/.',
			'apps/\u0000',
			'apps/nul',
			'apps/LPT1.log',
			'apps/a\u202eb',
		]) {
			expect(bundlePathProblem(path), JSON.stringify(path)).toBeDefined();
		}
	});
});

describe('pluginAppsRefusals (P5-S9-2, with the packed app manifests)', () => {
	it.each(cases.appCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
		const read = readPluginManifest(manifestOf(entry.patch));
		expect(read.ok ? [] : read.refusals).toEqual([]);
		if (!read.ok) return;
		const refusals = pluginAppsRefusals(read.manifest, new Map(Object.entries(entry.apps)));
		expect(sorted(refusals)).toEqual(sorted(entry.refusals));
	});

	it('leaves an app with no manifest to the caller', () => {
		const read = readPluginManifest(cases.base);
		expect(read.ok).toBe(true);
		if (read.ok) expect(pluginAppsRefusals(read.manifest, new Map())).toEqual([]);
	});
});

describe('the plugin manifest schema', () => {
	/** Each object's keys in the schema, by the pointer shape the table uses. */
	function schemaKeys(node: Json, pointer: string, found: Record<string, string[]>): void {
		const resolved =
			typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')
				? ((readSchema('loam-plugin').$defs as Json)[node.$ref.slice(8)] as Json)
				: node;
		const properties = resolved.properties as Record<string, Json> | undefined;
		if (properties) {
			found[pointer] = Object.keys(properties);
			for (const [name, schema] of Object.entries(properties)) {
				const at = pointer === '/engine/artifacts' ? `${pointer}/*` : `${pointer}/${name}`;
				schemaKeys(schema, at, found);
			}
		}
		const inner = (resolved.items ?? resolved.additionalProperties) as Json | undefined;
		if (inner && typeof inner === 'object') schemaKeys(inner, `${pointer}/*`, found);
	}

	it('admits what the suggestions say it admits', () => {
		const found: Record<string, string[]> = {};
		schemaKeys(readSchema('loam-plugin') as Json, '', found);
		expect(found).toEqual(
			Object.fromEntries(
				Object.entries(PLUGIN_ADMITTED_KEYS_V1).map(([key, value]) => [key, [...value]])
			)
		);
	});

	it('compiles under strict, each $ref resolving against spec/', () => {
		expect(typeof pluginAjv().getSchema(readSchema('loam-plugin').$id)).toBe('function');
	});

	it('names the six targets', () => {
		const artifacts = (readSchema('loam-plugin') as { properties: Json }).properties.engine as {
			properties: { artifacts: { properties: Json } };
		};
		expect(Object.keys(artifacts.properties.artifacts.properties)).toEqual([...PLUGIN_TARGETS_V1]);
	});

	it('types what it reads', () => {
		const read = readPluginManifest(cases.base);
		expect(read.ok).toBe(true);
		const manifest: PluginManifestV1 | undefined = read.ok ? read.manifest : undefined;
		expect(manifest?.engine?.auth.mode).toBe('approver');
	});
});
