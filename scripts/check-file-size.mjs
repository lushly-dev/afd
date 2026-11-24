#!/usr/bin/env node
/**
 * File Size Guard — Pre-commit and CI
 *
 * A runaway guard, not a factoring rule: only a source file over 1,500 lines blocks a commit.
 * The 500-line review threshold belongs to the sweep-bloat skill's periodic pass, which ranks
 * oversized files by size and churn and splits them on purpose, a few at a time, so a feature
 * never stops to split a file mid-change. The pair matches botcore.toml (file_size_warn /
 * file_size_error), which Botcore's dev_check_size reads.
 *
 * Scope:
 *   - Source extensions: .ts, .tsx, .js, .mjs, .cjs, .rs, .py, .cpp, .hpp
 *   - Source roots: packages/, python/, alfred/, foundations/, integrations/, endpoints/, scripts/,
 *     spec/, site/ and .claude/skills/ (skill scripts; .claude/worktrees/ holds nested checkouts). docs/ (feature prototypes) is out of scope, and
 *     site/js/vendor/ holds bundles the site build scripts write, so it is skipped.
 *   - Staged mode applies the same roots and skips as a full scan.
 *   - AFD-authored code inside imported families (violet-elements, violet, specimen, botcore,
 *     health) is checked; upstream Microsoft FAST source (`foundations/fast-af/packages/element/`)
 *     is skipped.
 *   - Test, story, declaration, benchmark, fuzz, fixture and generated files are skipped using
 *     each language's own conventions.
 *
 * Grandfathered files:
 *   - Pre-existing files over the 1,500-line limit are listed in `scripts/policy/file-size-limits.json`
 *     with their frozen line ceiling.
 *   - A grandfathered file may not grow past its recorded ceiling, and must be removed from the
 *     list once it drops to or below the limit (or is deleted).
 *   - The policy only tightens against the merge base (`AFD_BASE` / `origin/main`): `limit` may
 *     not rise, no new file may join `grandfathered` (unless newly covered by a lowered `limit`),
 *     and no existing ceiling may rise.
 *
 * Usage:
 *   node scripts/check-file-size.mjs [--policy <path>] [<file>...]
 * Exit code 1 = violations found.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// ─── Config ──────────────────────────────────────────────────────────────────

export const DEFAULT_WARN_THRESHOLD = 500;
export const DEFAULT_ERROR_THRESHOLD = 1500;
export const DEFAULT_POLICY_PATH = 'scripts/policy/file-size-limits.json';

const SOURCE_ROOTS = [
	'packages',
	'python',
	'alfred',
	'foundations',
	'integrations',
	'endpoints',
	'scripts',
	'spec',
	'site',
	// Only the skills: .claude/worktrees/ holds whole nested checkouts of the repository.
	'.claude/skills',
];
const SOURCE_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.mjs',
	'.cjs',
	'.rs',
	'.py',
	'.cpp',
	'.hpp',
]);

// Directories skipped anywhere in a path (outputs, dependencies, generated, language test trees).
const SKIP_SEGMENTS = new Set([
	'node_modules',
	'dist',
	'build',
	'target',
	'.venv',
	'__pycache__',
	'coverage',
	'temp',
	'_generated',
	'generated',
	'tests',
	'test',
	'__tests__',
	'fixtures',
	'benches',
	'benchmarks',
	'fuzz',
]);

// Upstream Microsoft FAST source tracked via three-way merge; AFD-authored code in imported
// families (violet-elements, violet, specimen, botcore, health) is checked.
const UPSTREAM_PREFIXES = ['foundations/fast-af/packages/element'];
// Bundles written by scripts/build-site-*.mjs, not authored code.
const GENERATED_PREFIXES = ['site/js/vendor'];

// ─── Path rules ──────────────────────────────────────────────────────────────

function toPosix(filePath, root = process.cwd()) {
	const raw = normalize(filePath).replace(/\\/g, '/');
	if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) {
		return relative(root, filePath).replace(/\\/g, '/');
	}
	return raw.replace(/^\.\//, '');
}

function isSkippedDirectory(workspacePath) {
	const normalized = workspacePath.replace(/\\/g, '/').replace(/^\.\//, '');
	if (
		[...UPSTREAM_PREFIXES, ...GENERATED_PREFIXES].some(
			(prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
		)
	) {
		return true;
	}
	return normalized.split('/').some((segment) => SKIP_SEGMENTS.has(segment));
}

function isLanguageTestFile(name, ext) {
	if (
		/\.(?:stories|test|spec)\.[cm]?[jt]sx?$/.test(name) ||
		/\.d\.[cm]?ts$/.test(name) ||
		/\.generated\.[cm]?[jt]sx?$/.test(name) ||
		/\.min\.js$/.test(name)
	) {
		return true;
	}
	if (ext === '.py' && (/^test_.*\.py$/.test(name) || /_test\.py$/.test(name))) {
		return true;
	}
	if (ext === '.rs' && (/^tests\.rs$/.test(name) || /_tests?\.rs$/.test(name))) {
		return true;
	}
	if ((ext === '.cpp' || ext === '.hpp') && /_test\.(?:cpp|hpp)$/.test(name)) {
		return true;
	}
	return false;
}

export function shouldSkip(filePath, root = process.cwd()) {
	const normalized = toPosix(filePath, root);
	const name = basename(normalized);
	const ext = extname(normalized);

	if (!SOURCE_EXTENSIONS.has(ext)) {
		return true;
	}
	if (isLanguageTestFile(name, ext)) return true;
	if (isSkippedDirectory(normalized)) return true;
	// Staged mode is handed any changed file, a merge's included; only the roots a full scan walks
	// are in scope, so both modes agree on what is checked.
	if (!SOURCE_ROOTS.some((sourceRoot) => normalized.startsWith(`${sourceRoot}/`))) return true;

	return false;
}

/** Count physical lines (a trailing newline ends the last line rather than starting an extra one). */
export function countLines(content) {
	if (content.length === 0) return 0;
	const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
	return trimmed.split('\n').length;
}

