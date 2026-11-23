#!/usr/bin/env node
/**
 * Static package boundaries, not installation or standalone-consumer evidence.
 * Checks repository-owned runtime and build-time dependency closure, TS literal
 * imports/type references, Python static imports, public subpaths, config paths,
 * script references, family sub-layers, and example isolation.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// TypeScript 7's `typescript` package exports no compiler API; the parser comes from TypeScript 6.
import ts from '@typescript/typescript6';
import { parse as parseToml } from 'smol-toml';
import { checkKernelDomains } from './check-kernel-domains.mjs';
import {
	cargoDevRequirements,
	cargoRequirements,
	npmDevRequirements,
	npmRequirements,
	pythonDevRequirements,
	pythonRequirements,
	registryName,
} from './release/manifest-requirements.mjs';

const skip = new Set([
	'node_modules',
	'dist',
	'build',
	'target',
	'.git',
	'.venv',
	'__pycache__',
	'.specimen',
	'coverage',
	'temp',
	'test-results',
	'playwright-report',
]);
const manifests = new Set(['package.json', 'pyproject.toml', 'Cargo.toml', 'CMakeLists.txt']);
const slash = (path) => path.replaceAll('\\', '/');
const within = (path, root) => path === root || path.startsWith(`${root}/`);
const read = (path) => readFileSync(path, 'utf8');
const packageName = (name) =>
	name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];

function walk(root, directory, excluded = []) {
	if (!existsSync(join(root, directory))) return [];
	return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
		const path = slash(join(directory, entry.name));
		if (skip.has(entry.name) || excluded.some((item) => within(path, item))) return [];
		return entry.isDirectory() ? walk(root, path, excluded) : [path];
	});
}

function classification(path, config) {
	const explicit = config.units.find((unit) => unit.manifest === path);
	if (explicit) return explicit;
	const parts = path.split('/');
	if (parts[0] === 'packages' && parts[1] === 'examples')
		return { manifest: path, family: 'examples', layer: 'example' };
	if (parts[0] === 'foundations' && config.families.includes(parts[1]))
		return { manifest: path, family: parts[1], layer: 'foundation' };
	if (['integrations', 'endpoints'].includes(parts[0]) && parts.length >= 3)
		return {
			manifest: path,
			family: parts[1],
			layer: parts[0] === 'integrations' ? 'integration' : 'endpoint',
		};
	return null;
}

function assignSublayer(unit, familyRules) {
	const rule = familyRules?.[unit.family];
	if (!rule) return undefined;
	if (unit.sublayer) return unit.sublayer;
	for (const entry of rule.assign ?? []) {
		if (entry.match && unit.name === entry.match) return entry.sublayer;
		if (entry.prefix && unit.name.startsWith(entry.prefix)) return entry.sublayer;
		if (entry.pathPrefix && within(unit.directory, entry.pathPrefix.replace(/\/$/, '')))
			return entry.sublayer;
	}
	return null;
}

function loadUnit(root, entry) {
	const text = read(join(root, entry.manifest));
	const file = entry.manifest.split('/').at(-1);
	const format =
		file === 'package.json'
			? 'npm'
			: file === 'pyproject.toml'
				? 'python'
				: file === 'Cargo.toml'
					? 'rust'
					: 'cpp';
	const manifest = format === 'npm' ? JSON.parse(text) : format === 'cpp' ? {} : parseToml(text);
	const name =
		entry.name ??
		(format === 'npm'
			? manifest.name
			: format === 'python'
				? manifest.project?.name
				: (manifest.package?.name ?? text.match(/\bproject\s*\(\s*([A-Za-z0-9_.-]+)/i)?.[1]));
	if (!name) throw new Error(`Missing package identity: ${entry.manifest}`);
	const registry = { npm: 'npm', python: 'pypi', rust: 'crates', cpp: 'source' }[format];
	let requirements = [];
	let devRequirements = [];
	if (format === 'npm') {
		const peers = Object.fromEntries(
			Object.entries(manifest.peerDependencies ?? {}).filter(
				([key]) => !manifest.peerDependenciesMeta?.[key]?.optional
			)
		);
		requirements = npmRequirements({ ...manifest, peerDependencies: peers });
		devRequirements = npmDevRequirements(manifest);
	} else if (format === 'python') {
		const optional = Object.fromEntries(
			Object.entries(manifest.project?.['optional-dependencies'] ?? {}).filter(
				([key]) => !['dev', 'test', 'tests'].includes(key)
			)
		);
		requirements = [
			...pythonRequirements({ ...manifest.project, 'optional-dependencies': optional }),
			...pythonRequirements({ dependencies: manifest['build-system']?.requires ?? [] }),
		];
		devRequirements = pythonDevRequirements(manifest);
	} else if (format === 'rust') {
		requirements = cargoRequirements(manifest);
		devRequirements = cargoDevRequirements(manifest);
	}
	return {
		...entry,
		manifestPath: entry.manifest,
		directory: slash(dirname(entry.manifest)),
		format,
		registry,
		name,
		data: manifest,
		text,
		requirements,
		devRequirements,
	};
}

function exportEntries(value, key = '.', conditions = []) {
	if (typeof value === 'string') return [{ export: key, conditions, target: value }];
	if (Array.isArray(value))
		return value.flatMap((item, index) =>
			exportEntries(item, key, [...conditions, `fallback:${index}`])
		);
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value).flatMap(([name, item]) =>
		name.startsWith('.')
			? exportEntries(item, name, conditions)
			: exportEntries(item, key, [...conditions, name])
	);
}

function nativeSurfaces(unit) {
	const names = new Set(unit.publicSurfaces ?? ['UNMAPPED-native-public-surfaces']);
	if (unit.format === 'python') {
		for (const [key, target] of Object.entries(unit.data.project?.scripts ?? {}))
			names.add(`script:${key}=${target}`);
		for (const [group, entries] of Object.entries(unit.data.project?.['entry-points'] ?? {}))
			for (const [key, target] of Object.entries(entries))
				names.add(`entry-point:${group}:${key}=${target}`);
		for (const key of Object.keys(unit.data.project?.['optional-dependencies'] ?? {}))
			names.add(`extra:${key}`);
	}
	if (unit.format === 'rust')
		for (const key of Object.keys(unit.data.features ?? {})) names.add(`feature:${key}`);
	return [...names];
}

export function coverageMap(units) {
	return units.map((unit) => ({
		manifest: unit.manifestPath,
		name: unit.name,
		family: unit.family,
		layer: unit.layer,
		surfaces:
			unit.format === 'npm'
				? [
						...exportEntries(unit.data.exports ?? { '.': unit.data.main ?? './index.js' }),
						...Object.entries(
							typeof unit.data.bin === 'string'
								? { [unit.name]: unit.data.bin }
								: (unit.data.bin ?? {})
						).map(([name, target]) => ({ export: `bin:${name}`, conditions: [], target })),
					]
				: nativeSurfaces(unit).map((name) => ({
						export: name,
						conditions: [],
						target: unit.manifestPath,
					})),
		evidence: 'pending; static boundary check is not consumer execution',
	}));
}

function imports(text, file) {
	const result = [];
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		)
			result.push(node.moduleSpecifier.text);
		if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteralLike(node.argument.literal)
		)
			result.push(node.argument.literal.text);
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		)
			result.push(node.arguments[0].text);
		ts.forEachChild(node, visit);
	}
	visit(source);
	for (const ref of source.typeReferenceDirectives) result.push(ref.fileName);
	for (const ref of source.referencedFiles)
		result.push(ref.fileName.startsWith('.') ? ref.fileName : `./${ref.fileName}`);
	return result;
}

function publicImport(target, specifier) {
	// A bundler query (Vite's `?inline`, `?raw`, `?url`) names how to load the file, not another one.
	const bare = specifier.replace(/\?.*$/, '');
	const subpath = bare === target.name ? '.' : `.${bare.slice(target.name.length)}`;
	if (!target.data.exports) return subpath === '.';
	return exportEntries(target.data.exports).some((entry) => {
		if (!entry.export.includes('*')) return entry.export === subpath;
		const [prefix, suffix] = entry.export.split('*');
		return subpath.startsWith(prefix) && subpath.endsWith(suffix);
	});
}

function mentionsUnit(command, from, other) {
	const rel = slash(relative(from.directory, other.directory));
	const patterns = [other.name, other.directory, rel].filter(Boolean);
	return patterns.some((token) => {
		const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(`(?:^|[\\s'"\`=:/])${escaped}(?:$|[\\s'"\`/;&|])`).test(command);
	});
}

/** A lane's path (architecture.json `lanes`): a directory with its trailing slash, or one file. */
export const inLanePath = (path, lanePath) =>
	lanePath.endsWith('/') ? path.startsWith(lanePath) : path === lanePath;
