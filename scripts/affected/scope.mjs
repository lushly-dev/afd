/**
 * Decides which workspace packages a change affects, so builds, typechecks and tests can skip
 * the parts of the monorepo the change cannot reach.
 *
 * A changed file affects:
 *   - every package whose directory contains it;
 *   - every package under the same unit root when it lies outside any package (for example
 *     foundations/violet/tsconfig.json affects both Violet packages), except under the unit's
 *     docs/ directory (endpoints/loam/docs/STATUS.md affects none), which no package reads;
 *   - the packages listed in EXTRA_INPUTS for shared inputs read from outside a package, except
 *     the prose beside them (spec/authorization.md affects none), which no package test reads;
 *   - via pnpm-lock.yaml, the importers whose resolved dependency closure changed.
 * Dependents of affected packages are affected too; builds also include their dependencies.
 * GLOBAL_FILES, an unresolvable base or an unreadable lockfile select the whole workspace.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedImporters } from './lockfile.mjs';
import { readWorkspace, withDependencies, withDependents } from './workspace.mjs';

/** Files every package build, typecheck or test run depends on. */
export const GLOBAL_FILES = new Set([
	'.github/workflows/ci.yml',
	'.npmrc',
	'.nvmrc',
	'lefthook.yml',
	'package.json',
	'pnpm-workspace.yaml',
	'scripts/affected.mjs',
	'tsconfig.json',
]);
const GLOBAL_PREFIXES = ['scripts/affected/'];
/** Under a global prefix, but only lists what `pnpm verify` runs; no package reads it. */
const SCOPE_INERT = new Set(['scripts/affected/suites.mjs']);

/**
 * Markdown under spec/: package tests read the JSON, vectors, wire fixtures and VERSION beside it,
 * and only repository-wide checks, which always run, read the prose.
 */
const PROSE = /\.md$/;

/** Repository inputs outside any package that package tests read directly. */
export const EXTRA_INPUTS = [
	// Wire fixtures, behaviour vectors, spec/VERSION and tool strategies.
	{
		prefix: 'spec/',
		except: PROSE,
		packages: ['@lushly-dev/afd-core', '@lushly-dev/afd-server', '@lushly-dev/afd-cli'],
	},
	// Loam's profile is checked against the plugin manifest core, and records the contract version.
	{ prefix: 'spec/plugin-manifest', except: PROSE, packages: ['@lushly-dev/loam-manifest'] },
	{ prefix: 'spec/VERSION', packages: ['@lushly-dev/loam-manifest'] },
	// The hosted server's header unit reads the web host's page source, whose policy `<meta>` it carries.
	{ prefix: 'endpoints/loam/packages/web/index.html', packages: ['@lushly-dev/loam-host'] },
	// Loam's identity scans what a browser loads for an import of it (phase 3 specification, E13); the
	// kernel's sources reach it as a dependency already.
	{ prefix: 'endpoints/loam/packages/web/src/', packages: ['@lushly-dev/loam-identity'] },
	{ prefix: 'endpoints/loam/packages/chrome/src/', packages: ['@lushly-dev/loam-identity'] },
];

export const DEFAULT_BASES = ['origin/main', 'main'];

function defaultGit(root) {
	return (args) =>
		execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 256 * 1024 * 1024,
		});
}

const lines = (text) => text.split('\n').filter(Boolean);

/** Resolves the merge base to diff against, or null when none of the refs exists. */
function mergeBase(git, refs) {
	for (const ref of refs) {
		if (/^0+$/.test(ref)) continue;
		try {
			return git(['merge-base', ref, 'HEAD']).trim();
		} catch {}
	}
	return null;
}

function readLockfile(git, root, base) {
	let baseText = null;
	try {
		baseText = git(['show', `${base}:pnpm-lock.yaml`]);
	} catch {}
	const file = join(root, 'pnpm-lock.yaml');
	return [baseText, existsSync(file) ? readFileSync(file, 'utf8') : null];
}

