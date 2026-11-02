/**
 * `spec/plugin-manifest.json` through this package's code (phase 1 specification, 2.4): the same
 * Ajv options `schema:build` uses, `readCoreManifest`, `deriveMutation` and `mountCommandName`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { AJV_OPTIONS, readCore } from '../scripts/compile.mjs';
import { deriveMutation, mountCommandName } from './naming.js';
import { keyOf } from './pointers.js';
import { readCoreManifest } from './read-core-manifest.js';
import { pointerOf, reportedErrors, type ValidatorError } from './validator-errors.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;

interface RuleCase {
	id: string;
	rule: string;
	manifest: unknown;
	accepted: boolean;
	pointer?: string;
	suggestion?: string;
	warnings?: { pointer: string }[];
}

const spec = JSON.parse(
	readFileSync(new URL('../../../../../spec/plugin-manifest.json', import.meta.url), 'utf8')
) as {
	schemas: Record<string, { $id: string }>;
	cases: {
		id: string;
		against: string;
		fragment: unknown;
		accepted: boolean;
		pointer?: string;
		alsoNames?: string[];
	}[];
	rules: RuleCase[];
	mutation: { effects: string[]; mutation: boolean }[];
	renaming: {
		id: string;
		tool: string;
		name?: string;
		manifestPrefix: string;
		prefix: string;
		command?: string;
		unnameable?: boolean;
	}[];
};

const core = readCore();

/** The rule table of the phase 1 specification, 2.4. */
const RULE_CODES: Readonly<Record<string, string>> = {
	'command-domain': 'MANIFEST_NAME_DOMAIN',
	mounted: 'MANIFEST_SECTION_KIND',
	'mount-prefix': 'MANIFEST_MOUNT_PREFIX',
	unique: 'MANIFEST_DUPLICATE',
	'context-declared': 'MANIFEST_CONTEXT_UNDECLARED',
	text: 'MANIFEST_TEXT_INVALID',
	'input-schema': 'MANIFEST_INPUT_SCHEMA_INVALID',
	'config-schema': 'MANIFEST_CONFIG_SCHEMA_INVALID',
	'output-budget': 'MANIFEST_BUDGET_INVALID',
	'skill-name': 'MANIFEST_SKILL_NAME',
	'tool-meta': 'MANIFEST_TOOL_META_INVALID',
	requires: 'MANIFEST_REQUIRES_UNKNOWN',
	'afd-contract': 'MANIFEST_AFD_CONTRACT',
};

function specAjv() {
	const ajv = new Ajv2020(AJV_OPTIONS);
	ajv.addSchema(core);
	for (const schema of Object.values(spec.schemas)) ajv.addSchema(schema);
	return ajv;
}

function reference(against: string): string {
	const [name, fragment] = against.split('#') as [string, string | undefined];
	const id = name === 'core' ? core.$id : (spec.schemas[name] as { $id: string }).$id;
	return fragment ? `${id}#${fragment}` : id;
}

describe('spec/plugin-manifest.json', () => {
	it('compiles every schema under the options schema:build uses', () => {
		const ajv = specAjv();
		for (const [name, schema] of Object.entries(spec.schemas)) {
			expect(typeof ajv.getSchema(schema.$id), name).toBe('function');
		}
	});

	const ajv = specAjv();
	for (const item of spec.cases) {
		it(`case ${item.id}`, () => {
			const validate = ajv.getSchema(reference(item.against));
			expect(validate(item.fragment)).toBe(item.accepted);
			if (item.accepted) return;
			// A whole-key refusal hides the core's second report of its contents, as the reader does.
			const keys = [...reportedErrors(validate.errors as ValidatorError[]).keys()];
			const named = [item.pointer as string, ...(item.alsoNames ?? [])];
			expect(keys.sort()).toEqual(named.sort());
		});
	}

	const onDisk = new Set(['path-inside-root', 'files']);
	for (const rule of spec.rules.filter((candidate) => !onDisk.has(candidate.rule))) {
		it(`rule ${rule.rule}: ${rule.id}`, () => {
			const read = readCoreManifest(rule.manifest);
			const warned = read.warnings.map((warning) => warning.key);
			expect(warned).toEqual((rule.warnings ?? []).map((warning) => keyOf(warning.pointer)));
			for (const warning of read.warnings) expect(warning.code).toBe(RULE_CODES[rule.rule]);
			if (rule.accepted) {
				expect(read.ok ? [] : read.refusals).toEqual([]);
				return;
			}
			expect(read.ok).toBe(false);
			if (read.ok) return;
			expect(read.refusals.map((refusal) => refusal.key)).toEqual([keyOf(rule.pointer as string)]);
			expect(read.refusals[0]?.code).toBe(RULE_CODES[rule.rule]);
			expect(read.refusals[0]?.suggestion).not.toBe('');
		});
	}

	for (const item of spec.cases.filter(
		(candidate) => candidate.against === 'core#/$defs/manifest'
	)) {
		// An accepted fragment passes the schema; the rules may still have something to say of it.
		if (item.accepted) continue;
		it(`readCoreManifest refuses ${item.id}`, () => {
			const read = readCoreManifest(item.fragment);
			expect(read.ok).toBe(false);
			if (read.ok) return;
			const named = [item.pointer as string, ...(item.alsoNames ?? [])].map(keyOf);
			expect(read.refusals.map((refusal) => refusal.key).sort()).toEqual(named.sort());
		});
	}

	for (const { effects, mutation } of spec.mutation) {
		it(`mutation of [${effects.join()}]`, () => {
			expect(deriveMutation(effects)).toBe(mutation);
		});
	}

	for (const item of spec.renaming) {
		it(`renaming ${item.id}`, () => {
			const name = mountCommandName(item.manifestPrefix, item.prefix, item.tool, item.name);
			expect(name).toEqual(item.unnameable ? { unnameable: item.tool } : item.command);
		});
	}

	it('names the pointer of an error by its key', () => {
		const error = {
			keyword: 'required',
			instancePath: '/plugin',
			params: { missingProperty: 'a/b' },
		};
		expect(pointerOf(error)).toBe('/plugin/a~1b');
		expect(keyOf('/plugin/a~1b')).toBe('plugin["a/b"]');
		expect(keyOf('')).toBe('(root)');
	});
});
