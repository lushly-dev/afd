/**
 * Vite plugin: compile Health's published report schema into a standalone validator.
 *
 * The schema is read from endpoints/health (the contract's single source) at build and
 * test time; no copy lives in this package. Ajv generates the validator ahead of time,
 * so the shipped page needs no `eval` and can keep a strict Content Security Policy.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/** The versioned contract this dashboard supports. */
export const REPORT_SCHEMA_PATH = resolve(
	here,
	'../../health/src/botcore_health/schemas/report-1.0.json'
);
export const MODULE_ID = 'virtual:health-report-schema';
const RESOLVED_ID = `\0${MODULE_ID}`;

interface ReportSchema {
	$id: string;
	properties: { schema_version: { const: string } };
}

/** Returns ESM source that exports `validateReport`, `schemaId` and `schemaVersion`. */
export function compileReportValidator(schemaPath = REPORT_SCHEMA_PATH): string {
	const Ajv2020 = require('ajv/dist/2020').default;
	const standalone = require('ajv/dist/standalone').default;
	const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as ReportSchema;
	const version = schema.properties.schema_version.const;
	if (typeof schema.$id !== 'string' || typeof version !== 'string')
		throw new Error('The Health report schema must declare $id and a schema_version const');
	const ajv = new Ajv2020({ strict: true, allErrors: true, code: { source: true, esm: true } });
	ajv.addSchema(schema);
	let source: string = standalone(ajv, { validateReport: schema.$id });
	// Standalone output still `require`s Ajv's small runtime helpers; turn them into imports.
	const imports: string[] = [];
	source = source.replace(/require\("(ajv\/dist\/runtime\/[a-z0-9]+)"\)/g, (_match, path) => {
		const name = `__ajvRuntime${imports.length}`;
		// CommonJS interop differs between bundlers and Node; accept either shape.
		imports.push(
			`import ${name}Module from ${JSON.stringify(path)};`,
			`const ${name} = { default: typeof ${name}Module === 'function' ? ${name}Module : ${name}Module.default };`
		);
		return name;
	});
	if (/\brequire\(/.test(source))
		throw new Error('Unexpected require() in the generated validator');
	return [
		...imports,
		source.replace(/^"use strict";/, ''),
		`export const schemaId = ${JSON.stringify(schema.$id)};`,
		`export const schemaVersion = ${JSON.stringify(version)};`,
	].join('\n');
}

export function reportValidator(): Plugin {
	return {
		name: 'health-report-validator',
		resolveId(id) {
			return id === MODULE_ID ? RESOLVED_ID : undefined;
		},
		load(id) {
			if (id !== RESOLVED_ID) return undefined;
			this.addWatchFile(REPORT_SCHEMA_PATH);
			return compileReportValidator();
		},
	};
}
