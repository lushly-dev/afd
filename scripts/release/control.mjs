/** Read-only release admission and planning. No registry or repository mutation. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import semver from 'semver';
import { parse as parseToml } from 'smol-toml';
import {
	cargoRequirements,
	npmRequirements,
	pythonRequirements,
	registryName,
} from './manifest-requirements.mjs';

export const DEFAULT_ROOTS = [
	'packages',
	'python',
	'alfred',
	'foundations',
	'endpoints',
	'integrations',
	'tools',
];
const SKIP = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'.venv',
	'target',
	'__pycache__',
	'.pytest_cache',
	'.mypy_cache',
	'.ruff_cache',
	'out',
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => {
	throw new Error(message);
};

/** Reject traversal and symlinks, including symlinked parents, before reading. */
export function safePath(root, file) {
	if (
		typeof file !== 'string' ||
		!file ||
		isAbsolute(file) ||
		file.includes('\\') ||
		file.split('/').some((part) => !part || part === '..' || part === '.')
	)
		fail(`Unsafe repository path: ${file}`);
	const base = realpathSync(root);
	let current = base;
	for (const part of file.split('/')) {
		current = join(current, part);
		if (existsSync(current) && lstatSync(current).isSymbolicLink())
			fail(`Symlink is not release input: ${file}`);
	}
	if (!current.startsWith(`${base}${sep}`)) fail(`Path escapes repository: ${file}`);
	return current;
}
function read(root, file) {
	return readFileSync(safePath(root, file), 'utf8');
}
export function readDistribution(root, entry) {
	const text = read(root, entry.manifest);
	let name,
		version,
		dependencies = {},
		dependencyRequirements = [],
		privatePackage = false;
	if (entry.format === 'npm') {
		const manifest = JSON.parse(text);
		({ name, version } = manifest);
		privatePackage = manifest.private === true;
		dependencies = {
			...manifest.dependencies,
			...manifest.optionalDependencies,
			...manifest.peerDependencies,
		};
		dependencyRequirements = npmRequirements(manifest);
	} else if (entry.format === 'python' || entry.format === 'rust') {
		const section = entry.format === 'python' ? 'project' : 'package';
		const manifest = parseToml(text);
		name = manifest[section]?.name;
		version = manifest[section]?.version;
		privatePackage = entry.format === 'rust' && manifest.package?.publish === false;
		dependencyRequirements =
			entry.format === 'python'
				? pythonRequirements(manifest.project ?? {})
				: cargoRequirements(manifest);
	} else if (entry.format === 'cpp') {
		const match = text.match(/\bproject\s*\(\s*([\w-]+)\s+VERSION\s+([\d.]+)/m);
		name = match?.[1];
		version = match?.[2];
	} else fail(`Unknown manifest format: ${entry.format}`);
	if (typeof name !== 'string' || !name || typeof version !== 'string' || !version)
		fail(`Cannot identify release manifest: ${entry.manifest}`);
	if (entry.initialVersion && semver.lt(version, entry.initialVersion))
		fail(`Version progression reset: ${entry.manifest}`);
	return {
		...entry,
		name,
		version,
		dependencies,
		dependencyRequirements,
		private: privatePackage,
		manifestHash: hash(text),
	};
}

export function loadInventory(root) {
	const inventory = JSON.parse(read(root, 'scripts/release/inventory.json'));
	if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.units))
		fail('Unsupported release inventory');
	const units = new Set(),
		identities = new Set(),
		paths = new Set();
	for (const unit of inventory.units) {
		if (!unit.id || units.has(unit.id)) fail(`Duplicate or missing release unit: ${unit.id}`);
		units.add(unit.id);
		if (
			!['admitted', 'held', 'quarantined'].includes(unit.state) ||
			!unit.authority ||
			!unit.sourceRevision ||
			!unit.protocol ||
			!unit.gates?.length ||
			!unit.routes?.length ||
			!unit.distributions?.length
		)
			fail(`Incomplete release contract: ${unit.id}`);
		if (unit.routes.length !== 1) fail(`Only one enabled publication route is allowed: ${unit.id}`);
		for (const distribution of unit.distributions) {
			safePath(root, distribution.manifest);
			const identity = `${distribution.registry}:${registryName(distribution.registry, distribution.name)}`;
			if (
				!distribution.name ||
				!distribution.registry ||
				identities.has(identity) ||
				paths.has(distribution.manifest)
			)
				fail(`Ambiguous distribution ownership: ${identity}`);
			identities.add(identity);
			paths.add(distribution.manifest);
		}
	}
	return inventory;
}

