import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { AJV_OPTIONS, readCore, readSchema } from '../scripts/compile.mjs';
import { COMPOSITIONS_V1, ICONS_V1, SHELL_DOMAINS_V1, SURFACE_CATALOG_V1 } from './catalogs.js';
import { valueAt } from './pointers.js';
import { readCoreManifest } from './read-core-manifest.js';
import { readManifest } from './read-manifest.js';
import { validateManifest } from './validate.generated.js';
import { pointerOf, type ValidatorError } from './validator-errors.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;

interface ProfileCase {
	id: string;
	base: string;
	set?: Record<string, unknown>;
	remove?: string[];
	accepted: boolean;
	code?: string;
	key?: string;
	suggestion?: string;
	alsoKeys?: string[];
	warnings?: { code: string; key: string }[];
}

const { bases, cases } = JSON.parse(
	readFileSync(new URL('./profile-cases.json', import.meta.url), 'utf8')
) as { bases: Record<string, unknown>; cases: ProfileCase[] };

function walk(document: unknown, pointer: string): [Record<string, unknown>, string] {
	const parts = pointer.split('/').slice(1);
	const last = parts.pop() as string;
	let at = document as Record<string, unknown>;
	for (const [index, part] of parts.entries()) {
		at[part] ??= /^\d+$/.test(parts[index + 1] ?? last) ? [] : {};
		at = at[part] as Record<string, unknown>;
	}
	return [at, last];
}

function manifestOf(item: ProfileCase): unknown {
	const document = structuredClone(bases[item.base]);
	for (const pointer of item.remove ?? []) {
		const [at, last] = walk(document, pointer);
		delete at[last];
	}
	for (const [pointer, value] of Object.entries(item.set ?? {})) {
		const [at, last] = walk(document, pointer);
		at[last] = value;
	}
	return document;
}

