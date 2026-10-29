import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverDistributions, loadInventory } from '../release/control.mjs';
import { npmRequirements } from '../release/manifest-requirements.mjs';
import { hash, json, registryUrl, run } from './shared.mjs';

export function requirements(metadata, unit, includeOptionalPeers = false) {
	const peers = Object.fromEntries(
		Object.entries(metadata.peerDependencies ?? {}).filter(
			([name]) => includeOptionalPeers || !metadata.peerDependenciesMeta?.[name]?.optional
		)
	);
	return [
		...npmRequirements({ ...metadata, peerDependencies: peers }),
		...(unit?.prerequisites ?? []).map((entry) => ({ ...entry, required: true })),
	];
}
/** Query selected candidates and their requirements; unselected source cannot describe published dependencies. */
export function registryNames(root, selectedUnits) {
	const inventory = loadInventory(root),
		all = discoverDistributions(root, inventory);
	const queue = selectedUnits
		? [...selectedUnits]
		: inventory.units
				.filter((unit) => unit.state === 'admitted' && unit.protocol === 'npm-changesets')
				.map((unit) => unit.id);
	const visited = new Set(),
		names = new Set();
	while (queue.length) {
		const id = queue.shift();
		if (visited.has(id)) continue;
		visited.add(id);
		const unit = inventory.units.find((unit) => unit.id === id);
		if (!unit) throw new Error(`Unknown prerequisite unit: ${id}`);
		for (const distribution of all.filter((entry) => entry.unit === id)) {
			if (distribution.registry !== 'npm')
				throw new Error(`Unsupported registry evidence adapter: ${distribution.registry}`);
			names.add(distribution.name);
			for (const requirement of requirements(json(join(root, distribution.manifest)), unit, true)) {
				if (requirement.registry !== 'npm')
					throw new Error(`Unsupported registry evidence adapter: ${requirement.registry}`);
				names.add(requirement.name);
			}
		}
	}
	return [...names].sort();
}
export function dependencyOrder(root, artifacts, metadataFor) {
	const inventory = loadInventory(root),
		ordered = [],
		active = new Set(),
		visited = new Set();
	function visit(artifact) {
		if (visited.has(artifact.name)) return;
		if (active.has(artifact.name))
			throw new Error(`Cyclic publication prerequisite: ${artifact.name}`);
		active.add(artifact.name);
		for (const prerequisite of requirements(
			metadataFor(artifact.file),
			inventory.units.find((unit) => unit.id === artifact.unit)
		)) {
			if (prerequisite.registry !== 'npm')
				throw new Error(`Unsupported registry evidence adapter: ${prerequisite.registry}`);
			const dependency = artifacts.find((entry) => entry.name === prerequisite.name);
			if (dependency) visit(dependency);
		}
		active.delete(artifact.name);
		visited.add(artifact.name);
		ordered.push(artifact);
	}
	for (const artifact of artifacts) visit(artifact);
	return ordered;
}
export function readPublished(artifact) {
	return JSON.parse(
		run(
			'npm',
			[
				'view',
				`${artifact.name}@${artifact.version}`,
				'--json',
				'--registry',
				registryUrl,
				...(artifact.name.startsWith('@')
					? [`--${artifact.name.split('/')[0]}:registry=${registryUrl}`]
					: []),
			],
			process.cwd()
		)
	);
}
export function verifyPublished(artifact, readback) {
	const bytes = readFileSync(artifact.file);
	if (hash(bytes) !== artifact.artifactHash)
		throw new Error('Approved artifact changed during publication');
	const expected = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
	const metadata = readback(artifact);
	if (
		metadata?.name !== artifact.name ||
		metadata.version !== artifact.version ||
		typeof metadata.dist?.integrity !== 'string' ||
		!metadata.dist.integrity.split(/\s+/).includes(expected)
	)
		throw new Error(
			`Published artifact readback is missing or uncertain: ${artifact.name}@${artifact.version}`
		);
	return { name: artifact.name, version: artifact.version, integrity: expected };
}
