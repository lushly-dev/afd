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
 * A family's provenance records (foundations/specimen/provenance/adaptations.json) affect none.
 * Dependents of affected packages are affected too, unless only the package's own test files
 * changed (packages/server/src/a.test.ts affects afd-server alone); builds also include the
 * dependencies of the affected packages.
 * A lane (architecture.json `lanes`, such as Loam's frozen hosted lane) is set apart: a file under
 * one of its paths affects only its packages, whatever package directory holds it, and a lane
 * package's change reaches no dependent outside the lane, since only the lane's own paths may
 * import it (scripts/check-boundaries.mjs). Its own workflow job gates it (`affected.mjs gate
 * --lane`), and `affected.mjs run`, the TypeScript gate, leaves its packages out.
 * GLOBAL_FILES, an unresolvable base or an unreadable lockfile select the whole workspace.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACKS } from '../release/tracks.mjs';
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
const SCOPE_INERT = new Set([
	'scripts/affected/suites.mjs',
	'scripts/affected/suites.generated.mjs',
]);

/**
 * Markdown under spec/: package tests read the JSON, vectors, wire fixtures and VERSION beside it,
 * and only repository-wide checks, which always run, read the prose.
 */
const PROSE = /\.md$/;

/**
 * Repository inputs, outside a package or in another one, that package tests read directly. With
 * `ownTests`, only the listed package's own tests read them, so its dependents are not selected.
 */
export const EXTRA_INPUTS = [
	// afd-testing's todo-example test runs the todo example's real commands, scenarios and relative
	// fixtures, which it reads by path rather than as a dependency; no dependent reads them.
	...[
		'packages/examples/todo/backends/typescript/src/',
		'packages/examples/todo/scenarios/',
		'packages/examples/todo/fixtures/',
	].map((prefix) => ({
		prefix,
		except: PROSE,
		packages: ['@lushly-dev/afd-testing'],
		ownTests: true,
	})),
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
	// Loam's identity scans what a browser loads for an import of it (phase 3 specification, E13). The
	// kernel is its dependency, but the kernel's test files, which the scan reads too, reach no dependent.
	// Only identity's own scan reads them, so they select none of its dependents: not the hosted server, which the
	// frozen lane's job gates when what it imports changes (D162).
	...[
		'endpoints/loam/packages/web/src/',
		'endpoints/loam/packages/chrome/src/',
		'endpoints/loam/packages/kernel/src/',
	].map((prefix) => ({ prefix, packages: ['@lushly-dev/loam-identity'], ownTests: true })),
	// Loam's scenario runner runs phase 5's jobs from the specification's folder (phase 5 specification, Jobs and
	// scenarios), so a change to one runs the kernel's tests.
	{
		prefix: 'endpoints/loam/docs/phases/5-copilot/scenarios/',
		packages: ['@lushly-dev/loam-kernel'],
	},
	// And phase 4's, with `p4-base.seed.json`, on the seed `p4-base`, whose apps the runner loads from their sources and
	// manifests, read with the CLI's manifest reader, by path (kernel/scenarios/apps.ts): only the kernel's own tests.
	{
		prefix: 'endpoints/loam/docs/phases/4-settings/scenarios/',
		packages: ['@lushly-dev/loam-kernel'],
		ownTests: true,
	},
	// `p5-base`'s calls come from `p4-base.seed.json` (kernel/scenarios/host-seed.ts), which Chromium's and the desktop's
	// scenario runners read too (phase 5 specification, P5-A1): their own tests alone.
	{
		prefix: 'endpoints/loam/docs/phases/4-settings/scenarios/p4-base.seed.json',
		packages: ['@lushly-dev/loam-web', '@lushly-dev/loam-desktop'],
		ownTests: true,
	},
	...[
		'endpoints/loam/apps/hello/',
		'endpoints/loam/apps/tally/',
		'endpoints/loam/apps/checklist/',
		'endpoints/loam/packages/cli/src/',
	].map((prefix) => ({
		prefix,
		except: PROSE,
		packages: ['@lushly-dev/loam-kernel'],
		ownTests: true,
	})),
	// The web host's units scan every file of the kernel and the chrome, tests included, for the name
	// of an app or a document type (phase 2 specification, section 1 and D2).
	{ prefix: 'endpoints/loam/packages/kernel/', packages: ['@lushly-dev/loam-web'] },
	{ prefix: 'endpoints/loam/packages/chrome/', packages: ['@lushly-dev/loam-web'] },
	// The seed library's tests check the bench's results against its output schemas, and its
	// confirmation prompts against the tasks that quote them.
	{
		prefix: 'docs/features/complete/agent-first-design/bench/results/',
		packages: ['@afd/example-seed-library'],
	},
	{
		prefix: 'docs/features/complete/agent-first-design/bench/tasks/',
		packages: ['@afd/example-seed-library'],
	},
	// specimen-fast-af's portable-gates browser test bundles real Violet elements directly by path
	// (avoiding a cyclic workspace dependency with violet-elements); only its own tests read them,
	// and never Violet's own test/spec files or prose.
	{
		prefix: 'foundations/fast-af/packages/violet-elements/src/',
		except: /(?:\.md|\.(?:test|spec)\.[cm]?[jt]sx?)$/,
		packages: ['@lushly-dev/specimen-fast-af'],
		ownTests: true,
	},
	// violet-elements' theme:build copies violet-runtime's naming rule into its generated sources
	// (Loam D50: no Violet dependency), and its gate's regenerate-and-diff step checks the copy.
	{
		prefix: 'foundations/violet/packages/runtime/src/property.ts',
		packages: ['@lushly-dev/violet-elements'],
		ownTests: true,
	},
	// violet-afd's interface.test.ts reads violet-elements' published token interface by path.
	{
		prefix: 'foundations/fast-af/packages/violet-elements/tokens/interface.json',
		packages: ['@lushly-dev/violet-afd'],
		ownTests: true,
	},
	// specimen-afd-runner's slice3.browser.test.ts reads the canonical Job 11 scenario YAML by path.
	{
		prefix:
			'docs/features/complete/screens-from-jobs/scenarios/11-find-what-no-job-reaches.scenario.yaml',
		packages: ['@lushly-dev/specimen-afd-runner'],
		ownTests: true,
	},
];