describe("Loam's profile", () => {
	for (const item of cases) {
		it(item.id, () => {
			const read = readManifest(manifestOf(item));
			if (item.accepted) {
				expect(read.ok ? [] : read.refusals).toEqual([]);
			} else {
				expect(read.ok).toBe(false);
				if (read.ok) return;
				expect(read.refusals.map((refusal) => refusal.key).sort()).toEqual(
					[item.key as string, ...(item.alsoKeys ?? [])].sort()
				);
				const refusal = read.refusals.find((candidate) => candidate.key === item.key);
				expect(refusal?.code).toBe(item.code);
				expect(refusal?.suggestion).toContain(item.suggestion ?? '');
				for (const each of read.refusals) {
					expect(each.message).not.toBe('');
					expect(each.suggestion).not.toBe('');
				}
			}
			expect(read.warnings.map(({ code, key }) => ({ code, key }))).toEqual(item.warnings ?? []);
		});
	}

	it('holds manifests that also pass the core alone (E7: hello in three kinds, the headless umbel)', () => {
		expect(Object.keys(bases).sort()).toEqual(['mounted', 'native', 'umbel', 'view']);
		for (const [name, manifest] of Object.entries(bases)) {
			const read = readCoreManifest(manifest);
			expect(read.ok ? [] : read.refusals, name).toEqual([]);
		}
	});

	it('has a refusal for every closed object, at its depth (P1)', () => {
		const profile = readSchema('app-manifest', 2);
		const defined = Object.entries(profile.$defs)
			.filter(
				([, schema]) =>
					(schema as { unevaluatedProperties?: boolean }).unevaluatedProperties === false
			)
			.map(([name]) => name);
		const ids = new Set(cases.map((item) => item.id));
		for (const name of ['root', ...defined]) expect(ids.has(`closed-${name}`), name).toBe(true);
	});

	it('keeps the vocabularies in the schema equal to the catalogs', () => {
		const { $defs } = readSchema('app-manifest', 2) as unknown as {
			$defs: {
				plugin: { properties: { id: { not: { enum: string[] } } } };
				rail: { properties: { icon: { enum: string[] } } };
				ui: { properties: { compositions: { items: { enum: string[] } } } };
				surfaces: { properties: Record<string, unknown> };
			};
		};
		expect($defs.plugin.properties.id.not.enum).toEqual([...SHELL_DOMAINS_V1, 'afd']);
		expect($defs.rail.properties.icon.enum).toEqual(ICONS_V1);
		expect($defs.ui.properties.compositions.items.enum).toEqual(
			COMPOSITIONS_V1.filter((entry) => entry.servedFrom === 1).map((entry) => entry.name)
		);
		const underSurfaces = SURFACE_CATALOG_V1.filter((entry) =>
			entry.place.startsWith('ui.surfaces.')
		).map((entry) => entry.id);
		expect(Object.keys($defs.surfaces.properties).sort()).toEqual(underSurfaces.sort());
	});

	it('P2-E11: profile-cases.json covers each version 2 key and its two refusals', () => {
		const ids = new Set(cases.map((item) => item.id));
		for (const key of [
			'app-resource-keys',
			'sidebar-tree',
			'ui-project-summary',
			'ui-documents',
			'ui-new',
		]) {
			// Under version 1, the version is what the author is told; under 2, that no step serves it yet.
			expect(ids.has(`version-keys-${key}`), key).toBe(true);
			expect(ids.has(`not-yet-served-${key}`), key).toBe(true);
		}
		for (const item of cases.filter((candidate) => candidate.id.startsWith('version-keys-'))) {
			if (item.id !== 'version-keys-each-once') expect(item.base).toBe('native');
			expect(item.suggestion).toBe('Set manifest_version = 2.');
		}
	});

	it('P2-E11: reads every document of version 1 as it did: valid under 1 is valid under 2, with the same errors otherwise (D76)', () => {
		const ajv = new Ajv2020({ ...AJV_OPTIONS });
		ajv.addSchema(readCore());
		const validateV1 = ajv.compile(readSchema('app-manifest', 1));
		const versionTwo = ['/app/resource_keys', '/ui/project_summary', '/ui/documents', '/ui/new'];
		const errorsOf = (errors: readonly ValidatorError[] | null | undefined): string[] =>
			(errors ?? [])
				.filter((error) => error.keyword !== 'if')
				.map((error) => `${error.keyword} ${pointerOf(error)}`)
				.sort();
		const documents = [
			...Object.values(bases).map((base) => [base, true] as const),
			...cases.map((item) => [manifestOf(item), item.accepted] as const),
		];
		let validUnderOne = 0;
		let invalidUnderBoth = 0;
		for (const [document, accepted] of documents) {
			const v1 = validateV1(document);
			const v1Errors = errorsOf(validateV1.errors);
			const v2 = validateManifest(document);
			if (v1) {
				validUnderOne++;
				expect(v2, JSON.stringify(document).slice(0, 80)).toBe(true);
				const read = readManifest(document);
				// What a version 1 manifest meant, it still means: same document, same findings.
				if (accepted && read.ok) expect(read.manifest).toEqual(document);
				continue;
			}
			const holdsVersionTwo =
				valueAt(document, '/manifest_version') !== 1 ||
				versionTwo.some((pointer) => valueAt(document, pointer) !== undefined) ||
				valueAt(document, '/ui/surfaces/sidebar/shape') === 'tree';
			if (holdsVersionTwo) continue;
			expect(v2).toBe(false);
			expect(errorsOf(validateManifest.errors)).toEqual(v1Errors);
			invalidUnderBoth++;
		}
		// The comparison ran over a real corpus, not an empty one.
		expect(validUnderOne).toBeGreaterThan(20);
		expect(invalidUnderBoth).toBeGreaterThan(100);
	});

	it('reads what is not a manifest as a refusal, not a throw', () => {
		for (const value of [null, 1, 'x', []]) {
			const read = readManifest(value);
			expect(read.ok).toBe(false);
		}
	});

	it('refuses a schema nested past the stack, as untrusted input', () => {
		let schema: Record<string, unknown> = { type: 'string' };
		for (let depth = 0; depth < 20_000; depth++)
			schema = { type: 'object', properties: { a: schema } };
		const native = structuredClone(bases.native) as {
			commands: { input_schema: unknown }[];
			config: { schema: unknown };
		};
		(native.commands[0] as { input_schema: unknown }).input_schema = schema;
		native.config.schema = { ...schema, additionalProperties: false };
		const read = readManifest(native);
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.refusals.map((refusal) => [refusal.code, refusal.key])).toEqual([
			['MANIFEST_INPUT_SCHEMA_INVALID', 'commands[0].input_schema'],
			['MANIFEST_CONFIG_SCHEMA_INVALID', 'config.schema'],
		]);
	});

	it('reports each key once, though a closing profile reaches the core by two paths', () => {
		const read = readManifest({ ...(bases.native as object), plugin: { id: 1 } });
		expect(read.ok).toBe(false);
		if (read.ok) return;
		const keys = read.refusals.map((refusal) => refusal.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain('plugin.id');
	});
});