/** Discover source files for full-repository checks. */
export function discoverFiles(root = process.cwd()) {
	const files = [];

	function visit(directory) {
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const absolute = join(directory, entry.name);
			const workspacePath = relative(root, absolute).replace(/\\/g, '/');
			if (entry.isDirectory()) {
				if (!isSkippedDirectory(workspacePath)) visit(absolute);
			} else if (entry.isFile() && !shouldSkip(workspacePath, root)) {
				files.push(workspacePath);
			}
		}
	}

	for (const sourceRoot of SOURCE_ROOTS) visit(resolve(root, sourceRoot));
	return files.sort();
}

// ─── Policy ──────────────────────────────────────────────────────────────────

function loadPolicy(root, policyPath, explicitPolicy, errors) {
	const absolute = resolve(root, policyPath);
	if (!existsSync(absolute)) {
		if (explicitPolicy) {
			errors.push(`${policyPath}: policy file is missing`);
			return null;
		}
		return {
			warn: DEFAULT_WARN_THRESHOLD,
			limit: DEFAULT_ERROR_THRESHOLD,
			grandfathered: [],
			present: false,
		};
	}

	let parsed;
	try {
		parsed = JSON.parse(readFileSync(absolute, 'utf8'));
	} catch (error) {
		errors.push(`${policyPath}: not valid JSON (${error.message})`);
		return null;
	}

	const warn = parsed.warn ?? DEFAULT_WARN_THRESHOLD;
	const limit = parsed.limit ?? DEFAULT_ERROR_THRESHOLD;
	if (!Number.isInteger(warn) || warn < 1) {
		errors.push(`${policyPath}: "warn" must be a positive integer`);
	}
	if (!Number.isInteger(limit) || limit < 1) {
		errors.push(`${policyPath}: "limit" must be a positive integer`);
	}
	if (Number.isInteger(warn) && Number.isInteger(limit) && warn >= limit) {
		errors.push(`${policyPath}: "warn" (${warn}) must be below "limit" (${limit})`);
	}
	if (!Array.isArray(parsed.grandfathered)) {
		errors.push(`${policyPath}: "grandfathered" must be a list`);
		return null;
	}

	const seen = new Set();
	for (const entry of parsed.grandfathered) {
		const where = `${policyPath}: grandfathered ${JSON.stringify(entry?.file ?? entry)}`;
		if (typeof entry?.file !== 'string' || !entry.file.trim()) {
			errors.push(`${where}: needs a non-empty "file"`);
			continue;
		}
		if (seen.has(entry.file)) {
			errors.push(`${where}: duplicate grandfathered entry`);
		}
		seen.add(entry.file);
		if (!Number.isInteger(entry?.lines) || entry.lines <= limit) {
			errors.push(`${where}: "lines" must be an integer greater than limit (${limit})`);
		}
		if (typeof entry?.reason !== 'string' || !entry.reason.trim()) {
			errors.push(`${where}: needs a non-empty "reason"`);
		}
	}

	return errors.length > 0
		? null
		: { warn, limit, grandfathered: parsed.grandfathered, present: true };
}