/** Unknown public manifests are reported as quarantined, including future roots. */
export function discoverDistributions(root, inventory = loadInventory(root), { formats } = {}) {
	const found = [];
	function walk(dir) {
		const full = safePath(root, dir);
		if (!existsSync(full)) return;
		for (const item of readdirSync(full, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name)
		)) {
			if (SKIP.has(item.name)) continue;
			const file = `${dir}/${item.name}`;
			if (item.isSymbolicLink()) fail(`Symlink in distribution roots: ${file}`);
			if (item.isDirectory()) walk(file);
			else {
				const format = {
					'package.json': 'npm',
					'pyproject.toml': 'python',
					'Cargo.toml': 'rust',
					'CMakeLists.txt': 'cpp',
				}[item.name];
				if (!format || (formats && !formats.includes(format))) continue;
				// Subproject CMakeLists without project identity are not distributions.
				if (format === 'cpp' && !/\bproject\s*\([^)]*\bVERSION\s+/m.test(read(root, file)))
					continue;
				if (format === 'python' && !parseToml(read(root, file)).project) continue;
				if (format === 'rust' && !parseToml(read(root, file)).package) continue;
				const distribution = readDistribution(root, { manifest: file, format });
				if (distribution.private) continue;
				const owner = inventory.units.find((unit) =>
					unit.distributions.some((entry) => entry.manifest === file)
				);
				const declared = owner?.distributions.find((entry) => entry.manifest === file);
				if (declared && (declared.name !== distribution.name || declared.format !== format))
					fail(`Manifest identity changed: ${file}`);
				if (
					declared?.initialVersion &&
					(!semver.valid(distribution.version) ||
						semver.lt(distribution.version, declared.initialVersion))
				)
					fail(`Version progression reset: ${file}`);
				found.push({
					...distribution,
					registry:
						declared?.registry ??
						{ npm: 'npm', python: 'pypi', rust: 'crates', cpp: 'source' }[format],
					unit: owner?.id ?? null,
					state: owner?.state ?? 'quarantined',
				});
			}
		}
	}
	for (const dir of new Set([...DEFAULT_ROOTS, ...(inventory.roots ?? [])])) walk(dir);
	for (const unit of inventory.units)
		for (const entry of unit.distributions) {
			if (formats && !formats.includes(entry.format)) continue;
			if (!found.some((distribution) => distribution.manifest === entry.manifest))
				fail(`Declared public distribution missing: ${entry.manifest}`);
		}
	const identities = found.map(
		(entry) => `${entry.registry}:${registryName(entry.registry, entry.name)}`
	);
	if (new Set(identities).size !== identities.length)
		fail('Duplicate public distribution identity');
	return found;
}

/** Only npm semver frontmatter is accepted in npm storage; category fragments use separate storage. */
export function parseFragments(root, inventory = loadInventory(root)) {
	const fragments = [];
	const storages = inventory.storages ?? [{ path: '.changeset', protocol: 'npm-changesets' }];
	for (const storage of storages) {
		const dir = safePath(root, storage.path);
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).sort()) {
			if (['README.md', 'config.json'].includes(file) && storage.protocol === 'npm-changesets')
				continue;
			const path = `${storage.path}/${file}`;
			const text = read(root, path);
			const packages = [];
			if (storage.protocol === 'npm-changesets') {
				const match = text.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/);
				if (!file.endsWith('.md') || !match) fail(`Unknown release fragment format: ${path}`);
				for (const line of (match[1] ?? '').split(/\r?\n/).filter((line) => line.trim())) {
					const item = line.match(/^["']?([^"':\s]+)["']?:\s*(patch|minor|major)\s*$/);
					if (!item) fail(`Incompatible npm fragment: ${path}`);
					packages.push({ name: item[1], type: item[2] });
				}
			} else if (storage.protocol === 'category-json-v1') {
				const fragment = JSON.parse(text);
				if (
					!file.endsWith('.json') ||
					fragment.protocol !== storage.protocol ||
					!['added', 'changed', 'fixed', 'removed', 'security', 'deprecated'].includes(
						fragment.category
					) ||
					typeof fragment.summary !== 'string' ||
					!Array.isArray(fragment.units)
				)
					fail(`Unknown category fragment: ${path}`);
				for (const id of fragment.units) {
					const unit = inventory.units.find(
						(unit) => unit.id === id && unit.protocol === storage.protocol
					);
					if (!unit) fail(`Unknown fragment owner: ${id}`);
					packages.push(
						...unit.distributions.map((entry) => ({ name: entry.name, type: fragment.category }))
					);
				}
			} else fail(`Unknown release protocol: ${storage.protocol}`);
			const owners = packages.map(
				({ name }) =>
					inventory.units.find(
						(unit) =>
							unit.protocol === storage.protocol &&
							unit.distributions.some((entry) => entry.name === name)
					)?.id
			);
			if (
				owners.includes(undefined) ||
				new Set(packages.map(({ name }) => name)).size !== packages.length
			)
				fail(`Unknown or ambiguous fragment ownership: ${path}`);
			fragments.push({
				file: path,
				hash: hash(text),
				units: [...new Set(owners)].sort(),
				packages,
				protocol: storage.protocol,
			});
		}
	}
	return fragments;
}

