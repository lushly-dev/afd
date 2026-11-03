/**
 * The shared plugin manifest (spec/plugin-manifest.md): the core compiles, every case in
 * spec/plugin-manifest.json gets its answer from Ajv's 2020-12 build, and Umbel's and Loam's profiles
 * conform to the core. The rules beyond the schema run through a reference check here; Loam's reader,
 * `@lushly-dev/loam-manifest`, runs the same sections in its own test.
 *
 * Ajv is the Health dashboard's dependency, resolved from there, so the root manifest and the
 * whole-workspace scope it would select stay out of a spec change.
 */
import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireAjv = createRequire(join(root, 'endpoints/health-dashboard/package.json'));
const Ajv2020 = requireAjv('ajv/dist/2020').default;
const standalone = requireAjv('ajv/dist/standalone').default;

const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const core = json('spec/plugin-manifest.core.v1.json');
const spec = json('spec/plugin-manifest.json');

function ajvWith(options = {}) {
	const ajv = new Ajv2020({ strict: true, allErrors: true, ...options });
	ajv.addSchema(core);
	for (const schema of Object.values(spec.schemas)) ajv.addSchema(schema);
	return ajv;
}

const VALUE_LIMIT = 2 ** 53 - 1;

/** The absolute reference for a case's `against`. */
function reference(against) {
	const [name, fragment] = against.split('#');
	const id = name === 'core' ? core.$id : spec.schemas[name].$id;
	return fragment ? `${id}#${fragment}` : id;
}

/** The pointer of the key an Ajv error refuses. */
function refusedKey(error) {
	const { missingProperty, unevaluatedProperty, additionalProperty } = error.params;
	const key = missingProperty ?? unevaluatedProperty ?? additionalProperty;
	return key === undefined ? error.instancePath : `${error.instancePath}/${key}`;
}

/**
 * The errors a reader reports. Ajv reports a failed `then` or `else` a second time as `if`, at the
 * object that holds it; the failure itself names the key.
 */
function reported(errors) {
	return errors.filter((error) => error.keyword !== 'if');
}

test('the core is definitions only, with every object left open', () => {
	const ajv = ajvWith();
	assert.equal(ajv.validateSchema(core), true);
	assert.deepEqual(Object.keys(core).sort(), ['$defs', '$id', '$schema', 'description', 'title']);
	const closes = (node) =>
		Array.isArray(node)
			? node.some(closes)
			: typeof node === 'object' && node !== null
				? 'additionalProperties' in node ||
					'unevaluatedProperties' in node ||
					Object.values(node).some(closes)
				: false;
	assert.equal(closes(core.$defs), false);
});

test('every schema compiles under Ajv strict mode', () => {
	const ajv = ajvWith();
	for (const definition of Object.keys(core.$defs)) {
		assert.equal(typeof ajv.getSchema(`${core.$id}#/$defs/${definition}`), 'function', definition);
	}
	for (const [name, schema] of Object.entries(spec.schemas)) {
		assert.equal(typeof ajv.getSchema(schema.$id), 'function', name);
	}
});

for (const allErrors of [true, false]) {
	test(`every case answers as written, allErrors ${allErrors}`, () => {
		const ajv = ajvWith({ allErrors });
		for (const item of spec.cases) {
			const validate = ajv.getSchema(reference(item.against));
			assert.equal(
				validate(item.fragment),
				item.accepted,
				`${item.id}: ${ajv.errorsText(validate.errors)}`
			);
			if (item.accepted || !allErrors) continue;
			const keys = reported(validate.errors).map(refusedKey);
			const named = [item.pointer, ...(item.alsoNames ?? [])];
			assert.deepEqual([...new Set(keys)].sort(), named.sort(), item.id);
		}
	});
}

test('every refusal names its key and carries a suggestion', () => {
	const ids = new Set();
	const entries = [
		...spec.cases,
		...spec.rules,
		...spec.rules.flatMap((rule) =>
			(rule.warnings ?? []).map((warning) => ({ ...warning, id: rule.id, warning: true }))
		),
	];
	for (const item of entries) {
		if (!item.warning) {
			assert.ok(!ids.has(item.id), `repeated id ${item.id}`);
			ids.add(item.id);
		}
		if (item.accepted) continue;
		assert.equal(typeof item.suggestion, 'string', item.id);
		assert.ok(item.suggestion.length > 0, item.id);
		assert.equal(typeof item.pointer, 'string', item.id);
		assert.equal(typeof item.key, 'string', item.id);
		// A pointer ends in the same segments as the key an author reads.
		const last = item.pointer
			.split('/')
			.filter((part) => !/^\d+$/.test(part))
			.at(-1);
		if (last) assert.ok(item.key.includes(last.replaceAll('~1', '/')), `${item.id}: ${item.key}`);
	}
});