export const DEFAULT_BASES = ['origin/main', 'main'];

/**
 * The lanes architecture.json sets apart (its `lanes`): each `{ name, packages, paths }`, a path a
 * directory with its trailing slash or one file. None when the file is absent (a test's fixture).
 */
export function readLanes(root) {
	const file = join(root, 'architecture.json');
	if (!existsSync(file)) return [];
	return JSON.parse(readFileSync(file, 'utf8')).lanes ?? [];
}

/** Whether `file` lies under the lane path `lanePath`. */
export const inLanePath = (file, lanePath) =>
	lanePath.endsWith('/') ? file.startsWith(lanePath) : file === lanePath;

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

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
/**
 * A path as git prints it. Git quotes a path that holds a quote, a backslash, a control character
 * or, by default, any non-ASCII byte ("packages/rust/tests/caf\303\251.rs"): left quoted, such a
 * file would match no path filter and no package, and its change would select nothing.
 */
export function gitPath(line) {
	if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return line;
	const body = line.slice(1, -1);
	const bytes = [];
	for (let index = 0; index < body.length; index++) {
		if (body[index] !== '\\') {
			// A whole code point: half of a surrogate pair is not a character.
			const char = String.fromCodePoint(body.codePointAt(index));
			bytes.push(...Buffer.from(char, 'utf8'));
			index += char.length - 1;
			continue;
		}
		const octal = /^[0-7]{3}/.exec(body.slice(index + 1));
		if (octal) {
			bytes.push(Number.parseInt(octal[0], 8));
			index += 3;
		} else {
			index++;
			bytes.push(ESCAPES[body[index]] ?? body.charCodeAt(index));
		}
	}
	return Buffer.from(bytes).toString('utf8');
}

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