function readBasePolicy(root, policyPath) {
	const git = (gitArgs) =>
		execFileSync('git', gitArgs, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	let top;
	try {
		top = git(['rev-parse', '--show-toplevel']).trim();
	} catch {
		return { unread: 'not a git repository' };
	}
	const refs = [process.env.AFD_BASE, 'origin/main', 'main'].filter(
		(ref) => ref && !/^0+$/.test(ref)
	);
	let base = null;
	for (const ref of refs) {
		try {
			base = git(['merge-base', ref, 'HEAD']).trim();
			break;
		} catch {}
	}
	if (!base) return { unread: `none of ${refs.join(', ')} has a merge base with HEAD` };
	const rel = relative(resolve(top), resolve(root, policyPath)).split(sep).join('/');
	try {
		git(['cat-file', '-e', `${base}:${rel}`]);
	} catch {
		return { base, policy: null };
	}
	try {
		return { base, policy: JSON.parse(git(['show', `${base}:${rel}`])) };
	} catch (error) {
		return { unread: `${rel} at ${base.slice(0, 8)} is not JSON (${error.message})` };
	}
}

/** Refuses a policy looser than the merge base's: the grandfathered list may only shrink. */
function checkPolicyTightens(root, policyPath, policy, errors, notes) {
	const found = readBasePolicy(root, policyPath);
	if (found.unread) {
		if (!policy.present) return;
		const note = `the policy was not compared with its merge base: ${found.unread}`;
		if (process.env.CI) errors.push(`${policyPath}: ${note}`);
		else notes.push(`check-file-size: note: ${note}`);
		return;
	}
	const before = found.policy;
	if (!before || !Array.isArray(before.grandfathered)) return;
	const at = `the merge base ${found.base.slice(0, 8)}`;

	if (!policy.present) {
		errors.push(
			`${policyPath}: policy file was removed since ${at}; keep it or tighten thresholds`
		);
		return;
	}
	if (Number.isInteger(before.warn) && policy.warn > before.warn) {
		errors.push(
			`${policyPath}: "warn" rose from ${before.warn} to ${policy.warn} since ${at}; it only comes down`
		);
	}
	if (Number.isInteger(before.limit) && policy.limit > before.limit) {
		errors.push(
			`${policyPath}: "limit" rose from ${before.limit} to ${policy.limit} since ${at}; it only comes down`
		);
	}
	const lowered = Number.isInteger(before.limit) && policy.limit < before.limit;
	const beforeByFile = new Map(before.grandfathered.map((entry) => [entry.file, entry]));

	for (const entry of policy.grandfathered) {
		const prev = beforeByFile.get(entry.file);
		if (prev) {
			if (entry.lines > prev.lines) {
				errors.push(
					`${policyPath}: grandfathered ceiling for ${entry.file} rose from ${prev.lines} to ${entry.lines} since ${at}; split the file instead`
				);
			}
			continue;
		}
		if (lowered && entry.lines <= before.limit) continue;
		errors.push(
			`${policyPath}: ${entry.file} was added to "grandfathered" since ${at}; the list may only shrink — split the file instead`
		);
	}
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export function checkFileSizes({
	root = process.cwd(),
	files = [],
	policyPath = DEFAULT_POLICY_PATH,
	explicitPolicy = false,
} = {}) {
	const policyErrors = [];
	const notes = [];
	const policy = loadPolicy(root, policyPath, explicitPolicy, policyErrors);
	if (!policy) {
		return {
			violations: policyErrors.map((message) => ({ file: policyPath, message })),
			warnings: [],
			notes,
			checkedFiles: 0,
		};
	}

	const stagedMode = files.length > 0;
	const targets = stagedMode ? files : discoverFiles(root);
	const grandfatheredMap = new Map(policy.grandfathered.map((entry) => [entry.file, entry]));
	const violations = [];
	const warnings = [];
	let checkedFiles = 0;

	// Reconcile every grandfathered entry on full scans so stale or recovered entries fail loudly.
	if (!stagedMode) {
		for (const entry of policy.grandfathered) {
			const fullPath = resolve(root, entry.file);
			if (!existsSync(fullPath)) {
				violations.push({
					file: entry.file,
					rule: `Grandfathered file is missing; delete its entry from ${policyPath}`,
					suggestion: `Remove ${entry.file} from ${policyPath}.`,
				});
				continue;
			}
			if (shouldSkip(entry.file, root)) {
				violations.push({
					file: entry.file,
					rule: `Grandfathered file is skipped by size rules; delete its entry from ${policyPath}`,
					suggestion: `Remove ${entry.file} from ${policyPath}.`,
				});
			}
		}
	}

	for (const filePath of targets) {
		const normalized = toPosix(filePath, root);
		if (shouldSkip(normalized, root)) continue;

		let content;
		try {
			content = readFileSync(resolve(root, normalized), 'utf8');
		} catch {
			continue;
		}

		const lineCount = countLines(content);
		checkedFiles++;

		const exempt = grandfatheredMap.get(normalized);
		if (exempt) {
			if (lineCount <= policy.limit) {
				violations.push({
					file: normalized,
					lineCount,
					rule: `Grandfathered file is now ${lineCount} lines (within the ${policy.limit}-line limit); delete its entry from ${policyPath}`,
					suggestion: `Remove ${normalized} from ${policyPath} to lock in the reduction.`,
				});
			} else if (lineCount > exempt.lines) {
				violations.push({
					file: normalized,
					lineCount,
					rule: `Grandfathered file grew past its frozen ceiling of ${exempt.lines} lines`,
					suggestion: `Keep ${normalized} at or under ${exempt.lines} lines, or split it below ${policy.limit} lines.`,
				});
			}
			continue;
		}

		if (lineCount > policy.limit) {
			violations.push({
				file: normalized,
				lineCount,
				rule: `File exceeds ${policy.limit} lines`,
				suggestion:
					'Split it by responsibility: past this size it grew unchecked. Name the seam: what moves, and what stays',
			});
		} else if (lineCount > policy.warn) {
			warnings.push({
				file: normalized,
				lineCount,
				rule: `Over the ${policy.warn}-line review threshold`,
				suggestion: `No action needed in this change: the sweep-bloat skill ranks it. Blocks only past ${policy.limit} lines.`,
			});
		}
	}

	if (!stagedMode) {
		const tightenErrors = [];
		checkPolicyTightens(root, policyPath, policy, tightenErrors, notes);
		for (const message of tightenErrors) {
			violations.push({ file: policyPath, message });
		}
	}

	return { violations, warnings, notes, checkedFiles };
}

function parseCli(argv) {
	let policyPath = DEFAULT_POLICY_PATH;
	let explicitPolicy = false;
	const files = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--policy') {
			policyPath = argv[++i];
			explicitPolicy = true;
		} else {
			files.push(argv[i]);
		}
	}
	return { policyPath, explicitPolicy, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const { policyPath, explicitPolicy, files } = parseCli(process.argv.slice(2));
	const result = checkFileSizes({ root: process.cwd(), files, policyPath, explicitPolicy });

	for (const note of result.notes) console.log(note);

	const MAX_PRINTED_WARNINGS = 20;
	const printedWarnings =
		files.length > 0 || result.warnings.length <= MAX_PRINTED_WARNINGS
			? result.warnings
			: [...result.warnings].sort((a, b) => b.lineCount - a.lineCount).slice(0, 10);
	for (const warning of printedWarnings) {
		console.warn(`  ⚠ ${basename(warning.file)}  ${warning.rule}`);
		console.warn(`    ${warning.file} (${warning.lineCount} lines)`);
		console.warn(`    💡 ${warning.suggestion}\n`);
	}
	if (printedWarnings.length < result.warnings.length) {
		console.warn(
			`  … and ${result.warnings.length - printedWarnings.length} more file(s) over the 500-line review threshold (non-blocking; sweep-bloat ranks them)\n`
		);
	}

	for (const violation of result.violations) {
		if (violation.message) {
			console.error(`  ✘ ${violation.message}\n`);
		} else {
			console.error(`  ✘ ${basename(violation.file)}  ${violation.rule}`);
			if (violation.lineCount !== undefined) {
				console.error(`    ${violation.file} (${violation.lineCount} lines)`);
			} else {
				console.error(`    ${violation.file}`);
			}
			console.error(`    💡 ${violation.suggestion}\n`);
		}
	}

	if (result.checkedFiles > 0 && result.warnings.length > 0) {
		console.warn(`\n  ⚠ ${result.warnings.length} file size warning(s) (non-blocking)`);
	}

	if (result.violations.length > 0) {
		console.error(
			`\n  ✘ ${result.violations.length} file size violation(s) across ${result.checkedFiles} file(s) checked`
		);
		process.exit(1);
	}
}