const withoutExtension = (path) => path.replace(/\.[cm]?[jt]sx?$/, '');
/** The source file a relative import names, with TypeScript's extension and index lookups; null for none. */
function sourceFile(root, path) {
	const candidates = [
		path,
		...['.ts', '.tsx', '.mts', '.js', '.mjs'].map(
			(extension) => `${withoutExtension(path)}${extension}`
		),
		...['ts', 'js'].map((extension) => `${path}/index.${extension}`),
	];
	return (
		candidates.find(
			(candidate) => existsSync(join(root, candidate)) && /\.[cm]?[jt]sx?$|\.json$/.test(candidate)
		) ?? null
	);
}
const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
];

/**
 * A lane set apart from the code around it, such as Loam's frozen hosted lane (D162): its packages and paths are
 * the only place that may import its packages, or reach into its paths by a relative import. A package that holds
 * one of the lane's paths may list a lane package as a devDependency, for those files; no other manifest may list
 * one. Every source file is read, tests included, since a test that imports the lane makes its job build it.
 */
function checkLanes(root, config, files, units, fail) {
	for (const lane of config.lanes ?? []) {
		const where = `lane ${lane.name ?? '(unnamed)'}`;
		if (
			typeof lane.name !== 'string' ||
			!Array.isArray(lane.packages) ||
			lane.packages.length === 0 ||
			!Array.isArray(lane.paths) ||
			lane.paths.length === 0
		) {
			fail(`${where}: needs a name, at least one package and at least one path`);
			continue;
		}
		const inside = (path) => lane.paths.some((lanePath) => inLanePath(path, lanePath));
		const into = (target) =>
			lane.paths.some((lanePath) =>
				lanePath.endsWith('/')
					? within(target, lanePath.slice(0, -1))
					: withoutExtension(target) === withoutExtension(lanePath)
			);
		const fix = `move what it needs out of the lane, or the file into the lane's paths (architecture.json's lanes say why it is ${lane.state ?? 'set apart'})`;
		// Each path must hold a file, so a renamed directory cannot leave the lane empty and the check green.
		for (const lanePath of lane.paths)
			if (!files.some((file) => inLanePath(file, lanePath)))
				fail(`${where}: its path ${lanePath} holds no file`);
		for (const name of lane.packages) {
			const unit = units.find((item) => item.format === 'npm' && item.name === name);
			if (!unit) fail(`${where}: ${name} is not a classified npm distribution`);
			else if (!inside(unit.manifestPath))
				fail(`${where}: ${name} (${unit.manifestPath}) is outside the lane's paths`);
		}
		for (const unit of units.filter(
			(item) => item.format === 'npm' && !inside(item.manifestPath)
		)) {
			const holdsLanePath = lane.paths.some((lanePath) => within(lanePath, unit.directory));
			for (const field of DEPENDENCY_FIELDS)
				for (const name of Object.keys(unit.data[field] ?? {}))
					if (lane.packages.includes(name) && !(field === 'devDependencies' && holdsLanePath))
						fail(
							`${unit.manifestPath}: ${field} lists ${name}, of the ${where}; only a package that holds the lane's paths may, as a devDependency`
						);
		}
		// Its inputs: the files outside it that it reads. Each holds a file, and every relative import that leaves the
		// lane, followed through the files it reaches, lands in one, so the lane's gate opens when they change.
		const inputs = Array.isArray(lane.inputs) ? lane.inputs : [];
		if (lane.inputs !== undefined && !Array.isArray(lane.inputs))
			fail(`${where}: its inputs must be a list`);
		const isInput = (path) => inputs.some((input) => inLanePath(path, input));
		for (const input of inputs)
			if (!files.some((file) => inLanePath(file, input)))
				fail(`${where}: its input ${input} holds no file`);
		const pending = files.filter((file) => inside(file) && /\.[cm]?[jt]sx?$/.test(file));
		const seen = new Set(pending);
		while (pending.length > 0) {
			const from = pending.pop();
			for (const specifier of imports(read(join(root, from)), from)) {
				if (!specifier.startsWith('.')) continue;
				const named = slash(join(dirname(from), specifier.replace(/\?.*$/, '')));
				// A file that is no source (`../../index.html?raw`) is read all the same: it must be an input too.
				const target = sourceFile(root, named) ?? (files.includes(named) ? named : null);
				if (!target || inside(target) || seen.has(target)) continue;
				seen.add(target);
				if (!isInput(target))
					fail(
						`${from}: imports ${specifier} (${target}), outside the ${where} and not among its inputs in architecture.json; list it there, so a change to it runs the lane's job`
					);
				if (/\.[cm]?[jt]sx?$/.test(target)) pending.push(target);
			}
		}
		const names = [
			...lane.packages,
			...lane.paths.map((lanePath) => lanePath.split('/').filter(Boolean).at(-1)),
		];
		for (const path of files) {
			if (!/\.[cm]?[jt]sx?$/.test(path) || inside(path)) continue;
			const text = read(join(root, path));
			// Only a file that names a lane package or a lane path's last segment can import one.
			if (!names.some((name) => text.includes(withoutExtension(name)))) continue;
			for (const specifier of imports(text, path)) {
				if (lane.packages.includes(packageName(specifier)))
					fail(`${path}: imports ${specifier}, of the ${where}; ${fix}`);
				else if (specifier.startsWith('.')) {
					const target = slash(join(dirname(path), specifier.replace(/\?.*$/, '')));
					if (into(target)) fail(`${path}: imports ${specifier}, a path of the ${where}; ${fix}`);
				}
			}
		}
	}
}