test('every closed object of the reference profile has a refusal, alone and at its depth', () => {
	const profile = spec.schemas.profile;
	const closedNames = Object.entries(profile.$defs)
		.filter(([, schema]) => schema.unevaluatedProperties === false)
		.map(([name]) => name);
	const coreObjects = Object.entries(core.$defs)
		.filter(([name, schema]) => schema.type === 'object' && name !== 'manifest')
		.map(([name]) => name);
	for (const name of coreObjects)
		assert.ok(closedNames.includes(name), `the profile leaves ${name} open`);
	for (const name of closedNames) {
		const alone = spec.cases.some(
			(item) =>
				item.against === `profile#/$defs/${name}` &&
				!item.accepted &&
				['/bogus', '/pallete'].includes(item.pointer)
		);
		assert.ok(alone, `no refusal for ${name}`);
	}
	const deep = spec.cases.filter((item) => item.id.startsWith('closed-deep-'));
	assert.equal(deep.length, closedNames.length);
	assert.ok(spec.cases.some((item) => item.id === 'closed-root'));
});

test('every required and refused key of the core has a case', () => {
	const refuses = (definition, pointer) =>
		spec.cases.some(
			(item) =>
				item.against === `core#/$defs/${definition}` && !item.accepted && item.pointer === pointer
		);
	for (const [definition, schema] of Object.entries(core.$defs)) {
		for (const key of schema.required ?? []) {
			assert.ok(refuses(definition, `/${key}`), `no case for ${definition} without ${key}`);
		}
		for (const [key, value] of Object.entries(schema.properties ?? {})) {
			if (value === false)
				assert.ok(refuses(definition, `/${key}`), `no case for ${definition}.${key}`);
		}
	}
});

test("the core's vocabularies and defaults are the page's", () => {
	const { command, effects, grant, mount, mountTool } = core.$defs;
	const approval = { enum: ['none', 'required'], default: 'none' };
	assert.deepEqual(effects.items.enum, [
		'inspect',
		'plugin-state',
		'external',
		'store-write',
		'workspace-write',
	]);
	assert.deepEqual(command.properties.approval.enum, approval.enum);
	assert.equal(command.properties.approval.default, approval.default);
	assert.deepEqual(mountTool.properties.approval.enum, approval.enum);
	assert.equal(mountTool.properties.approval.default, approval.default);
	assert.deepEqual(command.properties.execution_time.enum, [
		'instant',
		'fast',
		'slow',
		'long-running',
	]);
	assert.deepEqual(mount.properties.transport.enum, ['stdio', 'http']);
	assert.equal(grant.properties.required.default, true);
});

test('the case families the page cites exist', () => {
	const ids = new Set(spec.cases.map((item) => item.id));
	for (const id of [
		'cousin-refuses-a-valid-plugin',
		'cousin-suite-always-fails',
		'shallow-nested-stays-open',
		'shallow-plugin-stays-open',
		'overreach-reserved-key-still-refused',
		'overreach-core-value-still-refused',
		'profile-every-core-key',
	]) {
		assert.ok(ids.has(id), `missing ${id}`);
	}
});

