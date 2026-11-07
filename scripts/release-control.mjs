#!/usr/bin/env node
/** Guarded operational entry point. Never delegate publication discovery to Changesets. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AUTOMATIC_ROUTES,
	assertAdmission,
	loadInventory,
	parseFragments,
	planRelease,
	releaseChannel,
} from './release/control.mjs';
import { recordReleaseProvenance } from './release/provenance.mjs';
import { createPublishPlan, publishPlan } from './release-operations/publish.mjs';
import { pendingUnits, selectDefault } from './release-operations/selection.mjs';
import { json, readRegistry, registryNames, run } from './release-operations/shared.mjs';
import { versionSelected } from './release-operations/version.mjs';

export { createPublishPlan, publishPlan, versionSelected };

import {
	formatIntent,
	intentFile,
	intentStatus,
	readIntent,
	saveIntent,
} from './release-operations/intent.mjs';

export {
	formatIntent,
	intentStatus,
	readIntent,
	saveIntent,
} from './release-operations/intent.mjs';

/**
 * Trusted publishing uploads only to a package npm already has, with its publisher linked. A name
 * npm has never seen fails its upload after the run has claimed the intent, and that failed claim
 * holds every later run; so planning refuses it, and the run stops before it claims anything.
 */
export function assertPublishersExist(plan, registryEvidence) {
	const absent = plan.artifacts
		.map((artifact) => artifact.name)
		.filter((name) => !registryEvidence.find((entry) => entry.name === name)?.versions.length);
	if (absent.length)
		throw new Error(
			`npm has no package ${absent.join(', ')}; trusted publishing cannot create one. Publish a placeholder for each and link its trusted publisher, then re-run`
		);
}
function evidence(root, file, selectedUnits, route) {
	if (!selectedUnits) {
		const inventory = loadInventory(root);
		selectedUnits = pendingUnits(inventory, parseFragments(root, inventory), route);
	}
	return file
		? json(resolve(file))
		: registryNames(root, selectedUnits).map((name) => readRegistry(name));
}
/**
 * Without a route, each automatic route is tried in order and the first with a releasable batch
 * wins: one release publishes under one route and npm tag, and the rest wait for the next run.
 */
export function selectRelease({ root, selectedUnits, registryEvidence = [], route }) {
	const inventory = loadInventory(root);
	const fragments = parseFragments(root, inventory);
	let automatic = null;
	if (!selectedUnits) {
		const blocked = [];
		for (const candidate of route ? [route] : AUTOMATIC_ROUTES) {
			automatic = selectDefault({ root, inventory, fragments, registryEvidence, route: candidate });
			// A fragment spanning both routes blocks the same batch on each; report it once.
			for (const entry of automatic.blocked)
				if (!blocked.some((seen) => JSON.stringify(seen) === JSON.stringify(entry)))
					blocked.push(entry);
			if (automatic.selectedUnits.length) break;
		}
		automatic.blocked = blocked;
	}
	const units = selectedUnits ?? automatic.selectedUnits;
	if (!units.length)
		return { selectable: false, selectedUnits: [], blocked: automatic?.blocked ?? [] };
	route ??= releaseChannel(inventory, units).route;
	for (const unit of units) {
		const admitted = assertAdmission({ root, inventory, unit, route });
		if (admitted.some((distribution) => distribution.registry !== 'npm'))
			throw new Error('npm operation selected a non-npm unit');
	}
	return {
		selectable: true,
		route,
		blocked: automatic?.blocked ?? [],
		...planRelease({ root, inventory, selectedUnits: units, registryEvidence, fragments }),
	};
}
function options(args) {
	const result = {};
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (
			![
				'--units',
				'--plan',
				'--registry-evidence',
				'--root',
				'--route',
				'--tag',
				'--intent',
				'--receipt',
				'--output',
			].includes(argument) ||
			!args[index + 1]
		)
			throw new Error(`Unknown or incomplete argument: ${argument}`);
		result[argument.slice(2)] = args[++index];
	}
	return result;
}
export function main(args = process.argv.slice(2)) {
	const [command, ...rest] = args;
	const opts = options(rest);
	const root = resolve(opts.root ?? process.cwd());
	const selectedUnits = opts.units?.split(',');
	// Each unit releases on its own route unless one is named.
	const route = opts.route;
	let result;
	if (command === 'intent-status') {
		const supplied = opts['registry-evidence'] ? json(resolve(opts['registry-evidence'])) : null;
		result = intentStatus({
			root,
			path: opts.intent,
			registry: supplied
				? (name) => supplied.find((entry) => entry.registry === 'npm' && entry.name === name)
				: readRegistry,
		});
	} else if (command === 'admission') {
		if (!selectedUnits?.length) throw new Error('admission requires --units');
		const inventory = loadInventory(root);
		result = {
			admitted: selectedUnits.flatMap((unit) =>
				assertAdmission({
					root,
					inventory,
					unit,
					route: route ?? releaseChannel(inventory, [unit]).route,
				})
			),
		};
	} else if (command === 'select' || command === 'status' || command === 'version') {
		const selected = selectRelease({
			root,
			selectedUnits,
			registryEvidence: evidence(root, opts['registry-evidence'], selectedUnits, route),
			route,
		});
		result = selected;
		if (command === 'version' && selected.selectable) {
			result = versionSelected({ root, plan: selected, inventory: loadInventory(root) });
			if (existsSync(resolve(root, 'scripts/check-versions.mjs')))
				run(process.execPath, ['scripts/check-versions.mjs', '--write'], root);
			// Before the intent, which binds the records too, so the release PR can pass and publish.
			result.provenance = recordReleaseProvenance(
				root,
				`Versioned for release by pnpm version-packages (${result.selectedUnits.join(', ')})`
			);
			if (result.changed.length) {
				result.intent = saveIntent(root, result.selectedUnits, opts.intent);
				formatIntent(root, opts.intent);
			}
		}
	} else if (command === 'plan') {
		if (!opts.plan) throw new Error('plan requires --plan output path');
		if (opts.intent && opts.intent !== intentFile)
			throw new Error('Publication requires the canonical reviewed intent');
		const intent = readIntent(root);
		const units = selectedUnits ?? intent.selectedUnits;
		const destination = resolve(opts.plan);
		const registryEvidence = evidence(root, opts['registry-evidence'], units, route);
		result = createPublishPlan({
			root,
			selectedUnits: units,
			registryEvidence,
			route,
			distTag: opts.tag,
			artifactsDirectory: `${destination}.artifacts`,
			exclude: [
				relative(root, destination),
				relative(root, `${destination}.artifacts`),
				relative(root, `${destination}.receipt.json`),
			],
		});
		assertPublishersExist(result, registryEvidence);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, `${JSON.stringify(result, null, '\t')}\n`);
	} else if (command === 'publish') {
		if (!opts.plan) throw new Error('publish requires a bound --plan');
		result = publishPlan({
			root,
			plan: json(resolve(opts.plan)),
			receiptFile: resolve(opts.receipt ?? `${opts.plan}.receipt.json`),
		});
	} else
		throw new Error('Expected select, status, intent-status, version, plan, publish, or admission');
	const output = `${JSON.stringify(result, null, '\t')}\n`;
	if (opts.output) writeFileSync(resolve(opts.output), output);
	else process.stdout.write(output);
	return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