/**
 * A one-way root (architecture.json `oneWay`, such as `endpoints/loam/plugins/` under D109): code inside it
 * may import packages outside it, while nothing outside it (repo-wide, including root `package.json` and
 * top-level `scripts/`) may depend on or import anything under it, and sibling subdirectories under it
 * (separate plugins) may not depend on or import one another.
 */
function checkOneWay(root, config, units, fail) {
	if (!config.oneWay?.length) return;
	const repoFiles = walk(root, '', config.exclude);
	const repoPackageManifests = repoFiles.filter(
		(path) => path === 'package.json' || path.endsWith('/package.json')
	);

	for (const rule of config.oneWay) {
		const rootPath = rule.path;
		if (
			typeof rootPath !== 'string' ||
			!rootPath.endsWith('/') ||
			typeof rule.reason !== 'string'
		) {
			fail(`oneWay rule: needs a directory path ending in '/' and a reason`);
			continue;
		}
		// Each one-way root must hold a file so a renamed directory or typo cannot leave the check green.
		if (!repoFiles.some((file) => file.startsWith(rootPath))) {
			fail(`oneWay rule ${rootPath}: path holds no file`);
			continue;
		}
		const prefix = rootPath.slice(0, -1);
		const inside = (path) => path.startsWith(rootPath);
		const pluginOf = (path) => (inside(path) ? path.slice(rootPath.length).split('/')[0] : null);
		const pluginUnits = units.filter((unit) => inside(unit.manifestPath));
		const pluginPackages = new Map(
			pluginUnits
				.filter((unit) => unit.format === 'npm')
				.map((unit) => [unit.name, pluginOf(unit.manifestPath)])
		);
		// Also include any unclassified package.json under the one-way root.
		for (const manifestPath of repoPackageManifests.filter((path) => inside(path))) {
			try {
				const parsed = JSON.parse(read(join(root, manifestPath)));
				if (typeof parsed.name === 'string' && !pluginPackages.has(parsed.name)) {
					pluginPackages.set(parsed.name, pluginOf(manifestPath));
				}
			} catch {
				// Malformed package.json fails elsewhere if classified.
			}
		}
		const packageNames = [...pluginPackages.keys()];
		const lastSegment = prefix.split('/').at(-1);

		for (const manifestPath of repoPackageManifests) {
			let data;
			try {
				data = JSON.parse(read(join(root, manifestPath)));
			} catch {
				continue;
			}
			const callerPlugin = pluginOf(manifestPath);
			for (const field of DEPENDENCY_FIELDS) {
				for (const name of Object.keys(data[field] ?? {})) {
					const targetPlugin = pluginPackages.get(name);
					if (!targetPlugin) continue;
					if (callerPlugin === null)
						fail(
							`${manifestPath}: ${field} lists ${name}, under one-way root ${rootPath} (${rule.reason})`
						);
					else if (callerPlugin !== targetPlugin)
						fail(
							`${manifestPath}: ${field} lists ${name}, of sibling plugin ${targetPlugin} under ${rootPath} (${rule.reason})`
						);
				}
			}
		}

		for (const path of repoFiles) {
			if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
			const callerPlugin = pluginOf(path);
			const text = read(join(root, path));
			const hasRelevantRef =
				packageNames.some((name) => text.includes(name)) ||
				text.includes(lastSegment) ||
				(callerPlugin !== null && text.includes('..'));
			if (!hasRelevantRef) continue;
			for (const specifier of imports(text, path)) {
				const pkg = packageName(specifier);
				const targetPlugin = pluginPackages.get(pkg);
				if (targetPlugin) {
					if (callerPlugin === null)
						fail(`${path}: imports ${specifier}, under one-way root ${rootPath} (${rule.reason})`);
					else if (callerPlugin !== targetPlugin)
						fail(
							`${path}: imports ${specifier}, of sibling plugin ${targetPlugin} under ${rootPath} (${rule.reason})`
						);
					continue;
				}
				if (specifier.startsWith('.')) {
					const target = slash(join(dirname(path), specifier.replace(/\?.*$/, '')));
					if (!within(target, prefix)) continue;
					const resolvedPlugin = target === prefix ? '' : pluginOf(`${target}/`);
					if (callerPlugin === null)
						fail(`${path}: imports ${specifier}, into one-way root ${rootPath} (${rule.reason})`);
					else if (resolvedPlugin && callerPlugin !== resolvedPlugin)
						fail(
							`${path}: imports ${specifier}, into sibling plugin ${resolvedPlugin} under ${rootPath} (${rule.reason})`
						);
				}
			}
		}
	}
}