test('every code in spec/error-codes.md fits the errors pattern', () => {
	const pattern = new RegExp(core.$defs.command.properties.errors.items.pattern, 'u');
	const vector = json('spec/vectors/error-codes.json').codes;
	assert.ok(vector.length > 0);
	const table = [
		...read('spec/error-codes.md').matchAll(/^\| Code \|.*\n\|[- |]+\n((?:\|.*\n)*)/gm),
	]
		.flatMap((match) => [...match[1].matchAll(/^\| `([^`]+)` \|/gm)])
		.map((match) => match[1]);
	assert.ok(table.length >= vector.length);
	// HTTP_<status> names a family of codes, such as HTTP_503.
	for (const code of [...vector, ...table]) assert.match(code.replace('<status>', '503'), pattern);
});

// ─── The rules beyond the schema ─────────────────────────────────────────────

const LABEL = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** The key rule (spec/mcp-resources.md, T2). */
function toolMetaAllowed(key, value) {
	if (key === 'ui') {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
		return (
			value.resourceUri === undefined ||
			(typeof value.resourceUri === 'string' && value.resourceUri.startsWith('ui://'))
		);
	}
	const [prefix = '', name, ...rest] = key.split('/');
	const labels = prefix.split('.');
	if (name === undefined || rest.length > 0 || labels.length < 2) return false;
	if (!labels.every((label) => LABEL.test(label)) || !NAME.test(name)) return false;
	const second = labels[1].toLowerCase();
	return (
		!key.toLowerCase().startsWith('dev.afd/') &&
		second !== 'modelcontextprotocol' &&
		second !== 'mcp'
	);
}

const CONTROL = /\p{Cc}/u;
const metaAjv = new Ajv2020({ strict: false, logger: false });
const isSchema = (schema) => Boolean(metaAjv.validateSchema(schema));

/** Pointers of every text value `text` applies to, with its value. */
function textValues(manifest) {
	const found = [];
	const add = (pointer, value) => {
		if (typeof value === 'string') found.push([pointer, value]);
	};
	const { plugin } = manifest;
	for (const key of ['title', 'description', 'homepage', 'license'])
		add(`/plugin/${key}`, plugin[key]);
	(manifest.grants ?? []).forEach((grant, index) => {
		add(`/grants/${index}/reason`, grant.reason);
	});
	(manifest.commands ?? []).forEach((command, index) => {
		for (const key of ['title', 'description', 'category', 'confirm_prompt']) {
			add(`/commands/${index}/${key}`, command[key]);
		}
		(command.examples ?? []).forEach((example, at) => {
			add(`/commands/${index}/examples/${at}/title`, example.title);
		});
	});
	(manifest.contexts ?? []).forEach((context, index) => {
		add(`/contexts/${index}/description`, context.description);
	});
	(manifest.pipelines ?? []).forEach((pipeline, index) => {
		add(`/pipelines/${index}/description`, pipeline.description);
	});
	(manifest.mount?.tools ?? []).forEach((tool, index) => {
		add(`/mount/tools/${index}/confirm_prompt`, tool.confirm_prompt);
	});
	return found;
}

/** The checks a schema's contents take, inline or from its file. */
function schemaProblem(kind, schema) {
	if (kind === 'returns') return false;
	if (schema.type !== 'object' || !isSchema(schema)) return true;
	return kind === 'config' && schema.additionalProperties !== false;
}

/** A reference check of the rules: the pointers it refuses and those it warns about. */
function checkRules(manifest, { pluginRoot, hostContract } = {}) {
	const refused = [];
	const warned = [];
	const domains = manifest.plugin.domains ?? [];
	const first = (name) => name.split('-')[0];
	const commands = manifest.commands ?? [];
	const pipelines = manifest.pipelines ?? [];
	const contexts = manifest.contexts ?? [];
	const skills = manifest.skills ?? [];
	const schemas = [];
	const schema = (kind, value, pointer) => {
		if (value === undefined) return;
		if (typeof value === 'string') schemas.push([kind, value, pointer]);
		else if (schemaProblem(kind, value)) refused.push(pointer);
	};
	const once = (seen, value, pointer) => {
		if (value !== undefined && seen.has(value)) refused.push(pointer);
		seen.add(value);
	};
	const mounted = manifest.plugin.kind === 'mounted';
	if (mounted && !manifest.mount) refused.push('/mount');
	if (!mounted && manifest.mount) refused.push('/mount');
	if (mounted && commands.length > 0) refused.push('/commands');
	if (manifest.mount && !domains.includes(manifest.mount.prefix)) refused.push('/mount/prefix');
	if (hostContract && manifest.afd_contract) {
		if (manifest.afd_contract.split('.')[0] !== hostContract.split('.')[0])
			refused.push('/afd_contract');
	}
	const callable = new Set();
	const named = (name, pointer) => {
		if (!domains.includes(first(name))) refused.push(pointer);
		once(callable, name, pointer);
	};
	const grants = new Set();
	(manifest.grants ?? []).forEach((grant, index) => {
		once(grants, grant.name, `/grants/${index}/name`);
	});
	if (!mounted)
		commands.forEach((command, index) => {
			named(command.name, `/commands/${index}/name`);
		});
	commands.forEach((command, index) => {
		schema('input', command.input_schema, `/commands/${index}/input_schema`);
		schema('returns', command.returns, `/commands/${index}/returns`);
		const budget = command.output_budget;
		if (budget && budget.default_bytes > budget.max_bytes) {
			refused.push(`/commands/${index}/output_budget/default_bytes`);
		}
		if (budget && budget.max_bytes > VALUE_LIMIT)
			refused.push(`/commands/${index}/output_budget/max_bytes`);
		for (const [key, value] of Object.entries(command.tool_meta ?? {})) {
			if (!toolMetaAllowed(key, value)) {
				refused.push(`/commands/${index}/tool_meta/${key.replaceAll('/', '~1')}`);
			}
		}
		(command.contexts ?? []).forEach((name, at) => {
			if (!contexts.some((context) => context.name === name)) {
				refused.push(`/commands/${index}/contexts/${at}`);
			}
		});
	});
	pipelines.forEach((pipeline, index) => {
		named(pipeline.name, `/pipelines/${index}/name`);
		schema('input', pipeline.input_schema, `/pipelines/${index}/input_schema`);
		const aliases = new Set();
		pipeline.steps.forEach((step, at) => {
			once(aliases, step.as, `/pipelines/${index}/steps/${at}/as`);
		});
	});
	const contextNames = new Set();
	contexts.forEach((context, index) => {
		const pointer = `/contexts/${index}/name`;
		if (!domains.includes(first(context.name))) refused.push(pointer);
		once(contextNames, context.name, pointer);
	});
	const skillNames = new Set();
	skills.forEach((skill, index) => {
		const fits =
			skill.name === manifest.plugin.id || skill.name.startsWith(`${manifest.plugin.id}-`);
		if (!fits) refused.push(`/skills/${index}/name`);
		once(skillNames, skill.name, `/skills/${index}/name`);
		if (skill.path.replace(/\/+$/, '').split('/').at(-1) !== skill.name) {
			refused.push(`/skills/${index}/path`);
		}
	});
	const tools = new Set();
	const toolNames = new Set();
	(manifest.mount?.tools ?? []).forEach((tool, index) => {
		once(tools, tool.tool, `/mount/tools/${index}/tool`);
		once(toolNames, tool.name, `/mount/tools/${index}/name`);
	});
	schema('config', manifest.config?.schema, '/config/schema');
	for (const [pointer, value] of textValues(manifest)) {
		if (CONTROL.test(value)) refused.push(pointer);
	}
	commands.forEach((command, index) => {
		(command.requires ?? []).forEach((name, at) => {
			if (!callable.has(name)) warned.push(`/commands/${index}/requires/${at}`);
		});
	});
	if (pluginRoot) {
		const real = realpathSync(pluginRoot);
		const resolveInside = (path, pointer) => {
			let resolved;
			try {
				resolved = realpathSync(join(pluginRoot, path));
			} catch {
				refused.push(pointer);
				return undefined;
			}
			const inside = relative(real, resolved);
			if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
				refused.push(pointer);
				return undefined;
			}
			return resolved;
		};
		for (const [kind, path, pointer] of schemas) {
			const resolved = resolveInside(path, pointer);
			if (!resolved) continue;
			let value;
			try {
				value = JSON.parse(readFileSync(resolved, 'utf8'));
			} catch {
				refused.push(pointer);
				continue;
			}
			if (typeof value !== 'object' || value === null || Array.isArray(value))
				refused.push(pointer);
			else if (schemaProblem(kind, value)) refused.push(pointer);
		}
		skills.forEach((skill, index) => {
			const pointer = `/skills/${index}/path`;
			const resolved = resolveInside(skill.path, pointer);
			if (resolved && !existsSync(join(resolved, 'SKILL.md'))) refused.push(pointer);
		});
	}
	return { refused, warned };
}

test('every rule case passes the core, then gets its answer from the reference check', (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'afd-plugin-manifest-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const validate = ajvWith().getSchema(`${core.$id}#/$defs/manifest`);
	spec.rules.forEach((rule, index) => {
		assert.equal(validate(rule.manifest), true, `${rule.id}: ${JSON.stringify(validate.errors)}`);
		const onDisk = rule.rule === 'path-inside-root' || rule.rule === 'files';
		let pluginRoot;
		if (onDisk) {
			pluginRoot = join(directory, String(index), 'plugin');
			mkdirSync(pluginRoot, { recursive: true });
			for (const [path, contents] of Object.entries(rule.files ?? {})) {
				mkdirSync(dirname(join(pluginRoot, path)), { recursive: true });
				writeFileSync(join(pluginRoot, path), contents);
			}
			for (const [path, target] of Object.entries(rule.symlinks ?? {})) {
				mkdirSync(dirname(join(pluginRoot, path)), { recursive: true });
				symlinkSync(target, join(pluginRoot, path));
			}
		}
		const { refused, warned } = checkRules(rule.manifest, {
			pluginRoot,
			hostContract: rule.hostContract,
		});
		assert.deepEqual(refused, rule.accepted ? [] : [rule.pointer], rule.id);
		assert.deepEqual(
			warned,
			(rule.warnings ?? []).map((warning) => warning.pointer),
			rule.id
		);
	});
	for (const name of [
		'command-domain',
		'mounted',
		'mount-prefix',
		'unique',
		'context-declared',
		'text',
		'input-schema',
		'config-schema',
		'output-budget',
		'skill-name',
		'tool-meta',
		'requires',
		'afd-contract',
		'path-inside-root',
		'files',
	]) {
		const answers = spec.rules.filter((rule) => rule.rule === name);
		assert.ok(
			answers.some((rule) => rule.accepted),
			`no accepted case for the rule ${name}`
		);
		if (name !== 'requires') {
			assert.ok(
				answers.some((rule) => !rule.accepted),
				`no refusal for the rule ${name}`
			);
		}
	}
});

test('mutation is true unless effects is exactly inspect', () => {
	for (const { effects, mutation } of spec.mutation) {
		assert.equal(!(effects.length === 1 && effects[0] === 'inspect'), mutation, effects.join());
	}
});

/** The renaming rule: the command name for a mounted tool, or undefined when it has none. */
function mountCommandName({ tool, name, manifestPrefix, prefix }) {
	const pattern = new RegExp(core.$defs.commandName.pattern, 'u');
	let command;
	if (name !== undefined) command = `${prefix}-${name}`;
	else {
		const normalized = tool
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.split('-')
			.map((segment) => (/^[0-9]/.test(segment) ? `n${segment}` : segment))
			.join('-');
		if (normalized === '') return undefined;
		command = normalized.startsWith(`${manifestPrefix}-`)
			? `${prefix}-${normalized.slice(manifestPrefix.length + 1)}`
			: `${prefix}-${normalized}`;
	}
	return pattern.test(command) ? command : undefined;
}

test('every renaming case gets its name from the reference rule', () => {
	for (const item of spec.renaming) {
		assert.equal(mountCommandName(item), item.unnameable ? undefined : item.command, item.id);
	}
});

test("the reference key rule agrees with spec/mcp-resources.json's cases", () => {
	for (const { key, value, allowed } of json('spec/mcp-resources.json').toolMetaKeys) {
		assert.equal(toolMetaAllowed(key, value), allowed, key);
	}
});

test('a standalone validator of a closing profile behaves the same (no new Function at run time)', () => {
	const ajv = ajvWith({ code: { source: true } });
	const module = { exports: {} };
	new Function(
		'module',
		'exports',
		'require',
		standalone(ajv, ajv.getSchema(spec.schemas.profile.$id))
	)(module, module.exports, requireAjv);
	for (const item of spec.cases.filter((candidate) => candidate.against === 'profile')) {
		assert.equal(module.exports(item.fragment), item.accepted, item.id);
	}
});

// ─── Umbel's profile conforms to the core ────────────────────────────────────

const UMBEL = 'endpoints/umbel';

/** Every path under `directory` (relative to Umbel) whose name passes `wanted`. */
function find(directory, wanted, found = []) {
	for (const entry of readdirSync(join(root, UMBEL, directory), { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory() && entry.name !== 'target') find(path, wanted, found);
		else if (entry.isFile() && wanted(path)) found.push(path);
	}
	return found;
}

/** Umbel's manifests and scaffolds, each read as JSON. */
function umbelManifests() {
	const examples = find('schemas/examples', (path) => /\/plugin-manifest[^/]*\.json$/.test(path));
	const toml = [
		...find('plugins', (path) => /\/(umbel-plugin|manifests\/[^/]+)\.toml$/.test(path)),
		'tests/fixtures/plugins/todo-http/umbel-plugin.toml',
	];
	const templates = find('src/templates', (path) => path.endsWith('/manifest.toml.tmpl'));
	const fill = (text) => text.replaceAll('{{id}}', 'sample').replaceAll('{{title}}', 'Sample');
	return {
		examples: examples.map((path) => [path, json(join(UMBEL, path))]),
		toml: toml.map((path) => [path, parseToml(read(join(UMBEL, path)))]),
		templates: templates.map((path) => [path, parseToml(fill(read(join(UMBEL, path))))]),
	};
}

test("Umbel's manifests validate against the core's manifest definition", () => {
	const { examples, toml, templates } = umbelManifests();
	assert.ok(examples.length >= 7, `${examples.length} examples`);
	assert.ok(toml.length >= 7, `${toml.length} TOML manifests`);
	assert.ok(templates.length >= 4, `${templates.length} scaffolds`);
	const validate = ajvWith().getSchema(`${core.$id}#/$defs/manifest`);
	const versions = new Set();
	for (const [path, manifest] of [...examples, ...toml, ...templates]) {
		assert.equal(validate(manifest), true, `${path}: ${JSON.stringify(validate.errors)}`);
		versions.add(manifest.manifest_version);
	}
	assert.ok(versions.has(1) && versions.has(2), [...versions].join(', '));
});

/** Follows `$ref`s inside one schema document. */
function deref(document, schema) {
	let node = schema;
	while (node?.$ref?.startsWith('#/')) {
		node = node.$ref
			.slice(2)
			.split('/')
			.reduce((at, part) => at[part], document);
	}
	return node;
}

/**
 * Where a profile's definition admits a value the core's refuses. A node that holds a `$ref` to the
 * core, and everything under it, also answers to that definition, so what it leaves out it inherits;
 * what it states must still be no wider.
 */
function widenings(profile, profileNode, coreNode, path, found = [], closing = false) {
	let narrow = deref(profile, profileNode);
	const wide = deref(core, coreNode);
	if (narrow === false) return found;
	if (wide === false) {
		found.push(`${path}: the core refuses this key`);
		return found;
	}
	if (wide === true || wide === undefined || narrow === undefined || narrow === true) return found;
	const inherits = closing || narrow.$ref?.startsWith(`${core.$id}#`);
	if (inherits) {
		narrow = {
			...wide,
			...narrow,
			required: [...(wide.required ?? []), ...(narrow.required ?? [])],
		};
	}
	if (wide.type && narrow.type !== wide.type && !(narrow.const !== undefined || narrow.enum)) {
		found.push(`${path}: type ${narrow.type}, the core's ${wide.type}`);
	}
	for (const keyword of ['pattern', 'uniqueItems']) {
		if (wide[keyword] !== undefined && narrow[keyword] !== wide[keyword]) {
			// A closed vocabulary already narrows a pattern; it is checked below.
			if (keyword !== 'pattern' || narrow.enum === undefined)
				found.push(`${path}: ${keyword} differs`);
		}
	}
	for (const keyword of ['minLength', 'minItems', 'minimum']) {
		if (
			wide[keyword] > (narrow[keyword] ?? -Infinity) &&
			narrow.const === undefined &&
			!narrow.enum
		) {
			found.push(`${path}: ${keyword} below the core's`);
		}
	}
	if (wide.maxLength < (narrow.maxLength ?? Infinity) && !narrow.enum)
		found.push(`${path}: maxLength above the core's`);
	const values = narrow.enum ?? (narrow.const !== undefined ? [narrow.const] : undefined);
	if (values) {
		if (wide.enum)
			for (const value of values)
				if (!wide.enum.includes(value))
					found.push(`${path}: ${value} is outside the core's values`);
		if (wide.pattern)
			for (const value of values)
				if (!new RegExp(wide.pattern, 'u').test(value))
					found.push(`${path}: ${value} misses the core's pattern`);
	} else if (wide.enum && !narrow.enum) {
		found.push(`${path}: the core closes this vocabulary`);
	}
	for (const key of wide.required ?? []) {
		if (!(narrow.required ?? []).includes(key)) found.push(`${path}: ${key} is not required`);
	}
	if (wide.not && !narrow.not) found.push(`${path}: the core's not is missing`);
	for (const [key, schema] of Object.entries(wide.properties ?? {})) {
		const own = narrow.properties?.[key];
		if (own !== undefined) widenings(profile, own, schema, `${path}.${key}`, found, inherits);
	}
	if (wide.items && narrow.items && narrow.items !== wide.items)
		widenings(profile, narrow.items, wide.items, `${path}[]`, found, inherits);
	return found;
}

const umbelVersions = find('schemas', (path) =>
	/^schemas\/plugin-manifest\.v\d+\.json$/.test(path)
);

// Where each core definition sits in Umbel's schema, which inlines some of them.
const UMBEL_DEFINITION = {
	manifest: '#',
	expose: '#/$defs/command/properties/expose',
	example: '#/$defs/command/properties/examples/items',
	outputBudget: '#/$defs/command/properties/output_budget',
	pipelineStep: '#/$defs/pipeline/properties/steps/items',
};
// Umbel's schema leaves this to its reader, which requires one of plugin.domains, and its domain
// definition refuses afd (spec/plugin-manifest.md, "Umbel's profile").
const READER_ONLY = "manifest.mount.prefix: the core's not is missing";

for (const path of umbelVersions) {
	const profile = json(join(UMBEL, path));

	test(`${path} adds only the keys its profile owns`, () => {
		const added = (definition) =>
			Object.keys(profile.$defs[definition].properties).filter(
				(key) => !(key in core.$defs[definition].properties)
			);
		const top = Object.keys(profile.properties).filter(
			(key) => !(key in core.$defs.manifest.properties)
		);
		assert.deepEqual(top.sort(), ['component', 'packs']);
		assert.deepEqual(added('mount').sort(), ['bearer', 'command', 'cwd', 'env']);
		assert.deepEqual(added('mountTool'), ['bind_space']);
		for (const definition of ['plugin', 'grant', 'context', 'pipeline', 'skill', 'config']) {
			assert.deepEqual(added(definition), [], definition);
		}
		assert.deepEqual(
			added('command').filter((key) => key !== 'confirm'),
			[]
		);
		const { expose } = profile.$defs.command.properties;
		assert.deepEqual(Object.keys(expose.properties).sort(), ['agent', 'cli', 'mcp', 'palette']);
	});

	test(`${path} closes every object it defines`, () => {
		const walk = (node, at) => {
			if (typeof node !== 'object' || node === null) return;
			if (node.properties && at !== '') assert.equal(node.additionalProperties, false, at);
			for (const [key, value] of Object.entries(node)) {
				if (key !== 'if' && key !== 'then' && key !== 'else' && key !== 'allOf')
					walk(value, `${at}/${key}`);
			}
		};
		assert.equal(profile.additionalProperties, false);
		walk(profile.$defs, '/$defs');
	});

	test(`${path} admits nothing the core refuses`, () => {
		const found = widenings(profile, profile, core.$defs.manifest, 'manifest');
		assert.deepEqual(
			found.filter((item) => item !== READER_ONLY),
			[]
		);
	});

	test(`${path} refuses every core refusal, naming the same key`, () => {
		const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
		ajv.addSchema(profile);
		const missed = [];
		for (const item of spec.cases) {
			const definition = item.against.match(/^core#\/\$defs\/(.+)$/)?.[1];
			if (item.accepted || !definition || item.id === 'mount-prefix-afd') continue;
			const pointer = UMBEL_DEFINITION[definition] ?? `#/$defs/${definition}`;
			const place = pointer
				.slice(1)
				.split('/')
				.slice(1)
				.reduce((at, part) => at?.[part], profile);
			if (place === undefined) continue;
			const validate = ajv.compile({ $ref: `${profile.$id}${pointer}` });
			validate(item.fragment);
			const keys = (validate.errors ?? []).map(refusedKey);
			// Umbel refuses a key it does not define as a whole, so the core's deeper pointer is inside it.
			const named = keys.some((key) => key === item.pointer || item.pointer.startsWith(`${key}/`));
			if (!named) missed.push(`${item.id}: ${keys.join(', ') || 'accepted'}`);
		}
		assert.deepEqual(missed, []);
	});
}

test('the comparison notices a profile that widens the core', () => {
	const widened = json(`${UMBEL}/schemas/plugin-manifest.v2.json`);
	widened.$defs.plugin.properties.title.maxLength = 81;
	widened.$defs.grant.properties.allow = { type: 'array' };
	widened.$defs.command.properties.approval.enum.push('maybe');
	assert.deepEqual(widenings(widened, widened, core.$defs.manifest, 'manifest').sort(), [
		"manifest.commands[].approval: maybe is outside the core's values",
		'manifest.grants[].allow: the core refuses this key',
		READER_ONLY,
		"manifest.plugin.title: maxLength above the core's",
	]);
});

// ─── Loam's profile conforms to the core ─────────────────────────────────────

// Version 2 is the profile the reader validates with (phase 2 specification, 8.1); version 1 stays
// committed beside it, and the package's own test holds every valid version 1 document valid here.
const loamProfile = json('endpoints/loam/packages/manifest/schemas/app-manifest.v2.json');
// Where a core definition has a closing definition of the same name in Loam's profile.
const LOAM_CLOSES = [
	'plugin',
	'command',
	'expose',
	'example',
	'grant',
	'context',
	'skill',
	'config',
	'mount',
	'mountTool',
];

test("P2-E11: Loam's profile adds only the keys its profile owns", () => {
	const top = Object.keys(loamProfile.properties).filter(
		(key) => !(key in core.$defs.manifest.properties)
	);
	assert.deepEqual(top.sort(), ['app', 'native', 'view']);
	for (const definition of LOAM_CLOSES) {
		const added = Object.keys(loamProfile.$defs[definition].properties ?? {}).filter(
			(key) => !(key in core.$defs[definition].properties)
		);
		assert.deepEqual(added, [], definition);
	}
});

test("P2-E11: Loam's profile closes every object it admits, by P1's shape", () => {
	const walk = (node, at) => {
		if (typeof node !== 'object' || node === null) return;
		if (node.properties) {
			assert.equal(node.unevaluatedProperties, false, `${at} is not closed`);
			assert.equal(node.type, 'object', `${at} has no type`);
		}
		for (const keyword of ['if', 'then', 'else', 'dependentSchemas'])
			assert.equal(node[keyword], undefined, `${at} holds ${keyword} beside its closing`);
		for (const [key, value] of Object.entries(node)) {
			// A conditional's branches only narrow; the object they sit in closes it.
			if (key !== 'allOf') walk(value, `${at}/${key}`);
		}
	};
	const { $defs, ...root } = loamProfile;
	walk(root, '');
	for (const [name, definition] of Object.entries($defs)) walk(definition, `/$defs/${name}`);
	assert.equal(loamProfile.$ref, `${core.$id}#/$defs/manifest`);
	for (const definition of LOAM_CLOSES) {
		assert.equal(loamProfile.$defs[definition].$ref, `${core.$id}#/$defs/${definition}`);
		assert.equal(loamProfile.$defs[definition].unevaluatedProperties, false);
	}
	// Every core object the profile admits is closed, or refused with false.
	assert.equal(loamProfile.properties.pipelines, false);
	assert.equal(loamProfile.$defs.command.properties.output_budget, false);
});

test("P2-E11: Loam's profile compiles under Ajv strict mode", () => {
	const ajv = new Ajv2020({ strict: true, allErrors: true });
	ajv.addSchema(core);
	assert.equal(typeof ajv.compile(loamProfile), 'function');
});

test("P2-E11: Loam's profile admits nothing the core refuses", () => {
	assert.deepEqual(widenings(loamProfile, loamProfile, core.$defs.manifest, 'manifest'), []);
});

test("P2-E11: Loam's profile refuses every core refusal, naming the same key", () => {
	const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
	ajv.addSchema(core);
	ajv.addSchema(loamProfile);
	const missed = [];
	for (const item of spec.cases) {
		const definition = item.against.match(/^core#\/\$defs\/(.+)$/)?.[1];
		if (item.accepted || !definition) continue;
		const closed = definition === 'manifest' || LOAM_CLOSES.includes(definition);
		if (!closed) continue;
		const pointer = definition === 'manifest' ? '#' : `#/$defs/${definition}`;
		const validate = ajv.compile({ $ref: `${loamProfile.$id}${pointer}` });
		validate(item.fragment);
		const keys = (validate.errors ?? []).map(refusedKey);
		// A key Loam refuses as a whole holds the core's deeper pointer inside it.
		const named = keys.some((key) => key === item.pointer || item.pointer.startsWith(`${key}/`));
		if (!named) missed.push(`${item.id}: ${keys.join(', ') || 'accepted'}`);
	}
	assert.deepEqual(missed, []);
});

test('P2-E11: the comparison notices a profile that widens the core, closing by $ref', () => {
	const widened = structuredClone(loamProfile);
	widened.$defs.plugin.properties.title = { type: 'string', maxLength: 81 };
	widened.$defs.grant.properties = { allow: { type: 'array' } };
	widened.$defs.command.properties.approval.enum.push('maybe');
	assert.deepEqual(widenings(widened, widened, core.$defs.manifest, 'manifest').sort(), [
		"manifest.commands[].approval: maybe is outside the core's values",
		'manifest.grants[].allow: the core refuses this key',
		"manifest.plugin.title: maxLength above the core's",
	]);
});