/**
 * A family's provenance records. Only scripts/{specimen,fast-af,violet}-provenance.test.mjs read
 * them, and the tooling tests run those for every change, so the records select no package.
 */
const provenanceRecord = (path) => /^foundations\/[^/]+\/provenance\//.test(path);
/**
 * A package's own test file (a.test.ts, a.spec.ts, a.pw.spec.ts). The package's suites run it and
 * nothing imports one, so it reaches its package and not the dependents. A helper or fixture that
 * tests share (a.test-support.ts, fixtures/) is not one, and keeps reaching dependents. A suite
 * that reads another package's files, tests included, declares them in EXTRA_INPUTS, and a
 * workflow step that does names them as a `--path` of its gate (loam.yml's `theme:check`).
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
export const OWN_TESTS = 'its own test file, so no dependent is selected';

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
const TRACK_STUBS = new Set(Object.values(TRACKS).map((track) => track.package));

export function resolveScope({ root, all = false, bases = DEFAULT_BASES, files, git } = {}) {
	const packages = readWorkspace(root);
	const everything = packages.map((pkg) => pkg.name);
	const lanes = readLanes(root);
	const lanePackages = new Set(lanes.flatMap((lane) => lane.packages));
	const laneOf = (file) =>
		lanes.find((lane) => lane.paths.some((lanePath) => inLanePath(file, lanePath)));
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
		lanes,
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
		].map(gitPath);
	}
	changedFiles = [...new Set(changedFiles.map((file) => file.replaceAll('\\', '/')))].sort();

	const reasons = new Map();
	// Packages a change reaches beyond their own test files: these select their dependents too.
	const spreading = new Set();
	const mark = (name, why, ownTests = false) => {
		if (ownTests) {
			if (!reasons.has(name)) reasons.set(name, `${why} (${OWN_TESTS})`);
			return;
		}
		// The reason shown is the first that selects the dependents, over an earlier test file.
		if (!spreading.has(name)) reasons.set(name, why);
		spreading.add(name);
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
		if (provenanceRecord(file)) continue;
		// A release track's stub is a version holder beside a project that is not a workspace
		// package: it owns none of that project's files, which reach their readers as before.
		let owners = packages.filter((pkg) => !TRACK_STUBS.has(pkg.name) && inside(file, pkg.dir));
		const ownTests = owners.length > 0 && TEST_FILE.test(file);
		// A lane's file is the lane's alone (web/test/hosted/ belongs to the hosted lane, not to the web host).
		const lane = laneOf(file);
		if (lane) owners = owners.filter((pkg) => lane.packages.includes(pkg.name));
		else if (owners.length === 0) {
			const unit = unitRoot(file);
			if (unit !== file && !unitDocs(file, unit))
				owners = packages.filter((pkg) => !TRACK_STUBS.has(pkg.name) && inside(pkg.dir, unit));
		}
		for (const pkg of owners) mark(pkg.name, file, ownTests);
		for (const input of EXTRA_INPUTS.filter(
			(extra) => file.startsWith(extra.prefix) && !extra.except?.test(file)
		))
			for (const name of input.packages) mark(name, file, input.ownTests === true);
	}

	const changed = [...reasons.keys()].filter((name) => everything.includes(name)).sort();
	const affected = [
		...new Set([
			...changed,
			...withDependents(
				// A package outside a lane reaches a lane package only from the lane's paths, which check-boundaries
				// holds to: the edge is the lane's, so the lane's change does not select that package.
				packages.map((pkg) =>
					lanePackages.has(pkg.name)
						? pkg
						: {
								...pkg,
								dependencies: pkg.dependencies.filter((name) => !lanePackages.has(name)),
							}
				),
				changed.filter((name) => spreading.has(name))
			),
		]),
	].sort();
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
		lanes,
	};
}
