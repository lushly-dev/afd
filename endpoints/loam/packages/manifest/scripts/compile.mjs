/**
 * What `schema:build` generates, as pure functions, so the package's tests compile the same
 * validators and compare the committed files with a fresh generation.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

export const packageRoot = resolve(here, '..');
const repositoryRoot = resolve(packageRoot, '../../../..');

const CORE_PATH = resolve(repositoryRoot, 'spec/plugin-manifest.core.v1.json');
const VERSION_PATH = resolve(repositoryRoot, 'spec/VERSION');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const schemaPath = (name) => resolve(packageRoot, `schemas/${name}.json`);

/**
 * The Ajv options every schema in this package compiles under. `inlineRefs: false` shares a core
 * definition's function between the two paths a closing profile reaches it by, which is smaller.
 */
export const AJV_OPTIONS = { strict: true, allErrors: true, inlineRefs: false };

export const readCore = () => json(CORE_PATH);
export const readSchema = (name, version = 1) => json(schemaPath(`${name}.v${version}`));
export const readShapeSchema = () => json(schemaPath('json-schema-shape'));

function createAjv(options = {}) {
	const Ajv2020 = require('ajv/dist/2020').default;
	return new Ajv2020({ ...AJV_OPTIONS, ...options });
}

/**
 * An Ajv instance with the core and the schemas added. The manifest is version 2, the one
 * schema that reads both versions (phase 2 specification, 8.1); `app-manifest.v1.json` stays
 * committed and is added by the test that holds every valid version 1 case valid under 2.
 */
export function schemaAjv(options = {}) {
	const ajv = createAjv(options);
	ajv.addSchema(readCore());
	ajv.addSchema(readSchema('app-manifest', 2));
	for (const name of ['deployment', 'projection']) ajv.addSchema(readSchema(name));
	// Version 2 of the deployment file and the projection (phase 2 specification, 2.2 and 4.2).
	for (const name of ['deployment', 'projection']) ajv.addSchema(readSchema(name, 2));
	// Version 3, with the deployment's identity (phase 3 specification, 2.2).
	for (const name of ['deployment', 'projection']) ajv.addSchema(readSchema(name, 3));
	return ajv;
}

/** An Ajv instance with only `loam.server.toml`'s schema, which nothing in the page reads. */
export function serverAjv(options = {}) {
	const ajv = createAjv(options);
	ajv.addSchema(readSchema('server'));
	return ajv;
}

/**
 * Standalone output still `require`s Ajv's small runtime helpers; turn them into imports. Nothing
 * reads an error's `schemaPath`, and dropping it saves a tenth of what the page loads.
 */