/** Folders whose children are units of their own: a Loam plugin is not part of Loam (its D109). */
const PLUGIN_ROOTS = ['endpoints/loam/plugins'];
/**
 * The unit root of a path: its first two segments (packages/core, foundations/violet, ...), or a
 * plugin's own folder (endpoints/loam/plugins/mail).
 */
const unitRoot = (path) => {
	const segments = path.split('/');
	const plugins = PLUGIN_ROOTS.find((root) => path.startsWith(`${root}/`));
	return segments.slice(0, plugins ? plugins.split('/').length + 1 : 2).join('/');
};
/** A unit's own documentation (endpoints/loam/docs/...): prose no package build or test reads. */
const unitDocs = (path, unit) => path.slice(unit.length + 1).split('/')[0] === 'docs';

const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);

/**
 * Resolves the scope of a change.
 *
 * @param {object} options
 * @param {string} options.root repository root
 * @param {boolean} [options.all] select the whole workspace
 * @param {string[]} [options.bases] refs to diff against, first resolvable wins
 * @param {string[]} [options.files] explicit changed files (compared with HEAD), skips the diff
 * @param {(args: string[]) => string} [options.git] git runner, for tests
 */
export function resolveScope({ root, all = false, bases = DEFAULT_BASES, files, git } = {}) {
	const packages = readWorkspace(root);
	const everything = packages.map((pkg) => pkg.name);
	const whole = (reason, extra = {}) => ({
		mode: 'all',
		reason,
		base: null,
		files: [],
		...extra,
		changed: everything,
		affected: everything,
		build: everything,
		reasons: new Map(),
		total: everything.length,
	});
	if (all) return whole('the whole workspace was requested');

	const run = git ?? defaultGit(root);
	let base = 'HEAD';
	let changedFiles = files;
	if (!changedFiles) {
		base = mergeBase(run, bases);
		if (!base) return whole(`no base to compare with (tried ${bases.join(', ')})`);
		changedFiles = [
			...lines(run(['diff', '--name-only', '--no-renames', base])),
			...lines(run(['ls-files', '--others', '--exclude-standard'])),
		];
	}
	changedFiles = [...new Set(changedFiles.map((file) => file.replaceAll('\\', '/')))].sort();

	const reasons = new Map();
	const mark = (name, why) => {
		if (!reasons.has(name)) reasons.set(name, why);
	};
	for (const file of changedFiles) {
		if (
			GLOBAL_FILES.has(file) ||
			(GLOBAL_PREFIXES.some((prefix) => file.startsWith(prefix)) && !SCOPE_INERT.has(file))
		)
			return whole(`${file} affects every package`, { base, files: changedFiles });
		if (file === 'pnpm-lock.yaml') {
			const lock = changedImporters(...readLockfile(run, root, base));
			if (lock.global) return whole(lock.global, { base, files: changedFiles });
			for (const importer of lock.importers)
				for (const pkg of packages.filter((candidate) => candidate.dir === importer))
					mark(pkg.name, 'pnpm-lock.yaml (resolved dependencies changed)');
			continue;
		}
		let owners = packages.filter((pkg) => inside(file, pkg.dir));
		if (owners.length === 0) {
			const unit = unitRoot(file);
			if (unit !== file && !unitDocs(file, unit))
				owners = packages.filter((pkg) => inside(pkg.dir, unit));
		}
		for (const pkg of owners) mark(pkg.name, file);
		for (const input of EXTRA_INPUTS.filter(
			(extra) => file.startsWith(extra.prefix) && !extra.except?.test(file)
		))
			for (const name of input.packages) mark(name, file);
	}

	const changed = [...reasons.keys()].filter((name) => everything.includes(name)).sort();
	const affected = [...withDependents(packages, changed)].sort();
	return {
		mode: 'affected',
		reason: `${changedFiles.length} changed file(s) since ${base === 'HEAD' ? 'HEAD' : base.slice(0, 12)}`,
		base,
		files: changedFiles,
		changed,
		affected,
		build: [...withDependencies(packages, affected)].sort(),
		reasons,
		total: everything.length,
	};
}
