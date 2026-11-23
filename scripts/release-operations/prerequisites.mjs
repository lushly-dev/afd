import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverDistributions, loadInventory } from '../release/control.mjs';
import { npmRequirements } from '../release/manifest-requirements.mjs';
import { hash, json, run } from './shared.mjs';

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
/**
 * Group artifacts into topological waves so every prerequisite appears in an earlier wave than its
 * dependents. Independent packages share a wave and can overlap their registry readback waits (#952).
 */
export function dependencyWaves(root, artifacts, metadataFor) {
	const inventory = loadInventory(root);
	const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
	const active = new Set();
	const depths = new Map();
	const visited = [];
	function depthOf(artifact) {
		if (depths.has(artifact.name)) return depths.get(artifact.name);
		if (active.has(artifact.name))
			throw new Error(`Cyclic publication prerequisite: ${artifact.name}`);
		active.add(artifact.name);
		let level = 0;
		for (const prerequisite of requirements(
			metadataFor(artifact.file),
			inventory.units.find((unit) => unit.id === artifact.unit)
		)) {
			if (prerequisite.registry !== 'npm')
				throw new Error(`Unsupported registry evidence adapter: ${prerequisite.registry}`);
			const dependency = byName.get(prerequisite.name);
			if (dependency) level = Math.max(level, depthOf(dependency) + 1);
		}
		active.delete(artifact.name);
		depths.set(artifact.name, level);
		visited.push(artifact);
		return level;
	}
	for (const artifact of artifacts) depthOf(artifact);
	const waves = [];
	for (const artifact of visited) {
		const level = depths.get(artifact.name);
		waves[level] ??= [];
		waves[level].push(artifact);
	}
	return waves;
}

export function dependencyOrder(root, artifacts, metadataFor) {
	return dependencyWaves(root, artifacts, metadataFor).flat();
}
const lookupPublished = (artifact, { timeoutMs }) =>
	JSON.parse(
		run(
			process.execPath,
			[
				fileURLToPath(new URL('./registry-readback.mjs', import.meta.url)),
				artifact.name,
				artifact.version,
				artifact.artifactHash,
				String(statSync(artifact.file).size),
				String(timeoutMs),
			],
			process.cwd()
		)
	);

/**
 * npm can serve a fresh tarball well after accepting it: Specimen's linux-x64-gnu host was still
 * missing ten minutes after its upload in run 43111505926 (#1007). Poll for thirty minutes, backing off from five
 * seconds to one minute, so a slow blob holds no release while a missing one still does.
 */
export const READBACK_DEADLINE_MS = 1_800_000;
export const READBACK_MAX_ATTEMPTS = 60;
const firstWaitMs = 5000;
const longestWaitMs = 60_000;

/**
 * Poll a wave of artifacts together so their registry propagation waits overlap (#952).
 * Retries only absent versions (`notVisible: true`); any other error fails immediately.
 */
export function readPublishedBatch(
	artifacts,
	{
		lookup = lookupPublished,
		now = () => performance.now(),
		wait = (milliseconds) =>
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
	} = {}
) {
	const results = new Map();
	let pending = [...artifacts];
	const deadline = now() + READBACK_DEADLINE_MS;
	let pause = firstWaitMs;
	for (
		let attempt = 0;
		attempt < READBACK_MAX_ATTEMPTS && pending.length > 0 && now() < deadline;
		attempt++
	) {
		const stillPending = [];
		for (let index = 0; index < pending.length; index++) {
			const artifact = pending[index];
			const remaining = deadline - now();
			if (remaining <= 0) {
				stillPending.push(artifact);
				continue;
			}
			let metadata;
			try {
				metadata = lookup(artifact, {
					timeoutMs: Math.max(1, Math.ceil(Math.min(10000, remaining))),
				});
			} catch (error) {
				const unverified = [artifact, ...stillPending, ...pending.slice(index + 1)];
				if (error && typeof error === 'object') {
					error.artifact = artifact.name;
					error.pending = unverified;
					error.results = results;
				}
				throw error;
			}
			if (metadata?.notVisible === true) stillPending.push(artifact);
			else results.set(artifact.name, metadata);
		}
		pending = stillPending;
		const remaining = deadline - now();
		if (pending.length > 0 && attempt < READBACK_MAX_ATTEMPTS - 1 && remaining > 0) {
			wait(Math.min(pause, remaining));
			pause = Math.min(pause * 2, longestWaitMs);
		}
	}
	if (pending.length > 0) {
		const names = pending.map((artifact) => `${artifact.name}@${artifact.version}`).join(', ');
		throw Object.assign(new Error(`Registry version is still not visible: ${names}`), {
			results,
			pending,
		});
	}
	return artifacts.map((artifact) => results.get(artifact.name));
}

/** Retry only an absent version after a successful upload; never retry an upload. */
export function readPublished(artifact, options = {}) {
	return readPublishedBatch([artifact], options)[0];
}
export function verifyPublished(artifact, readback) {
	const bytes = readFileSync(artifact.file);
	if (hash(bytes) !== artifact.artifactHash)
		throw new Error('Approved artifact changed during publication');
	const expected = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
	const metadata = readback(artifact);
	const tarball = metadata?.method === 'registry-tarball';
	const integrity = tarball ? metadata.integrity : metadata?.dist?.integrity;
	if (
		metadata?.name !== artifact.name ||
		metadata.version !== artifact.version ||
		typeof integrity !== 'string' ||
		!integrity.split(/\s+/).includes(expected) ||
		(tarball && (metadata.sha256 !== artifact.artifactHash || metadata.bytes !== bytes.length))
	)
		throw new Error(
			`Published artifact readback is missing or uncertain: ${artifact.name}@${artifact.version}`
		);
	return {
		name: artifact.name,
		version: artifact.version,
		integrity: expected,
		...(tarball
			? {
					method: 'registry-tarball',
					sha256: metadata.sha256,
					bytes: metadata.bytes,
					url: metadata.url,
				}
			: { method: 'registry-metadata' }),
	};
}