export function assertAdmission({ root, inventory = loadInventory(root), unit, route }) {
	const selected = inventory.units.find((entry) => entry.id === unit);
	if (selected?.state !== 'admitted') fail(`Release unit is not admitted: ${unit}`);
	if (typeof route !== 'string' || !selected.routes.includes(route))
		fail(`Unapproved release route ${route} for ${unit}`);
	const distributions = discoverDistributions(root, inventory).filter(
		(entry) => entry.unit === unit
	);
	if (
		selected.heldVersions?.some((version) =>
			distributions.some((entry) => entry.version === version)
		)
	)
		fail(`Release candidate is held: ${unit}`);
	return distributions;
}
export function candidateDigest(root, inventory, selectedUnits) {
	let sourceRevision = null;
	try {
		sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		/* Disposable fixtures may have no Git history. */
	}
	return hash(
		JSON.stringify({
			sourceRevision,
			inventory,
			selectedUnits: [...selectedUnits].sort(),
			distributions: discoverDistributions(root, inventory).map(
				({ manifest, manifestHash, name, version }) => ({ manifest, manifestHash, name, version })
			),
			fragments: parseFragments(root, inventory),
		})
	);
}

export function planRelease({
	root,
	inventory = loadInventory(root),
	selectedUnits,
	registryEvidence = [],
	fragments = parseFragments(root, inventory),
}) {
	if (
		!Array.isArray(selectedUnits) ||
		!selectedUnits.length ||
		new Set(selectedUnits).size !== selectedUnits.length
	)
		fail('Select complete, distinct release units');
	const actualFragments = parseFragments(root, inventory);
	if (JSON.stringify(fragments) !== JSON.stringify(actualFragments))
		fail('Release fragments changed or were omitted');
	if (
		!Array.isArray(registryEvidence) ||
		registryEvidence.some(
			(entry) =>
				typeof entry.name !== 'string' ||
				typeof entry.registry !== 'string' ||
				!Array.isArray(entry.versions) ||
				entry.versions.some((version) => typeof version !== 'string')
		) ||
		new Set(
			registryEvidence.map(
				(entry) => `${entry.registry}:${registryName(entry.registry, entry.name)}`
			)
		).size !== registryEvidence.length
	)
		fail('Invalid or ambiguous registry evidence');
	const selected = [...selectedUnits].sort();
	const all = discoverDistributions(root, inventory);
	const distributions = selected.flatMap((unit) =>
		assertAdmission({
			root,
			inventory,
			unit,
			route: inventory.units.find((entry) => entry.id === unit)?.routes[0],
		})
	);
	if (distributions.some((entry) => !semver.valid(entry.version)))
		fail('Unsupported selected release version');
	for (const unit of selected.map((id) => inventory.units.find((entry) => entry.id === id))) {
		const versions = new Set(
			distributions.filter((entry) => entry.unit === unit.id).map((entry) => entry.version)
		);
		if (unit.fixed && versions.size !== 1) fail(`Partial fixed group versions: ${unit.id}`);
	}
	for (const fragment of fragments)
		if (
			fragment.units.some((id) => selected.includes(id)) &&
			fragment.units.some((id) => !selected.includes(id))
		)
			fail(`Incomplete coordinated release fragment: ${fragment.file}`);
	for (const distribution of distributions) {
		for (const { registry, name, range: rawRange, required } of [
			...distribution.dependencyRequirements,
			...(inventory.units.find((unit) => unit.id === distribution.unit)?.prerequisites ?? []).map(
				(entry) => ({ ...entry, required: true })
			),
		]) {
			const canonicalName = registryName(registry, name);
			const dependency = all.find(
				(entry) =>
					entry.registry === registry && registryName(registry, entry.name) === canonicalName
			);
			if (!dependency && !required) continue;
			if (typeof rawRange !== 'string') fail(`Missing dependency range ${name}`);
			let range = rawRange.replace(/^workspace:/, '');
			if (['*', '^', '~'].includes(range) && rawRange.startsWith('workspace:')) {
				if (!dependency) fail(`Workspace prerequisite has no candidate manifest: ${name}`);
				range = range === '*' ? dependency.version : `${range}${dependency.version}`;
			}
			if (!semver.validRange(range)) fail(`Unsupported dependency range ${name}: ${rawRange}`);
			const prerequisite = distributions.find(
				(entry) =>
					entry.registry === registry && registryName(entry.registry, entry.name) === canonicalName
			);
			const published = registryEvidence.find(
				(entry) =>
					entry.registry === registry && registryName(entry.registry, entry.name) === canonicalName
			);
			if (
				!(prerequisite && semver.satisfies(prerequisite.version, range)) &&
				!published?.versions.some(
					(version) => semver.valid(version) && semver.satisfies(version, range)
				)
			)
				fail(`Unsatisfied prerequisite ${name}@${range} for ${distribution.name}`);
		}
	}
	const plan = {
		schemaVersion: 1,
		selectedUnits: selected,
		distributions: distributions.map(
			({ unit, name, registry, manifest, version, manifestHash }) => ({
				unit,
				name,
				registry,
				manifest,
				version,
				manifestHash,
			})
		),
		fragments: fragments.filter((fragment) => fragment.units.some((id) => selected.includes(id))),
		candidateDigest: candidateDigest(root, inventory, selected),
		registryEvidence,
	};
	return { ...plan, digest: hash(JSON.stringify(plan)) };
}