function toModule(source) {
	const imports = [];
	const body = source
		.replace(/require\("(ajv\/dist\/runtime\/[a-z0-9]+)"\)/g, (_match, path) => {
			const name = `__ajvRuntime${imports.length}`;
			// CommonJS interop differs between bundlers and Node; accept either shape.
			imports.push(
				`import ${name}Module from ${JSON.stringify(`${path}.js`)};`,
				`const ${name} = { default: typeof ${name}Module === 'function' ? ${name}Module : ${name}Module.default };`
			);
			return name;
		})
		.replace(/schemaPath:"[^"]*",/g, '');
	if (/\brequire\(/.test(body)) throw new Error('Unexpected require() in the generated validators');
	return `${imports.join('\n')}\n${body.replace(/^"use strict";/, '')}`;
}

/**
 * The standalone validators as ESM source, by file name in dist/. A schema that does not compile
 * strictly, or a `$ref` that does not resolve against spec/, throws here and fails the build.
 *
 * Four files, because the package has `sideEffects: false`: a page that imports only `readManifest`
 * and `readProjection` carries neither the core's validator nor the deployment file's, and nothing but the hosted
 * server loads the server configuration's.
 */
export function compileValidators() {
	const code = { source: true, esm: true, lines: false };
	const standalone = require('ajv/dist/standalone').default;
	const core = readCore();
	const shape = createAjv({ strict: false, allErrors: false, messages: false, code });
	shape.addSchema(readShapeSchema());
	return {
		'validate.generated.js': toModule(
			standalone(schemaAjv({ code }), {
				validateManifest: readSchema('app-manifest', 2).$id,
				// Version 2's: `readProjection` reads a version 3 projection's `identity` by hand, as stage A
				// does, and the rest with this (phase 3 specification, 2.2 and 13). `dist` and its projection are
				// written together.
				validateProjection: readSchema('projection', 2).$id,
			})
		),
		'validate-host.generated.js': toModule(
			standalone(schemaAjv({ code }), {
				validateCoreManifest: `${core.$id}#/$defs/manifest`,
				validateDeployment: readSchema('deployment').$id,
				validateDeploymentV2: readSchema('deployment', 2).$id,
				validateDeploymentV3: readSchema('deployment', 3).$id,
			})
		),
		'validate-shape.generated.js': toModule(
			standalone(shape, { validateSchemaShape: readShapeSchema().$id })
		),
		// The hosted server's own file (phase 6 specification, 3.2): only `/server` loads it.
		'validate-server.generated.js': toModule(
			standalone(serverAjv({ code }), { validateServerConfig: readSchema('server').$id })
		),
	};
}

/** Follows a reference within the core or a schema document. */
function resolveRef(ref, document, core) {
	const [id, fragment = ''] = ref.split('#');
	// A version 2 projection's boot record holds a manifest's layout (phase 2 specification, 2.2).
	const manifest = readSchema('app-manifest', 2);
	const from =
		id === core.$id ? core : id === '' ? document : id === manifest.$id ? manifest : undefined;
	if (!from) throw new Error(`Unresolved $ref ${ref}`);
	const target = fragment
		.split('/')
		.slice(1)
		.reduce((at, part) => at?.[part], from);
	if (target === undefined) throw new Error(`Unresolved $ref ${ref}`);
	return { schema: target, document: from };
}

const SKIPPED = new Set([
	'$schema',
	'$id',
	'$defs',
	'$ref',
	'allOf',
	'if',
	'then',
	'else',
	'unevaluatedProperties',
]);

/** `a` narrowed by `b`: every keyword of both, nested schemas merged and refused values dropped. */
function narrow(a, b) {
	if (a === undefined || a === false || b === false) return a === undefined ? b : false;
	const merged = { ...a, ...b };
	if (a.properties && b.properties) {
		merged.properties = { ...a.properties };
		for (const [name, schema] of Object.entries(b.properties))
			merged.properties[name] = narrow(a.properties[name], schema);
	}
	if (a.items && b.items) merged.items = narrow(a.items, b.items);
	if (a.required && b.required) merged.required = [...new Set([...a.required, ...b.required])];
	if (merged.enum && b.not?.const !== undefined)
		merged.enum = merged.enum.filter((value) => value !== b.not.const);
	return merged;
}

/**
 * One self-contained schema: every `$ref` inlined and merged with its siblings, which is what
 * validation does and what json-schema-to-typescript's own resolver does not (it lets a sibling
 * `properties` replace the target's). `true` keeps the core's definition, and a key set to `false`
 * stays `false` so a later merge cannot bring it back; {@link withoutRefused} drops it.
 */
function flatten(node, document, core) {
	if (typeof node !== 'object' || node === null) return node;
	if (Array.isArray(node)) return node.map((item) => flatten(item, document, core));
	const target = node.$ref ? resolveRef(node.$ref, document, core) : undefined;
	const base = target ? flatten(target.schema, target.document, core) : {};
	const own = {};
	for (const [key, value] of Object.entries(node)) {
		if (SKIPPED.has(key) || key === 'propertyNames') continue;
		if (key === 'properties') {
			own.properties = Object.fromEntries(
				Object.entries(value).map(([name, schema]) => [
					name,
					schema === true ? {} : flatten(schema, document, core),
				])
			);
		} else if (key === 'items' || key === 'additionalProperties' || key === 'oneOf') {
			own[key] = flatten(value, document, core);
		} else own[key] = value;
	}
	return narrow(base, own);
}

function withoutRefused(node) {
	if (typeof node !== 'object' || node === null) return node;
	if (Array.isArray(node)) return node.map(withoutRefused);
	const out = {};
	for (const [key, value] of Object.entries(node)) {
		if (key === 'properties') {
			out.properties = Object.fromEntries(
				Object.entries(value)
					.filter(([, schema]) => schema !== false)
					.map(([name, schema]) => [name, withoutRefused(schema)])
			);
		} else if (key === 'items' || key === 'additionalProperties' || key === 'oneOf') {
			out[key] = withoutRefused(value);
		} else out[key] = value;
	}
	return out;
}

/** A flattened node with no named keys is data: it stays open. Everything else is closed. */
function closeForTypes(node) {
	if (typeof node !== 'object' || node === null) return node;
	if (Array.isArray(node)) return node.map(closeForTypes);
	const out = {};
	for (const [key, value] of Object.entries(node)) {
		if (key === 'description' || key === 'default' || key === 'not') continue;
		if (key === 'properties') {
			out.properties = Object.fromEntries(
				Object.entries(value).map(([name, schema]) => [name, closeForTypes(schema)])
			);
		} else if (key === 'items' || key === 'additionalProperties' || key === 'oneOf') {
			out[key] = closeForTypes(value);
		} else out[key] = value;
	}
	if (out.type === 'object' && out.additionalProperties === undefined)
		out.additionalProperties = out.properties === undefined;
	return out;
}

/** `src/_generated/types.ts`, from the flattened schemas. */
export async function generateTypes() {
	const { compile } = await import('json-schema-to-typescript');
	const core = readCore();
	const options = {
		bannerComment: '',
		additionalProperties: false,
		style: { useTabs: true, singleQuote: true, printWidth: 100 },
	};
	const parts = [];
	for (const [schema, version, name] of [
		['app-manifest', 1, 'ManifestV1'],
		['app-manifest', 2, 'ManifestV2'],
		['deployment', 1, 'DeploymentV1'],
		['projection', 1, 'ProjectionV1'],
		['deployment', 2, 'DeploymentV2'],
		['projection', 2, 'ProjectionV2'],
		['deployment', 3, 'DeploymentV3'],
		['projection', 3, 'ProjectionV3'],
		['server', 1, 'ServerConfigV1'],
	]) {
		const document = readSchema(schema, version);
		const { title: _title, ...flat } = closeForTypes(
			withoutRefused(flatten(document, document, core))
		);
		parts.push(await compile(flat, name, options));
	}
	// Eight schemas' types in one module, which grows with each version: generated, never edited.
	return `// Generated by scripts/schema-build.mjs from schemas/ and spec/. Do not edit.\n\n${parts.join('\n')}`;
}

/** The keys each object admits, by pointer with `*` for an index or a free name. */
function admittedKeys(node, pointer = '', found = {}) {
	if (typeof node !== 'object' || node === null) return found;
	if (node.properties) {
		found[pointer] = Object.keys(node.properties);
		for (const [name, schema] of Object.entries(node.properties))
			admittedKeys(schema, `${pointer}/${name}`, found);
	}
	const inner = node.items ?? node.additionalProperties;
	if (typeof inner === 'object') {
		found[pointer] ??= [];
		admittedKeys(inner, `${pointer}/*`, found);
	}
	return found;
}

/** `src/_generated/facts.ts`: the contract version, the name pattern and the admitted keys. */
export function generateFacts() {
	const core = readCore();
	const version = readFileSync(VERSION_PATH, 'utf8').trim();
	const admitted = {};
	for (const [schema, schemaVersion, name] of [
		['app-manifest', 2, 'manifest'],
		['deployment', 1, 'deployment'],
		// Version 3's keys are version 2's and `identity`'s, which `readDeployment` reports itself, so the
		// page's `apps` row carries no table of them (phase 3 specification, 13).
		['deployment', 2, 'deploymentV2'],
		// `readProjection` checks a version 3 projection's `identity` before the validator, so no error names
		// a key inside it: version 2's keys are the table.
		['projection', 2, 'projection'],
	]) {
		const document = readSchema(schema, schemaVersion);
		admitted[name] = admittedKeys(withoutRefused(flatten(document, document, core)));
	}
	return [
		'// Generated by scripts/schema-build.mjs from schemas/ and spec/. Do not edit.',
		'',
		'/** The AFD contract version this shell follows (spec/VERSION). */',
		`export const AFD_CONTRACT = ${JSON.stringify(version)};`,
		'',
		"/** The core's command name pattern. */",
		`export const COMMAND_NAME_PATTERN = ${JSON.stringify(core.$defs.commandName.pattern)};`,
		'',
		'/** The keys each object admits, by pointer with `*` for an index or a free name. */',
		`export const ADMITTED_KEYS: Record<string, Record<string, readonly string[]>> = ${JSON.stringify(admitted, null, '\t')};`,
		'',
	].join('\n');
}
