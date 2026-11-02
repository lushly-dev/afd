import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { fromJSONSchema } from 'zod';
import {
	jitlessByDefault,
	narrowFromJsonSchema,
	narrowZodFromJsonSchema,
	zodJitlessByDefault,
} from '../scripts/narrow-zod.mjs';

const require = createRequire(import.meta.url);
const CLASSIC = join(dirname(require.resolve('zod/package.json')), 'v4/classic');
const FILE = join(CLASSIC, 'from-json-schema.js');

const string = (format: string) => ({ type: 'string', format });
const FORMATS = [
	'email',
	'uri',
	'uuid',
	'hostname',
	'date',
	'time',
	'date-time',
	'duration',
	'ipv4',
	'ipv6',
	'nanoid',
	'cuid',
	'ulid',
	'base64',
	'emoji',
	'regex',
	'uri-reference',
	'guid',
	'mac',
	'cidr',
	'cidr-v6',
	'base64url',
	'e164',
	'credit_card',
	'iban',
	'jwt',
	'cuid2',
	'xid',
	'ksuid',
].map(string);

/** A schema per keyword `fromJSONSchema` handles, with inputs either side of it. */
const CASES: Array<[Record<string, unknown>, unknown[]]> = [
	[
		{
			type: 'object',
			properties: { a: { type: 'string', minLength: 2, maxLength: 3, pattern: '^a' } },
			required: ['a'],
			additionalProperties: false,
		},
		[{ a: 'ab' }, { a: 'x' }, {}, { a: 'ab', b: 1 }],
	],
	[{ type: 'number', minimum: 1, maximum: 2, multipleOf: 0.5 }, [1, 3, 1.25]],
	[{ type: 'integer', exclusiveMinimum: 1 }, [2, 1, 1.5]],
	[{ type: 'boolean' }, [true, 'x']],
	[{ type: 'null' }, [null, 0]],
	[
		{ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
		[['a'], [], ['a', 'b', 'c'], [1]],
	],
	[
		{ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
		[
			['a', 1],
			[1, 'a'],
		],
	],
	[{ enum: ['a', 1, null] }, ['a', 1, null, 'b']],
	[{ const: 'x' }, ['x', 'y']],
	[{ anyOf: [{ type: 'string' }, { type: 'number' }] }, ['a', 1, true]],
	[{ oneOf: [{ type: 'string' }, { type: 'number' }] }, ['a', true]],
	[
		{
			allOf: [
				{ type: 'object', properties: { a: { type: 'string' } } },
				{ type: 'object', properties: { b: { type: 'string' } } },
			],
		},
		[{ a: 'x', b: 'y' }, { a: 1 }],
	],
	[{ type: 'object', additionalProperties: { type: 'number' } }, [{ a: 1 }, { a: 'x' }]],
	[{ type: 'object', propertyNames: { pattern: '^a' } }, [{ a: 1 }, { b: 1 }]],
	[{ type: ['string', 'null'] }, ['a', null, 1]],
	[{ $defs: { name: { type: 'string' } }, $ref: '#/$defs/name' }, ['a', 1]],
	[{ not: {} }, ['a']],
	...FORMATS.map((schema): [Record<string, unknown>, unknown[]] => [
		schema,
		['not-a-match', 'a@example.com', '2026-11-02', '2026-11-02T00:00:00Z', '127.0.0.1', '😀'],
	]),
];

/** What a schema accepts of its inputs, or that it cannot be built. */
function outcomes(from: typeof fromJSONSchema, schema: Record<string, unknown>, inputs: unknown[]) {
	try {
		const built = from(schema as Parameters<typeof fromJSONSchema>[0]);
		return inputs.map((input) => built.safeParse(input).success);
	} catch (cause) {
		return (cause as Error).message;
	}
}

describe('starting Zod jitless (phase 1 specification, 9.5)', () => {
	it("sets it where Zod's core creates its shared configuration", async () => {
		const source = await readFile(join(CLASSIC, '../core/core.js'), 'utf8');
		const patched = jitlessByDefault(source);
		expect(patched).not.toBe(source);
		expect(patched).toContain('__zod_globalConfig = { jitless: true }');
	});

	it('stops the build when the file changes shape, and leaves other files alone', () => {
		expect(() => jitlessByDefault('const a = 1;')).toThrow(/no longer creates/);
		const plugin = zodJitlessByDefault() as { transform(code: string, id: string): unknown };
		expect(plugin.transform('const a = 1;', '/x/zod/v4/core/schemas.js')).toBeNull();
	});
});

describe("narrowing Zod's fromJSONSchema (phase 1 specification, 9.5)", () => {
	it('writes out only the names the file reads', async () => {
		const narrowed = narrowFromJsonSchema(await readFile(FILE, 'utf8'), CLASSIC);
		expect(narrowed).not.toContain('..._schemas');
		expect(narrowed).toContain('object: _schemas.object');
		expect(narrowed).toContain('minLength: _checks.minLength');
		expect(narrowed).toContain('iso: _iso');
	});

	it('stops the build when the file changes shape', async () => {
		expect(() => narrowFromJsonSchema('const z = _schemas;', CLASSIC)).toThrow(/no longer builds/);
		const source = await readFile(FILE, 'utf8');
		expect(() => narrowFromJsonSchema(`${source}\nz.notAThing();`, CLASSIC)).toThrow(
			/z\.notAThing is in neither/
		);
		expect(() => narrowFromJsonSchema(`${source}\nz[name]();`, CLASSIC)).toThrow(/computed name/);
		expect(() => narrowFromJsonSchema(`${source}\nuse(z);`, CLASSIC)).toThrow(/passes it on/);
	});

	it('leaves other files alone', () => {
		const plugin = narrowZodFromJsonSchema() as { transform(code: string, id: string): unknown };
		expect(plugin.transform('const a = 1;', '/x/zod/v4/classic/schemas.js')).toBeNull();
	});

	it('answers as Zod does, bundled, for every keyword and format', async () => {
		const outDir = await mkdtemp(join(tmpdir(), 'loam-narrow-zod-'));
		try {
			const entry = join(outDir, 'entry.mjs');
			await writeFile(
				entry,
				`export { fromJSONSchema } from ${JSON.stringify(require.resolve('zod').replace(/index\.cjs$/, 'index.js'))};\n`
			);
			await build({
				configFile: false,
				logLevel: 'error',
				plugins: [narrowZodFromJsonSchema()],
				build: {
					outDir,
					emptyOutDir: false,
					minify: false,
					lib: { entry, formats: ['es'], fileName: 'bundle' },
				},
			});
			const bundled = (await import(pathToFileURL(join(outDir, 'bundle.js')).href)) as {
				fromJSONSchema: typeof fromJSONSchema;
			};
			for (const [schema, inputs] of CASES) {
				expect(outcomes(bundled.fromJSONSchema, schema, inputs), JSON.stringify(schema)).toEqual(
					outcomes(fromJSONSchema, schema, inputs)
				);
			}
		} finally {
			await rm(outDir, { recursive: true, force: true });
		}
	}, 60_000);
});
