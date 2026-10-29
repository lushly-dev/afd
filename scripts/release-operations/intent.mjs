import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import semver from 'semver';
import { assertAdmission, loadInventory, safePath } from '../release/control.mjs';
import { hash, readRegistry, run, sourceDigest } from './shared.mjs';
export const intentFile = '.release/npm-intent.json';

export function committedIntent(root, path = intentFile) {
	const absolute = safePath(root, path);
	if (!existsSync(absolute)) throw new Error('Missing reviewed release intent');
	const bytes = readFileSync(absolute);
	let committed;
	try {
		committed = run('git', ['show', `HEAD:${path}`], root);
	} catch {
		throw new Error('Release intent must be committed before planning or publication');
	}
	if (committed !== bytes.toString('utf8'))
		throw new Error('Release intent has uncommitted changes');
	return {
		record: JSON.parse(bytes.toString('utf8')),
		intentDigest: hash(bytes),
		intentPath: path,
	};
}
export function saveIntent(root, selectedUnits, path = intentFile) {
	const inventory = loadInventory(root);
	const distributions = selectedUnits.flatMap((unit) =>
		assertAdmission({ root, inventory, unit, route: 'npm-main' })
	);
	const record = {
		schemaVersion: 1,
		selectedUnits,
		inventoryHash: hash(
			JSON.stringify(inventory.units.filter((unit) => selectedUnits.includes(unit.id)))
		),
		sourceDigest: sourceDigest(
			root,
			[],
			distributions.map((distribution) => dirname(distribution.manifest))
		),
		distributions: distributions.map(({ name, version, manifest, manifestHash }) => ({
			name,
			version,
			manifest,
			manifestHash,
		})),
	};
	const destination = resolve(root, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, `${JSON.stringify(record, null, '\t')}\n`);
	return record;
}
export function readIntent(root, path = intentFile) {
	const { record, intentDigest } = committedIntent(root, path);
	if (
		record.schemaVersion !== 1 ||
		!record.selectedUnits?.length ||
		record.inventoryHash !==
			hash(
				JSON.stringify(
					loadInventory(root).units.filter((unit) => record.selectedUnits.includes(unit.id))
				)
			)
	)
		throw new Error('Release intent is stale or unsupported');
	const current = record.selectedUnits.flatMap((unit) =>
		assertAdmission({ root, unit, route: 'npm-main' })
	);
	if (
		record.sourceDigest !==
		sourceDigest(
			root,
			[],
			current.map((distribution) => dirname(distribution.manifest))
		)
	)
		throw new Error('Release intent source changed');
	if (
		record.distributions.length !== current.length ||
		current.some(
			(distribution) =>
				!record.distributions.some(
					(entry) =>
						entry.name === distribution.name &&
						entry.version === distribution.version &&
						entry.manifest === distribution.manifest &&
						entry.manifestHash === distribution.manifestHash
				)
		)
	)
		throw new Error('Release intent manifest changed');
	return { ...record, intentDigest };
}
/** A fulfilled approval is inert even after later development changes its source. */
export function intentStatus({ root, path = intentFile, registry = readRegistry }) {
	if (!existsSync(resolve(root, path)))
		return { publishable: false, state: 'missing', selectedUnits: [] };
	const { record } = committedIntent(root, path);
	const inventory = loadInventory(root);
	if (
		record.schemaVersion !== 1 ||
		!Array.isArray(record.selectedUnits) ||
		!record.selectedUnits.length ||
		new Set(record.selectedUnits).size !== record.selectedUnits.length ||
		!Array.isArray(record.distributions)
	)
		throw new Error('Publication held: malformed release intent');
	const expected = record.selectedUnits.flatMap((id) => {
		const unit = inventory.units.find((unit) => unit.id === id);
		if (unit?.protocol !== 'npm-changesets')
			throw new Error(`Publication held: unknown npm intent unit ${id}`);
		return unit.distributions;
	});
	if (
		expected.length !== record.distributions.length ||
		expected.some(
			(distribution) =>
				!record.distributions.some(
					(entry) =>
						distribution.registry === 'npm' &&
						entry.name === distribution.name &&
						entry.manifest === distribution.manifest &&
						semver.valid(entry.version)
				)
		)
	)
		throw new Error('Publication held: intent distribution identity changed');
	const missing = record.distributions.filter((distribution) => {
		const response = registry(distribution.name);
		if (
			response?.registry !== 'npm' ||
			response.name !== distribution.name ||
			!Array.isArray(response.versions) ||
			response.versions.some((version) => !semver.valid(version))
		)
			throw new Error(`Publication held: unknown registry outcome for ${distribution.name}`);
		return !response.versions.includes(distribution.version);
	});
	if (!missing.length)
		return { publishable: false, state: 'fulfilled', selectedUnits: record.selectedUnits };
	try {
		readIntent(root, path);
	} catch (error) {
		throw new Error(`Publication held: ${error.message}`);
	}
	return {
		publishable: true,
		state: 'pending',
		selectedUnits: record.selectedUnits,
		missing: missing.map(({ name, version }) => ({ name, version })),
	};
}
