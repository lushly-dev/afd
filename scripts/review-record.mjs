#!/usr/bin/env node
/**
 * A record of the review of one exact commit, and the rule the software factory's lane accepts it by.
 *
 * `prepare-pr`'s lane mode writes it after the review converges and the work is committed:
 *
 *   node scripts/review-record.mjs write --lanes '[{"lane":"general","model":"...","effort":"high",
 *     "verdict":"pass","fixed":2,"deferred":0}]'
 *
 * Each lane has the shape of the factory gateway's `review-record` (lane, model, effort, verdict,
 * fixed, deferred), so moving to the gateway changes where the record is kept, not what it says.
 * The record lives in the worktree's own git directory, where it cannot be committed, and is bound
 * to the commit and tree reviewed. `lane-enqueue` runs the adapter's `review_evidence`,
 *
 *   node scripts/review-record.mjs verify --head <sha> --worktree <path>
 *
 * which passes only for a passing review of that exact, checked-out, clean commit in that worktree
 * (without `--worktree`, the checkout this script is in), and exits `REFUSED` (3) otherwise. The lane runs it again before each
 * validation, from its own checkout of the base, so a branch that edits this script cannot pass
 * its own review (lushly-dev/afd#1308). A commit made
 * after the review (a fix, a base merge) has no record until the review is recorded again. As
 * with the gateway, the verdicts are the cell's own report of its reviewers: typed and bound to
 * the head, not proven.
 */
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 1;
/**
 * `verify`'s exit code for a refused review. Any other non-zero exit (a crash, a usage error,
 * Node's own exit 1 for a missing or broken script) means the verifier failed, which the lane
 * treats as its own trouble rather than the branch's (lushly-dev/afd#1308).
 */
export const REFUSED = 3;
/** affected/scope.mjs's DEFAULT_BASES, kept here so the script stands alone (a test pins them). */
export const DEFAULT_BASES = ['origin/main', 'main'];
const SHA = /^[0-9a-f]{40}$/;
const LANE_KEYS = ['lane', 'model', 'effort', 'verdict', 'fixed', 'deferred'];
/** A lane named self, Self or self-review is the session's own review, not an independent one. */
const isSelf = (lane) => /^self(-?review)?$/i.test(lane.lane.trim());

/**
 * Where this worktree keeps its record: inside its git directory, never in the tree.
 *
 * Git answers `--git-path` relative to the checkout `git` runs in (`.git/...` in a primary clone),
 * so ask for an absolute path: resolving a relative answer against `root` would read this
 * checkout's record for a `git` that runs in another one (#2659).
 */
export function recordPath(git, root) {
	return resolve(
		root,
		git(['rev-parse', '--path-format=absolute', '--git-path', 'afd-review-record.json']).trim()
	);
}

/** The commit, tree, branch, merge base with the default base, and whether the checkout is clean. */
export function currentIdentity(git) {
	let base = null;
	for (const ref of DEFAULT_BASES)
		try {
			base = git(['merge-base', ref, 'HEAD']).trim();
			break;
		} catch {}
	let branch = null;
	try {
		branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim() || null;
	} catch {}
	return {
		head: git(['rev-parse', 'HEAD']).trim(),
		tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
		branch,
		base,
		clean: git(['status', '--porcelain', '--untracked-files=normal']).trim() === '',
	};
}

const text = (value) =>
	typeof value === 'string' && value.trim() !== '' && value.length <= 100 && !/[\r\n]/.test(value);
const count = (value) => Number.isInteger(value) && value >= 0;

/** The lanes as given, or why they cannot be recorded. */
export function checkLanes(lanes) {
	if (!Array.isArray(lanes) || lanes.length === 0)
		return { reason: 'name at least one review lane' };
	for (const [index, lane] of lanes.entries()) {
		const where = `lane ${index + 1}`;
		if (!lane || typeof lane !== 'object' || Array.isArray(lane))
			return { reason: `${where} is not an object` };
		const extra = Object.keys(lane).filter((key) => !LANE_KEYS.includes(key));
		if (extra.length) return { reason: `${where} has unknown keys: ${extra.join(', ')}` };
		for (const key of ['lane', 'model', 'effort'])
			if (!text(lane[key])) return { reason: `${where} needs ${key}: one line of text` };
		if (lane.verdict !== 'pass' && lane.verdict !== 'fail')
			return { reason: `${where}'s verdict must be "pass" or "fail"` };
		for (const key of ['fixed', 'deferred'])
			if (lane[key] !== undefined && !count(lane[key]))
				return { reason: `${where}'s ${key} must be a whole number of findings` };
	}
	const names = lanes.map((lane) => lane.lane);
	if (new Set(names).size !== names.length) return { reason: 'each lane may appear once' };
	return {
		lanes: lanes.map((lane) => ({ fixed: 0, deferred: 0, ...lane })),
	};
}

/** The record for a review of the checked-out commit, or why none may be written. */
export function buildRecord({ identity, lanes, now = Date.now() }) {
	if (!identity.clean)
		return { reason: 'the checkout has uncommitted changes: commit the reviewed work first' };
	const checked = checkLanes(lanes);
	if (checked.reason) return checked;
	const passed = checked.lanes.every((lane) => lane.verdict === 'pass');
	if (passed && checked.lanes.every(isSelf))
		return {
			reason: 'a self-review alone is not a passing review: record an independent lane too',
		};
	return {
		record: {
			schema: SCHEMA,
			head: identity.head,
			tree: identity.tree,
			branch: identity.branch,
			base: identity.base,
			verdict: passed ? 'pass' : 'fail',
			lanes: checked.lanes,
			recordedAt: new Date(now).toISOString(),
		},
	};
}

