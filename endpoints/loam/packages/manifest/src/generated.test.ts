import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	compileValidators,
	generateFacts,
	generateTypes,
	packageRoot,
	readCore,
	readSchema,
	readShapeSchema,
	schemaAjv,
} from '../scripts/compile.mjs';
import {
	AFD_CONTRACT,
	GRANT_CATALOG_V1,
	LAYOUT_DEFAULTS_V0,
	SHELL_DOMAINS_V1,
	SHELL_RESERVED_CHORDS_V1,
	SURFACE_CATALOG_V1,
} from './index.js';
import { validateSchemaShape } from './validate-shape.generated.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const source = (path: string): string => readFileSync(join(packageRoot, path), 'utf8');

describe('what schema:build writes', () => {
	it('leaves the committed files as it would write them', async () => {
		expect(source('src/_generated/types.ts')).toBe(await generateTypes());
		expect(source('src/_generated/facts.ts')).toBe(generateFacts());
	}, 30_000);

	it('P2-E11: compiles every schema under strict, and each $ref resolves against spec/', () => {
		const ajv = schemaAjv();
		for (const [name, version] of [
			['app-manifest', 2],
			['deployment', 1],
			['projection', 1],
		] as const) {
			expect(typeof ajv.getSchema(readSchema(name, version).$id), name).toBe('function');
		}
	});

	it('fails on a $ref the core does not hold', () => {
		const ajv = schemaAjv();
		ajv.addSchema({
			$id: 'https://afd.dev/loam/schemas/dangling.json',
			$ref: `${readCore().$id}#/$defs/nothing`,
		});
		expect(() => ajv.getSchema('https://afd.dev/loam/schemas/dangling.json')).toThrow();
	});

	it('writes modules that run no new Function and require nothing', () => {
		for (const [file, code] of Object.entries(compileValidators())) {
			expect(code, file).not.toMatch(/new Function|\beval\(|\brequire\(/);
			for (const [, path] of code.matchAll(/^import .* from "([^"]+)";$/gm))
				expect(path, file).toMatch(/^ajv\/dist\/runtime\/[a-z0-9]+\.js$/);
		}
	});

	it('records the contract version from spec/VERSION', () => {
		expect(AFD_CONTRACT).toBe(source('../../../../spec/VERSION').trim());
	});
});

describe('the shape of a JSON Schema', () => {
	const meta = new Ajv2020({ strict: false, logger: false });
	it.each([
		[{ type: 'object' }],
		[true],
		[{ type: ['string', 'null'], minLength: 1 }],
		[{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }],
		[{ allOf: [{ type: 'object' }], not: { const: 1 } }],
		[JSON.parse('{ "if": true, "then": false, "else": {} }')],
		[{ items: { enum: [1, 'a'] }, prefixItems: [{ type: 'string' }], contains: {} }],
		[{ $defs: { a: { type: 'string' } }, $ref: '#/$defs/a', unknownKeyword: 1 }],
		[{ dependentRequired: { a: ['b'] }, dependentSchemas: { a: {} }, patternProperties: {} }],
		[{ type: 'object', properties: 1 }],
		[{ type: 'nonsense' }],
		[{ type: [] }],
		[{ $id: 'a#b' }],
		[{ $id: 'a#' }],
		[{ $anchor: '1x' }],
		[{ $anchor: 'a1' }],
		[{ $dynamicAnchor: '1' }],
		[{ $recursiveAnchor: '1' }],
		[{ required: 'a' }],
		[{ required: ['a', 'a'] }],
		[{ required: [1] }],
		[{ minLength: 'x' }],
		[{ minLength: -1 }],
		[{ minItems: 1.5 }],
		[{ allOf: [] }],
		[{ anyOf: {} }],
		[{ not: 1 }],
		[{ items: 1 }],
		[{ properties: { a: { type: 'nonsense' } } }],
		[{ multipleOf: 0 }],
		[{ uniqueItems: 'yes' }],
		[{ pattern: 1 }],
		[{ enum: 1 }],
		[1],
	])('answers as the metaschema does for %j', (schema) => {
		expect(validateSchemaShape(schema)).toBe(Boolean(meta.validateSchema(schema)));
	});
});

describe('the keywords of the shape schema', () => {
	it("are the 2020-12 metaschema's", () => {
		const refs = 'ajv/dist/refs/json-schema-2020-12';
		const documents = [
			require(`${refs}/schema.json`),
			...[
				'applicator',
				'content',
				'core',
				'format-annotation',
				'meta-data',
				'unevaluated',
				'validation',
			].map((name) => require(`${refs}/meta/${name}.json`)),
		] as { properties: Record<string, unknown> }[];
		const keywords = documents.flatMap((document) => Object.keys(document.properties));
		const shape = readShapeSchema() as unknown as { properties: Record<string, unknown> };
		expect(Object.keys(shape.properties).sort()).toEqual([...new Set(keywords)].sort());
	});
});

describe('the root', () => {
	it('imports no validator and no Node.js builtin', () => {
		const files = ['index.ts', 'catalogs.ts', 'types.ts'];
		for (const file of files) {
			const code = source(`src/${file}`);
			expect(code, file).not.toMatch(/generated\.js|from 'zod'|from 'ajv|node:/);
		}
	});

	it('runs no Node.js builtin in what /validate imports', () => {
		for (const entry of readdirSync(join(packageRoot, 'src'))) {
			if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
			expect(source(`src/${entry}`), entry).not.toMatch(/from 'node:/);
		}
	});

	it('holds the catalogs the specification names', () => {
		expect(SURFACE_CATALOG_V1).toHaveLength(22);
		expect(new Set(SURFACE_CATALOG_V1.map((entry) => entry.id)).size).toBe(22);
		expect(GRANT_CATALOG_V1.filter((entry) => entry.servedFrom === 1).map((e) => e.name)).toEqual([
			'store',
			'clock',
			'random',
		]);
		expect(SHELL_DOMAINS_V1).toContain('status');
		expect(SHELL_RESERVED_CHORDS_V1).toContain('Mod+K');
		expect(LAYOUT_DEFAULTS_V0.sidebar.min).toBe(200);
	});
});
