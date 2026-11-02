#!/usr/bin/env node
/**
 * Static package boundaries, not installation or standalone-consumer evidence.
 * Checks repository-owned dependency closure, TS literal imports/type references,
 * Python static imports, public subpaths, config paths and literal hook references.
 * External registry dependency closure, computed imports, arbitrary hook execution,
 * Python dynamic imports and Rust/C++ source/type graphs require artifact consumers.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import ts from 'typescript';
import {
	cargoRequirements,
	npmRequirements,
	pythonRequirements,
} from './release/manifest-requirements.mjs';

const skip = new Set(['node_modules', 'dist', 'build', 'target', '.git', '.venv', '__pycache__']);
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
	if (format === 'npm') {
		const peers = Object.fromEntries(
			Object.entries(manifest.peerDependencies ?? {}).filter(
				([key]) => !manifest.peerDependenciesMeta?.[key]?.optional
			)
		);
		requirements = npmRequirements({ ...manifest, peerDependencies: peers });
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
	} else if (format === 'rust') requirements = cargoRequirements(manifest);
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

export function coverageMap(units, contract = {}) {
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
		requiredChecks: contract.checks ?? ['installation', 'import', 'types', 'dependencies'],
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

/** Returns violations and a planning-only coverage map; never mutates files. */
export function checkBoundaries(root, config = JSON.parse(read(join(root, 'architecture.json')))) {
	const errors = [];
	const fail = (message) => errors.push(message);
	if (config.schemaVersion !== 1) throw new Error('Unsupported architecture schema');
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
			!['foundation', 'integration', 'endpoint'].includes(entry.layer) ||
			(entry.layer === 'foundation' && !config.families.includes(entry.family))
		) {
			fail(`Invalid classification ${path}`);
			continue;
		}
		try {
			units.push(loadUnit(root, entry));
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
	function edge(from, to, context) {
		if (!to || from === to) return;
		graph.get(from).add(to);
		if (from.layer === 'foundation' && (to.layer !== 'foundation' || from.family !== to.family))
			fail(`${context}: foundation ${from.name} requires ${to.layer} ${to.name} (${to.family})`);
		if (from.layer === 'integration' && to.layer === 'endpoint')
			fail(`${context}: integration ${from.name} requires endpoint ${to.name}`);
	}
	for (const unit of units) {
		for (const dependency of unit.requirements)
			edge(
				unit,
				byName.get(`${dependency.registry}:${dependency.name}`),
				`${unit.manifestPath} dependency`
			);
		for (const name of unit.configurationDependencies ?? []) {
			const target = units.find((other) => other.name === name);
			if (!target) fail(`${unit.manifestPath}: unknown configuration dependency ${name}`);
			else edge(unit, target, `${unit.manifestPath} configuration`);
		}
		if (unit.format !== 'npm') {
			const checkPaths = (value) => {
				if (!value || typeof value !== 'object') return;
				for (const [key, nested] of Object.entries(value)) {
					if (key === 'path' && typeof nested === 'string')
						edge(
							unit,
							owner(resolve(root, unit.directory, nested)),
							`${unit.manifestPath} native path`
						);
					else if (key !== 'dev-dependencies') checkPaths(nested);
				}
			};
			if (unit.format === 'rust') checkPaths(unit.data);
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
		const hooks = Object.entries(unit.data.scripts ?? {}).filter(([name]) =>
			/^(preinstall|install|postinstall|prepare)$/.test(name)
		);
		for (const [name, command] of hooks) {
			for (const other of units)
				if (
					other !== unit &&
					(command.includes(other.name) ||
						command.includes(other.directory) ||
						command.includes(slash(relative(unit.directory, other.directory))))
				)
					edge(unit, other, `${unit.manifestPath} ${name} hook`);
			for (const match of command.matchAll(/(?:node|tsx|ts-node)\s+([^\s;&|]+\.[cm]?[jt]s)/g)) {
				const path = resolve(root, unit.directory, match[1]);
				const target = owner(path);
				if (target !== unit) edge(unit, target, `${unit.manifestPath} ${name} hook path`);
				else if (existsSync(path))
					for (const specifier of imports(read(path), path))
						inspectImport(unit, specifier, path, options);
			}
		}
		function inspectImport(from, specifier, path, compilerOptions) {
			if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return;
			const name = packageName(specifier);
			const target = byName.get(`npm:${name}`);
			const declared = ['dependencies', 'optionalDependencies', 'peerDependencies'].some((field) =>
				Object.hasOwn(from.data[field] ?? {}, name)
			);
			if (target && target !== from) {
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
				fail(`${slash(relative(root, path))}: cross-package source/alias bypass ${specifier}`);
				edge(from, pathOwner, path);
			}
		}
		for (const path of files.filter(
			(path) =>
				within(path, `${unit.directory}/src`) &&
				/\.[cm]?[jt]sx?$/.test(path) &&
				!/(?:^|\/)(?:__tests__|fixtures)(?:\/)|\.(?:test|spec)\./.test(path)
		)) {
			for (const specifier of imports(read(join(root, path)), path))
				inspectImport(unit, specifier, join(root, path), options);
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
			(path) => within(path, `${unit.directory}/src`) && path.endsWith('.py')
		)) {
			// Static syntax only; discard multiline docstrings before matching statements.
			const text = read(join(root, path)).replace(/(["']{3})[\s\S]*?\1/g, '');
			for (const match of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([^\n#]+))/gm)) {
				for (const module of match[1]
					? [match[1]]
					: match[2].split(',').map((value) => value.trim().split(/\s/)[0])) {
					const target = modules.get(module.split('.')[0]);
					if (target && target !== unit) {
						if (!unit.requirements.some((item) => item.name === target.name))
							fail(`${path}: undeclared Python import ${module}`);
						edge(unit, target, `${path} import/type reference`);
					}
				}
			}
		}
		for (const [name, value] of Object.entries(unit.data.tool?.uv?.sources ?? {}))
			if (value.path) {
				const development = ['dev', 'test', 'tests']
					.flatMap((key) => unit.data.project?.['optional-dependencies']?.[key] ?? [])
					.some((requirement) => requirement.match(/^[\w.-]+/)?.[0] === name);
				if (development && !unit.requirements.some((item) => item.name === name)) continue;
				const target = owner(resolve(root, unit.directory, value.path));
				if (target && !unit.requirements.some((item) => item.name === name))
					fail(`${unit.manifestPath}: undeclared editable source ${name}`);
				edge(unit, target, `${unit.manifestPath} editable source`);
			}
	}
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
	return {
		errors: [...new Set(errors)],
		units,
		// Direct repository-owned edges per unit name; third-party packages are not units.
		dependencies: Object.fromEntries(
			units.map((unit) => [unit.name, [...graph.get(unit)].map((target) => target.name).sort()])
		),
		coverage: coverageMap(units, config.coverageContract),
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
		for (const error of result.errors) console.error(`✘ ${error}`);
		if (result.errors.length) process.exitCode = 1;
		else if (!process.argv.includes('--coverage'))
			console.log(
				`✓ Static boundaries: ${result.units.length} classified distributions; isolated consumer evidence remains separate`
			);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