/** Returns violations, runtime/build-time edge graphs, and a planning-only surface map; never mutates files. */
export function checkBoundaries(root, config = JSON.parse(read(join(root, 'architecture.json')))) {
	const errors = [];
	const fail = (message) => errors.push(message);
	if (config.schemaVersion !== 1) throw new Error('Unsupported architecture schema');
	for (const directory of config.discoveryRoots)
		if (!existsSync(join(root, directory)))
			fail(`Stale discoveryRoot "${directory}" does not exist; remove it from architecture.json`);
	const files = [
		...new Set(config.discoveryRoots.flatMap((directory) => walk(root, directory, config.exclude))),
	];
	const selected = files.filter((path) => manifests.has(path.split('/').at(-1)));
	const units = [];
	for (const path of selected) {
		// Nested CMake files describe targets, not separate distributions.
		if (
			path.endsWith('CMakeLists.txt') &&
			!/\bproject\s*\([^)]*\bVERSION\b/is.test(read(join(root, path)))
		)
			continue;
		if (config.quarantine.some((item) => within(path, typeof item === 'string' ? item : item.path)))
			continue;
		const entry = classification(path, config);
		if (!entry) {
			fail(`Unclassified distribution ${path}; classify or explicitly quarantine it`);
			continue;
		}
		if (
			!['foundation', 'integration', 'endpoint', 'example'].includes(entry.layer) ||
			(entry.layer === 'foundation' && !config.families.includes(entry.family))
		) {
			fail(`Invalid classification ${path}`);
			continue;
		}
		try {
			const unit = loadUnit(root, entry);
			const sublayer = assignSublayer(unit, config.familyRules);
			if (sublayer === null) {
				fail(`Unclassified sublayer for ${unit.name} in family ${unit.family} (${path})`);
			} else if (sublayer !== undefined) {
				const allowedMap = config.familyRules[unit.family]?.allowed ?? {};
				if (!Object.hasOwn(allowedMap, sublayer)) {
					fail(`Unknown sublayer "${sublayer}" for ${unit.name} in family ${unit.family}`);
				}
				unit.sublayer = sublayer;
			}
			units.push(unit);
		} catch (error) {
			fail(`${path}: ${error.message}`);
		}
	}
	for (const entry of config.units)
		if (!units.some((unit) => unit.manifestPath === entry.manifest))
			fail(`Configured distribution missing or excluded: ${entry.manifest}`);
	const byName = new Map(units.map((unit) => [`${unit.registry}:${unit.name}`, unit]));
	if (byName.size !== units.length)
		fail('Duplicate registry/package identity in architecture units');
	const owner = (path) =>
		units
			.filter((unit) => within(slash(relative(root, resolve(path))), unit.directory))
			.sort((a, b) => b.directory.length - a.directory.length)[0];

	const graph = new Map(units.map((unit) => [unit, new Set()]));
	const buildGraph = new Map(units.map((unit) => [unit, new Set()]));
	const exemptions = (config.buildTimeExemptions ?? []).map((entry) => ({
		...entry,
		key: `${entry.from} -> ${entry.to}`,
	}));
	const usedExemptions = new Set();
	const runtimeExemptions = (config.runtimeExemptions ?? []).map((entry) => ({
		...entry,
		key: `${entry.from} -> ${entry.to}`,
	}));
	const usedRuntimeExemptions = new Set();

	function edge(from, to, context) {
		if (!to || from === to) return;
		graph.get(from).add(to);
		const key = `${from.name} -> ${to.name}`;
		const exempted = runtimeExemptions.find((entry) => entry.key === key);
		if (from.layer === 'foundation' && (to.layer !== 'foundation' || from.family !== to.family))
			fail(`${context}: foundation ${from.name} requires ${to.layer} ${to.name} (${to.family})`);
		if (from.layer === 'integration' && to.layer === 'endpoint')
			fail(`${context}: integration ${from.name} requires endpoint ${to.name}`);
		if (from.layer === 'example' && to.layer === 'endpoint') {
			if (exempted) usedRuntimeExemptions.add(key);
			else fail(`${context}: example ${from.name} requires endpoint ${to.name}`);
		}
		if (from.layer !== 'example' && to.layer === 'example') {
			if (exempted) usedRuntimeExemptions.add(key);
			else fail(`${context}: ${from.layer} ${from.name} requires example ${to.name}`);
		}
		if (from.family === to.family && from.sublayer && to.sublayer) {
			const allowed = config.familyRules?.[from.family]?.allowed?.[from.sublayer] ?? [];
			if (!allowed.includes(to.sublayer))
				fail(
					`${context}: ${from.family} sublayer "${from.sublayer}" (${from.name}) may not depend on "${to.sublayer}" (${to.name})`
				);
		}
	}

	function buildEdge(from, to, context) {
		if (!to || from === to) return;
		buildGraph.get(from).add(to);
		const key = `${from.name} -> ${to.name}`;
		const exempted = exemptions.find((entry) => entry.key === key);
		const forbiddenFoundation = from.layer === 'foundation' && to.layer !== 'foundation';
		const forbiddenExample = from.layer === 'example' && to.layer === 'endpoint';
		const forbiddenToExample = from.layer !== 'example' && to.layer === 'example';
		let forbiddenSublayer = false;
		if (from.family === to.family && from.sublayer && to.sublayer) {
			const rules = config.familyRules?.[from.family];
			const allowed = rules?.buildAllowed?.[from.sublayer] ?? rules?.allowed?.[from.sublayer] ?? [];
			if (!allowed.includes(to.sublayer)) forbiddenSublayer = true;
		}
		if (forbiddenFoundation || forbiddenExample || forbiddenToExample || forbiddenSublayer) {
			if (exempted) {
				usedExemptions.add(key);
				return;
			}
			if (forbiddenSublayer) {
				fail(
					`${context}: build-time edge violates ${from.family} sublayer "${from.sublayer}" (${from.name}) -> "${to.sublayer}" (${to.name})`
				);
			} else {
				fail(
					`${context}: build-time edge from ${from.layer} ${from.name} to ${to.layer} ${to.name} (${to.family}) is refused`
				);
			}
		}
	}

	for (const unit of units) {
		for (const dependency of unit.requirements)
			edge(
				unit,
				byName.get(`${dependency.registry}:${dependency.name}`),
				`${unit.manifestPath} dependency`
			);
		for (const dependency of unit.devRequirements)
			buildEdge(
				unit,
				byName.get(`${dependency.registry}:${dependency.name}`),
				`${unit.manifestPath} devDependency`
			);
		for (const name of unit.configurationDependencies ?? []) {
			const target = units.find((other) => other.name === name);
			if (!target) fail(`${unit.manifestPath}: unknown configuration dependency ${name}`);
			else edge(unit, target, `${unit.manifestPath} configuration`);
		}
		if (unit.format !== 'npm') {
			const checkPaths = (value, isDev = false) => {
				if (!value || typeof value !== 'object') return;
				for (const [key, nested] of Object.entries(value)) {
					if (key === 'path' && typeof nested === 'string') {
						const target = owner(resolve(root, unit.directory, nested));
						if (isDev) buildEdge(unit, target, `${unit.manifestPath} native dev path`);
						else edge(unit, target, `${unit.manifestPath} native path`);
					} else if (key === 'dev-dependencies') {
						checkPaths(nested, true);
					} else {
						checkPaths(nested, isDev);
					}
				}
			};
			if (unit.format === 'rust') checkPaths(unit.data, false);
			for (const path of unit.data['build-system']?.['backend-path'] ?? [])
				edge(
					unit,
					owner(resolve(root, unit.directory, path)),
					`${unit.manifestPath} build backend`
				);
			continue;
		}
		for (const entry of exportEntries(unit.data.exports ?? {})) {
			if (
				!entry.target.startsWith('./') ||
				!within(slash(relative(root, resolve(root, unit.directory, entry.target))), unit.directory)
			)
				fail(`${unit.manifestPath}: export target escapes package ${entry.target}`);
		}
		for (const field of ['main', 'types', 'typings'])
			if (
				unit.data[field] &&
				!within(
					slash(relative(root, resolve(root, unit.directory, unit.data[field]))),
					unit.directory
				)
			)
				fail(`${unit.manifestPath}: ${field} target escapes package`);
		const configPath = join(root, unit.directory, 'tsconfig.json');
		let options = {};
		if (existsSync(configPath)) {
			const parsed = ts.readConfigFile(configPath, ts.sys.readFile);
			if (parsed.error) fail(`${unit.directory}/tsconfig.json: cannot parse config`);
			else
				options = ts.parseJsonConfigFileContent(parsed.config, ts.sys, dirname(configPath)).options;
			for (const paths of Object.values(options.paths ?? {}))
				for (const path of paths) {
					const target = owner(
						resolve(options.baseUrl ?? dirname(configPath), path.replace(/\*.*$/, ''))
					);
					edge(unit, target, `${unit.directory}/tsconfig.json path mapping`);
				}
		}
		for (const field of ['imports', 'config'])
			for (const other of units) {
				if (other === unit) continue;
				const value = JSON.stringify(unit.data[field] ?? {});
				if (value.includes(other.name) || value.includes(other.directory))
					edge(unit, other, `${unit.manifestPath} ${field}`);
			}
		for (const [name, command] of Object.entries(unit.data.scripts ?? {})) {
			const isInstallHook = /^(preinstall|install|postinstall|prepare)$/.test(name);
			for (const other of units) {
				if (other === unit) continue;
				if (isInstallHook) {
					if (
						command.includes(other.name) ||
						command.includes(other.directory) ||
						command.includes(slash(relative(unit.directory, other.directory)))
					)
						edge(unit, other, `${unit.manifestPath} ${name} hook`);
				} else if (mentionsUnit(command, unit, other)) {
					buildEdge(unit, other, `${unit.manifestPath} script "${name}"`);
				}
			}
			if (isInstallHook) {
				for (const match of command.matchAll(/(?:node|tsx|ts-node)\s+([^\s;&|]+\.[cm]?[jt]s)/g)) {
					const path = resolve(root, unit.directory, match[1]);
					const target = owner(path);
					if (target !== unit) edge(unit, target, `${unit.manifestPath} ${name} hook path`);
					else if (existsSync(path))
						for (const specifier of imports(read(path), path))
							inspectImport(unit, specifier, path, options, false);
				}
			}
		}

		function inspectImport(from, specifier, path, compilerOptions, isBuildTime) {
			if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return;
			const name = packageName(specifier);
			const target = byName.get(`npm:${name}`);
			if (target && target !== from) {
				if (isBuildTime) {
					buildEdge(from, target, `${slash(relative(root, path))} build-time import`);
					return;
				}
				const declared = ['dependencies', 'optionalDependencies', 'peerDependencies'].some(
					(field) => Object.hasOwn(from.data[field] ?? {}, name)
				);
				if (!declared)
					fail(`${slash(relative(root, path))}: undeclared package import ${specifier}`);
				if (!publicImport(target, specifier))
					fail(`${slash(relative(root, path))}: non-public package import ${specifier}`);
				edge(from, target, `${slash(relative(root, path))} import/type reference`);
				return;
			}
			const resolved = ts.resolveModuleName(specifier, path, compilerOptions, ts.sys).resolvedModule
				?.resolvedFileName;
			const destination =
				resolved ??
				(specifier.startsWith('.')
					? resolve(dirname(path), specifier)
					: isAbsolute(specifier)
						? specifier
						: null);
			const pathOwner = destination && owner(destination);
			if (pathOwner && pathOwner !== from) {
				if (isBuildTime) {
					buildEdge(from, pathOwner, `${slash(relative(root, path))} build-time path`);
				} else {
					fail(`${slash(relative(root, path))}: cross-package source/alias bypass ${specifier}`);
					edge(from, pathOwner, path);
				}
			}
		}

		const unitJsFiles = files.filter(
			(path) =>
				within(path, unit.directory) &&
				/\.[cm]?[jt]sx?$/.test(path) &&
				owner(join(root, path)) === unit
		);
		for (const path of unitJsFiles) {
			const isRuntimeSrc =
				within(path, `${unit.directory}/src`) &&
				!/(?:^|\/)(?:__tests__|fixtures)(?:\/)|\.(?:test|spec|stories)\./.test(path);
			for (const specifier of imports(read(join(root, path)), path))
				inspectImport(unit, specifier, join(root, path), options, !isRuntimeSrc);
		}
	}

	for (const unit of units.filter((item) => item.format === 'python')) {
		const modules = new Map(
			units
				.filter((item) => item.format === 'python')
				.flatMap((item) =>
					(item.pythonModules ?? [item.name.replaceAll('-', '_')]).map((name) => [name, item])
				)
		);
		for (const path of files.filter(
			(path) =>
				within(path, unit.directory) && path.endsWith('.py') && owner(join(root, path)) === unit
		)) {
			const isRuntimeSrc = within(path, `${unit.directory}/src`);
			// Static syntax only; discard multiline docstrings before matching statements.
			const text = read(join(root, path)).replace(/(["']{3})[\s\S]*?\1/g, '');
			for (const match of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([^\n#]+))/gm)) {
				for (const module of match[1]
					? [match[1]]
					: match[2].split(',').map((value) => value.trim().split(/\s/)[0])) {
					const target = modules.get(module.split('.')[0]);
					if (target && target !== unit) {
						if (isRuntimeSrc) {
							if (!unit.requirements.some((item) => item.name === target.name))
								fail(`${path}: undeclared Python import ${module}`);
							edge(unit, target, `${path} import/type reference`);
						} else {
							buildEdge(unit, target, `${path} build-time Python import`);
						}
					}
				}
			}
		}
		for (const [rawName, value] of Object.entries(unit.data.tool?.uv?.sources ?? {}))
			if (value.path) {
				const name = registryName('pypi', rawName);
				const target = owner(resolve(root, unit.directory, value.path));
				const development = unit.devRequirements.some((item) => item.name === name);
				if (development && !unit.requirements.some((item) => item.name === name)) {
					buildEdge(unit, target, `${unit.manifestPath} dev editable source`);
					continue;
				}
				if (target && !unit.requirements.some((item) => item.name === name))
					fail(`${unit.manifestPath}: undeclared editable source ${rawName}`);
				edge(unit, target, `${unit.manifestPath} editable source`);
			}
	}
	for (const entry of exemptions) {
		if (!usedExemptions.has(entry.key)) {
			fail(
				`Stale buildTimeExemption ${entry.key}: no matching forbidden build-time edge remains; delete the entry`
			);
		}
	}
	for (const entry of runtimeExemptions) {
		if (!usedRuntimeExemptions.has(entry.key)) {
			fail(
				`Stale runtimeExemption ${entry.key}: no matching forbidden runtime edge remains; delete the entry`
			);
		}
	}

	checkLanes(root, config, files, units, fail);
	checkOneWay(root, config, units, fail);
	for (const start of units) {
		const visit = (current, seen) => {
			for (const next of graph.get(current)) {
				if (next === start) {
					if (start.layer === 'endpoint') fail(`Endpoint dependency cycle involving ${start.name}`);
					continue;
				}
				if (seen.has(next)) continue;
				if (
					start.layer === 'foundation' &&
					(next.layer !== 'foundation' || next.family !== start.family)
				)
					fail(
						`${start.name}: transitive foundation coupling through ${current.name} to ${next.name}`
					);
				visit(next, new Set([...seen, next]));
			}
		};
		visit(start, new Set([start]));
	}
	const kernelDomains = checkKernelDomains(root);
	for (const error of kernelDomains.errors) fail(error);
	return {
		errors: [...new Set(errors)],
		units,
		// Direct repository-owned runtime edges per unit name; third-party packages are not units.
		dependencies: Object.fromEntries(
			units.map((unit) => [unit.name, [...graph.get(unit)].map((target) => target.name).sort()])
		),
		// Direct repository-owned build-time edges (devDependencies, tests, scripts, non-src files).
		buildTimeDependencies: Object.fromEntries(
			units.map((unit) => [
				unit.name,
				[...buildGraph.get(unit)].map((target) => target.name).sort(),
			])
		),
		coverage: coverageMap(units),
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const result = checkBoundaries(process.cwd());
		if (process.argv.includes('--coverage')) console.log(JSON.stringify(result.coverage, null, 2));
		const shown = process.argv.indexOf('--dependencies');
		if (shown !== -1) {
			const name = process.argv[shown + 1];
			if (!name || !Object.hasOwn(result.dependencies, name))
				throw new Error(`--dependencies needs a classified unit name, got ${name ?? 'nothing'}`);
			console.log(`${name} -> ${result.dependencies[name].join(', ') || '(none)'}`);
		}
		const shownBuild = process.argv.indexOf('--build-dependencies');
		if (shownBuild !== -1) {
			const name = process.argv[shownBuild + 1];
			if (name && !name.startsWith('--')) {
				if (!Object.hasOwn(result.buildTimeDependencies, name))
					throw new Error(`--build-dependencies needs a classified unit name, got ${name}`);
				console.log(
					`${name} (build) -> ${result.buildTimeDependencies[name].join(', ') || '(none)'}`
				);
			} else {
				for (const [unitName, deps] of Object.entries(result.buildTimeDependencies))
					if (deps.length > 0) console.log(`${unitName} (build) -> ${deps.join(', ')}`);
			}
		}
		for (const error of result.errors) console.error(`✘ ${error}`);
		if (result.errors.length) process.exitCode = 1;
		else if (!process.argv.includes('--coverage') && shownBuild === -1)
			console.log(
				`✓ Static boundaries: ${result.units.length} classified distributions; isolated consumer evidence remains separate`
			);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
