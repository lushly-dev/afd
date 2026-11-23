/**
 * The local equivalents of the path-filtered workflows, so `pnpm verify` can run on this machine
 * what a pull request would run remotely.
 *
 * `SUITES` is generated directly from `.github/workflows/*.yml` by `scripts/sync-ci.mjs`
 * (`pnpm ci:sync`), and `readTrigger` parses workflow triggers and `affected.mjs gate` steps
 * structurally via `scripts/ci/parse-workflow.mjs` (#1800).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorkflow } from '../ci/parse-workflow.mjs';
import { SUITES } from './suites.generated.mjs';

export { SUITES };

/** Converts a GitHub Actions path filter to a regular expression. */
export function filterPattern(glob) {
	let source = '';
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === '*' && glob[index + 1] === '*') {
			// `**/` also matches no directory at all: `docs/**/*.md` matches docs/guide.md.
			const directories = glob[index + 2] === '/' && (index === 0 || glob[index - 1] === '/');
			source += directories ? '(?:.*/)?' : '.*';
			index += directories ? 2 : 1;
		} else if (char === '*') source += '[^/]*';
		else if (char === '?') source += '[^/]';
		else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

/** Whether a path filter list (later `!` entries exclude, later entries re-include) matches a file. */
export function matchesFilters(filters, file) {
	let matched = false;
	for (const filter of filters) {
		const negated = filter.startsWith('!');
		if (filterPattern(negated ? filter.slice(1) : filter).test(file)) matched = !negated;
	}
	return matched;
}

/**
 * The pull-request trigger of a workflow: `{ paths }` (null when every change triggers it) and
 * its `gate` steps by id as argument lists, or null when pull requests do not trigger it.
 */
export function readTrigger(text) {
	const parsed = parseWorkflow(text);
	const pr = parsed.triggers.pull_request;
	if (!pr) return null;
	if (pr.paths !== undefined && pr.paths.length === 0) {
		throw new Error('unreadable pull_request.paths: empty list');
	}
	return { paths: pr.paths ?? null, gates: parsed.gates };
}

export function readSuiteTrigger(root, suite) {
	return readTrigger(readFileSync(join(root, '.github/workflows', suite.workflow), 'utf8'));
}
