#!/usr/bin/env node
/**
 * The units a set of changed paths affects, for the software factory's merge lane (botcore-factory's
 * `units` adapter key, in botcore.toml). When main moves under a validated branch, the lane runs this
 * once for the branch's changes and once for main's; it advances the branch without validating it
 * again only when the two lists share no unit.
 *
 *   node scripts/factory-units.mjs <path>...     prints a JSON list of unit names
 *
 * A unit is:
 *   - `package:<name>`: a workspace package the change affects, its dependents included
 *     (scripts/affected/scope.mjs, as `pnpm check` selects them);
 *   - `workflow:<file>`: a workflow whose pull_request path filter matches a changed path, or whose
 *     `Affected units` gate the change opens (scripts/affected/suites.mjs, as `pnpm verify` plans);
 *   - `dir:<directory>`: the directory of each changed path, so two changes to one directory, which
 *     the repository-wide checks read together, never pass as unrelated;
 *   - `*`: the change selects the whole workspace (a global input), or changes a manifest or the
 *     lockfile, whose new dependencies the workspace graph read here would not yet show; it overlaps
 *     everything.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScope } from './affected/scope.mjs';
import { matchesFilters, readTrigger } from './affected/suites.mjs';
import { planSuites } from './affected.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The path-filtered pull-request triggers of every workflow, by file name. */
export function workflowTriggers(directory = root) {
	const workflows = join(directory, '.github/workflows');
	const triggers = new Map();
	for (const name of readdirSync(workflows)
		.filter((file) => /\.ya?ml$/.test(file))
		.sort()) {
		const trigger = readTrigger(readFileSync(join(workflows, name), 'utf8'));
		if (trigger?.paths) triggers.set(name, trigger.paths);
	}
	return triggers;
}

/** The units `files` affect, sorted. */
export function factoryUnits(files, { directory = root, scope, triggers, plan } = {}) {
	if (files.length === 0) return [];
	if (files.some((file) => file === 'pnpm-lock.yaml' || posix.basename(file) === 'package.json'))
		return ['*'];
	const resolved = scope ?? resolveScope({ root: directory, files });
	if (resolved.mode === 'all') return ['*'];
	const units = new Set(resolved.affected.map((name) => `package:${name}`));
	for (const [name, paths] of triggers ?? workflowTriggers(directory))
		if (resolved.files.some((file) => matchesFilters(paths, file))) units.add(`workflow:${name}`);
	for (const { suite } of plan ?? planSuites(resolved, { root: directory }))
		units.add(`workflow:${suite.workflow}`);
	for (const file of resolved.files) units.add(`dir:${posix.dirname(file)}`);
	return [...units].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		console.log(JSON.stringify(factoryUnits(process.argv.slice(2))));
	} catch (error) {
		console.error(`factory-units: ${error.message}`);
		process.exitCode = 1;
	}
}