/** Whether the record shows a passing review of `head`, the clean, checked-out commit. */
export function acceptRecord({ record, identity, head }) {
	const reject = (reason) => ({ accepted: false, reason });
	if (!SHA.test(head ?? '')) return reject('--head must be a full 40-character commit id');
	if (identity.head !== head) return reject(`the checkout is at ${identity.head}, not ${head}`);
	if (!identity.clean) return reject('the checkout has uncommitted changes');
	if (!record) return reject('no review is recorded in this worktree');
	if (record.schema !== SCHEMA) return reject('the review record has another schema');
	if (record.head !== head) return reject(`the review recorded is of ${record.head}, not ${head}`);
	if (record.tree !== identity.tree) return reject('the review recorded is of another tree');
	if (record.verdict !== 'pass') return reject('the review recorded did not pass');
	const checked = checkLanes(record.lanes);
	if (checked.reason) return reject(`the review record is malformed: ${checked.reason}`);
	if (!checked.lanes.every((lane) => lane.verdict === 'pass'))
		return reject('a review lane recorded did not pass');
	if (checked.lanes.every(isSelf)) return reject('only a self-review is recorded');
	const lanes = checked.lanes.map((lane) => `${lane.lane} (${lane.model}, ${lane.effort})`);
	return {
		accepted: true,
		reason: `${head} was reviewed at ${record.recordedAt}: ${lanes.join(', ')}`,
	};
}

export function writeRecord(path, record) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(record, null, '\t')}\n`);
	renameSync(temporary, path);
}

export function readRecord(path) {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, 'utf8'));
}

const USAGE = `Usage:
  node scripts/review-record.mjs write --lanes '<JSON array of {lane, model, effort, verdict, fixed?, deferred?}>'
  node scripts/review-record.mjs write --lanes-file <path to that JSON>   (portable to Windows shells)
  node scripts/review-record.mjs verify --head <40-character commit id> [--worktree <path>]
  node scripts/review-record.mjs show`;

/**
 * Runs one command; returns `{ code, out }` so tests need no process. `gitAt(dir)` gives the git
 * runner for another checkout, which `verify --worktree` reads instead of `root`.
 */
export function run(argv, { git, root, gitAt, now = Date.now() }) {
	const [command, ...rest] = argv;
	const options = {};
	for (let i = 0; i < rest.length; i += 2) {
		const [key, value] = [rest[i], rest[i + 1]];
		if (!key?.startsWith('--') || value === undefined)
			return { code: 2, out: `review-record: expected --name value pairs\n${USAGE}` };
		options[key.slice(2)] = value;
	}
	const commands = { write: ['lanes', 'lanes-file'], verify: ['head', 'worktree'], show: [] };
	if (!Object.hasOwn(commands, command)) return { code: 2, out: USAGE };
	const allowed = commands[command];
	const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
	if (unknown.length)
		return { code: 2, out: `review-record: unknown option --${unknown[0]}\n${USAGE}` };
	if (options.worktree !== undefined) {
		if (!gitAt) return { code: 2, out: 'review-record: --worktree cannot be read here' };
		root = resolve(root, options.worktree);
		git = gitAt(root);
	}
	const path = recordPath(git, root);
	if (command === 'show') {
		let record = null;
		try {
			record = readRecord(path);
		} catch (error) {
			return { code: 1, out: `review-record: the record could not be read: ${error.message}` };
		}
		return record
			? { code: 0, out: JSON.stringify(record, null, '\t') }
			: { code: 1, out: 'review-record: no review is recorded in this worktree' };
	}
	const identity = currentIdentity(git);
	if (command === 'verify') {
		let record = null;
		try {
			record = readRecord(path);
		} catch (error) {
			return {
				code: REFUSED,
				out: `review-record: the record could not be read: ${error.message}`,
			};
		}
		const { accepted, reason } = acceptRecord({ record, identity, head: options.head });
		return { code: accepted ? 0 : REFUSED, out: `review-record: ${reason}` };
	}
	if ((options.lanes === undefined) === (options['lanes-file'] === undefined))
		return { code: 2, out: `review-record: write needs one of --lanes or --lanes-file\n${USAGE}` };
	const source = options.lanes === undefined ? '--lanes-file' : '--lanes';
	let lanes;
	try {
		lanes = JSON.parse(
			options.lanes ?? readFileSync(resolve(process.cwd(), options['lanes-file']), 'utf8')
		);
	} catch (error) {
		return { code: 2, out: `review-record: ${source} is not readable JSON: ${error.message}` };
	}
	const built = buildRecord({ identity, lanes, now });
	if (built.reason) return { code: 1, out: `review-record: not recorded: ${built.reason}` };
	writeRecord(path, built.record);
	return {
		code: built.record.verdict === 'pass' ? 0 : 1,
		out: `review-record: recorded a ${built.record.verdict} review of ${built.record.head}`,
	};
}

/** Whether node was started on this file. Real paths, so a symlink or junction cannot skip the CLI. */
function isEntry() {
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (process.argv[1] && isEntry()) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const gitAt = (cwd) => (args) =>
		execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	try {
		const { code, out } = run(process.argv.slice(2), { git: gitAt(root), root, gitAt });
		(code === 0 ? console.log : console.error)(out);
		process.exitCode = code;
	} catch (error) {
		const first = String(error.stderr || error.message)
			.trim()
			.split('\n')[0];
		console.error(`review-record: ${first}`);
		process.exitCode = 1;
	}
} else if (process.argv[1]?.endsWith('review-record.mjs')) {
	// Started as this script, yet not recognised as it: refuse rather than exit 0 silently.
	console.error('review-record: could not confirm this file is the script node started');
	process.exitCode = 1;
}
