#!/usr/bin/env node

/**
 * Claim AFD issues before working on them, so no two sessions (or a session and a factory
 * cell) take the same one.
 *
 * Usage:
 *   node scripts/issue-claim.mjs check <n>... [--json]
 *   node scripts/issue-claim.mjs claim <n>... [--hours 24] [--branch <name>] [--machine <name>]
 *   node scripts/issue-claim.mjs release <n>... [--reason <text>] [--force] [--closed-only]
 *   node scripts/issue-claim.mjs stale [--json]
 *
 * Every agent works through one GitHub account, so an assignee cannot say which session holds
 * an issue. A claim is the `status:in-progress` label plus a claim comment in the software
 * factory's own format (botcore_factory/claims.py: a `botcore-factory:claim` marker naming the
 * branch, the machine and when the lease runs out; extra keys record the session and the
 * status the claim replaced). A session's claim and a factory cell's are therefore one lock:
 * `cell-register` refuses an issue a session holds, and this script reports one a cell holds.
 * Change the format in both places.
 *
 * An issue is held while it carries the label and its claim's lease has not run out, or the
 * claim's branch has an open PR. The label with no claim comment (set by hand) is held by an
 * unknown holder until the issue has been quiet for the lease length. An open PR that would
 * close the issue holds it too. A claim by the same branch or session is the caller's own:
 * claiming it again renews the lease, on the current branch.
 *
 * `claim` takes several issues all or nothing: if any is held by someone else it claims none,
 * and a failed write puts back what the call claimed. It labels first (the factory refuses a
 * labelled issue), then comments, then reads back: if another claim landed first it releases
 * its own (the earliest standing claim wins). The factory does not read back, so a cell that
 * read the issue before the label landed can still claim beside it; that window is a single
 * GitHub write. On a closed issue, `release` ends standing claims and removes the claim label.
 * With `--closed-only`, it skips open issues. Otherwise, on an open issue
 * it restores the status the claim replaced (else `status:planned` with
 * an execution profile, `status:triage` without) and refuses another holder's live claim
 * without `--force`. `stale` lists claimed issues whose holder has gone quiet.
 *
 * Exit codes: 0 done (free, the caller's own, or nothing to do); 3 held by someone else;
 * 1 usage or a failed gh call. Without a working `gh` login it says so and exits 1: a
 * claim that could not be checked is not a free issue.
 */

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IN_PROGRESS = 'status:in-progress';
const PLANNED = 'status:planned';
const TRIAGE = 'status:triage';
export const EXIT_HELD = 3;
const EXIT_ERROR = 1;
const DEFAULT_HOURS = 24; // the factory's claims.leaseHours default
const HOUR = 3_600_000;
const COMMANDS = ['check', 'claim', 'release', 'stale'];

// ---------- the claim format, shared with botcore_factory/claims.py ----------

const MARKER = /<!--\s*botcore-factory:(claim|release)\s+(\{.*?\})\s*-->/s;
const SAFE = /^[\w.:@/+-]{1,128}$/;

/** Python's json.dumps(sort_keys=True), so a claim reads the same whichever side wrote it. */
function pyJson(data) {
	const keys = Object.keys(data)
		.filter((k) => data[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(data[k])}`).join(', ')}}`;
}

/** `status` is the label the claim replaced, so a release can put it back. */
export function claimBody(me, leaseUntil, status) {
	const marker = pyJson({
		branch: me.branch,
		machine: me.machine,
		leaseUntil,
		session: me.session,
		status: status ?? undefined,
	});
	return (
		`<!-- botcore-factory:claim ${marker} -->\n` +
		`Claimed by session \`${me.session}\` for branch \`${me.branch}\` on \`${me.machine}\`; ` +
		`the lease runs until ${leaseUntil}.`
	);
}

export function releaseBody(branch, reason) {
	const target = branch ? `\`${branch}\`` : 'all claims';
	return `<!-- botcore-factory:release ${pyJson({ branch })} -->\nReleased ${target}: ${reason}`;
}

/** Claim and release events, in posted order. Marker fields are untrusted: plain values only. */
function events(comments) {
	const out = [];
	comments.forEach((comment, index) => {
		const match = MARKER.exec(comment.body ?? '');
		if (!match) return;
		let data;
		try {
			data = JSON.parse(match[2]);
		} catch {
			return;
		}
		if (!data || typeof data !== 'object') return;
		const kind = match[1];
		if (kind === 'release') {
			if (data.branch === undefined || SAFE.test(data.branch))
				out.push({ kind, branch: data.branch, index });
			return;
		}
		const { branch, machine, leaseUntil, session, status } = data;
		if (![branch, machine].every((v) => typeof v === 'string' && SAFE.test(v))) return;
		if (!Number.isFinite(Date.parse(leaseUntil))) return;
		out.push({
			kind,
			branch,
			machine,
			leaseUntil,
			session: typeof session === 'string' && SAFE.test(session) ? session : undefined,
			status:
				typeof status === 'string' && /^status:[a-z-]{1,40}$/.test(status) && status !== IN_PROGRESS
					? status
					: undefined,
			index,
			postedAt: comment.createdAt,
		});
	});
	return out;
}

/** Claims still standing, oldest first: a release ends its branch's claims (or all, unnamed). */
export function standingClaims(comments) {
	const standing = [];
	for (const event of events(comments)) {
		if (event.kind === 'claim') standing.push(event);
		else
			for (let i = standing.length - 1; i >= 0; i--)
				if (event.branch === undefined || standing[i].branch === event.branch)
					standing.splice(i, 1);
	}
	return standing;
}

const mineOf = (claim, me) =>
	Boolean(me) &&
	(claim.branch === me.branch || (claim.session !== undefined && claim.session === me.session));
const describe = (c) =>
	`${c.session ? `session ${c.session}, ` : ''}branch ${c.branch} on ${c.machine}, lease until ${c.leaseUntil}`;

/** An open PR that would close the issue, as the factory's dispatch counts it. */
const closes = (pr, number) =>
	(pr.closingIssuesReferences ?? []).some((ref) => ref.number === number);

/**
 * Who holds an issue. `issue` is gh's {number, state, labels, comments, updatedAt}; `prs` the
 * repository's open PRs {number, headRefName, closingIssuesReferences}.
 */
export function evaluate({ issue, prs, me, now, hours = DEFAULT_HOURS }) {
	if (issue.state === 'CLOSED') return { state: 'closed' };
	const hasLabel = issue.labels.some((l) => l.name === IN_PROGRESS);
	const branchPr = (branch) => prs.find((pr) => pr.headRefName === branch);
	const live = (c) => Date.parse(c.leaseUntil) > now || Boolean(branchPr(c.branch));
	const claims = hasLabel ? standingClaims(issue.comments ?? []) : [];
	const holder = claims.find(live);
	if (holder)
		return {
			state: mineOf(holder, me) ? 'mine' : 'held',
			holder,
			pr: branchPr(holder.branch)?.number,
		};
	const namingPr = prs.find((pr) => pr.headRefName !== me?.branch && closes(pr, issue.number));
	if (namingPr) return { state: 'held', pr: namingPr.number, by: 'pr' };
	if (claims.length) return { state: 'stale', holder: claims.at(-1) };
	if (hasLabel) {
		const quiet = now - Date.parse(issue.updatedAt) > hours * HOUR;
		return { state: quiet ? 'stale' : 'held', by: 'label' };
	}
	return { state: 'free' };
}

export function sentence(number, e) {
	switch (e.state) {
		case 'closed':
			return `#${number}: closed, nothing to claim`;
		case 'free':
			return `#${number}: free`;
		case 'mine':
			return `#${number}: yours (${describe(e.holder)})`;
		case 'stale':
			return `#${number}: stale claim (${e.holder ? describe(e.holder) : `${IN_PROGRESS} with no claim comment, quiet`}): free to take`;
		default:
			if (e.by === 'pr') return `#${number}: held by open PR #${e.pr}`;
			if (e.by === 'label')
				return `#${number}: held by an unknown holder (${IN_PROGRESS} with no claim comment)`;
			return `#${number}: held by ${describe(e.holder)}${e.pr ? `, open PR #${e.pr}` : ''}`;
	}
}

// ---------- I/O ----------

function defaultGh(args) {
	return execFileSync('gh', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 60_000,
	});
}

function defaultGit(args) {
	// A hook's GIT_DIR or GIT_INDEX_FILE would point git at another checkout.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))
	);
	return execFileSync('git', args, {
		encoding: 'utf8',
		env,
		stdio: ['ignore', 'pipe', 'ignore'],
		timeout: 30_000,
	}).trim();
}

const clean = (v) =>
	String(v ?? '')
		.replace(/[^\w.:@/+-]/g, '-')
		.slice(0, 128) || 'unknown';

/** The caller: branch from git, machine from the host name, session from the harness. */
export function identity(flags, { env, git, host }) {
	let branch = flags.branch;
	if (!branch) {
		try {
			branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
		} catch {
			branch = 'unknown';
		}
	}
	const machine = flags.machine ?? host;
	const session =
		flags.session ??
		env.T3CODE_THREAD_ID ??
		env.CLAUDE_CODE_SESSION_ID ??
		env.CODEX_THREAD_ID ??
		`${machine}:${branch}`;
	return { branch: clean(branch), machine: clean(machine), session: clean(session) };
}

function makeContext(deps, flags) {
	const gh = deps.gh ?? defaultGh;
	const repo = flags.repo ? ['--repo', flags.repo] : [];
	let prs;
	return {
		gh,
		log: deps.log ?? console.log,
		error: deps.error ?? console.error,
		now: deps.now ?? (() => Date.now()),
		hours: Number(flags.hours ?? DEFAULT_HOURS),
		me: identity(flags, {
			env: deps.env ?? process.env,
			git: deps.git ?? defaultGit,
			host: deps.host ?? hostname(),
		}),
		issue: (n) =>
			JSON.parse(
				gh([
					'issue',
					'view',
					String(n),
					...repo,
					'--json',
					'number,title,state,labels,comments,updatedAt',
				])
			),
		prs: () =>
			(prs ??= JSON.parse(
				gh([
					'pr',
					'list',
					...repo,
					'--state',
					'open',
					'--limit',
					'300',
					'--json',
					'number,headRefName,closingIssuesReferences',
				])
			)),
		list: () =>
			JSON.parse(
				gh([
					'issue',
					'list',
					...repo,
					'--state',
					'open',
					'--label',
					IN_PROGRESS,
					'--limit',
					'300',
					'--json',
					'number,title',
				])
			),
		edit: (n, add, remove) =>
			gh([
				'issue',
				'edit',
				String(n),
				...repo,
				...(add ? ['--add-label', add] : []),
				...(remove.length ? ['--remove-label', remove.join(',')] : []),
			]),
		comment: (n, body) => gh(['issue', 'comment', String(n), ...repo, '--body', body]),
	};
}

const evaluateNumber = (ctx, n, issue = ctx.issue(n)) => {
	return {
		issue,
		e: evaluate({ issue, prs: ctx.prs(), me: ctx.me, now: ctx.now(), hours: ctx.hours }),
	};
};

// ---------- commands ----------

function runCheck(ctx, numbers, flags) {
	const rows = numbers.map((n) => ({ number: n, ...evaluateNumber(ctx, n).e }));
	if (flags.json) ctx.log(JSON.stringify(rows, null, 2));
	else for (const r of rows) ctx.log(sentence(r.number, r));
	return rows.some((r) => r.state === 'held') ? EXIT_HELD : 0;
}

function runClaim(ctx, numbers) {
	const checked = numbers.map((n) => ({ n, ...evaluateNumber(ctx, n) }));
	const held = checked.filter((c) => c.e.state === 'held');
	if (held.length) {
		for (const c of held) ctx.log(sentence(c.n, c.e));
		ctx.log(
			`Claimed none of ${numbers.map((n) => `#${n}`).join(' ')}: take other work, or ask the holder.`
		);
		return EXIT_HELD;
	}
	const leaseUntil = new Date(ctx.now() + ctx.hours * HOUR).toISOString().replace(/\.\d+Z$/, 'Z');
	const all = numbers.map((x) => `#${x}`).join(' ');
	const made = []; // claims this call made, for undoing; a renewal is left as it was
	let step = null;
	try {
		for (const { n, issue, e } of checked) {
			if (e.state === 'closed') {
				ctx.log(sentence(n, e));
				continue;
			}
			const statuses = issue.labels
				.map((l) => l.name)
				.filter((x) => x.startsWith('status:') && x !== IN_PROGRESS);
			const status = (e.state === 'mine' && e.holder.status) || statuses[0] || null;
			step = { n, status, renewal: e.state === 'mine', commented: false };
			// Label first: the factory refuses any labelled issue, so a cell stops seeing it as
			// free before the claim comment lands.
			ctx.edit(n, IN_PROGRESS, statuses);
			ctx.comment(n, claimBody(ctx.me, leaseUntil, status));
			step.commented = true;
			// Only a live claim posted before this one wins; a later one backs off on its own read.
			const standing = standingClaims(ctx.issue(n).comments ?? []);
			const own = standing.findLastIndex((c) => mineOf(c, ctx.me));
			const first = standing.find(
				(c, i) => (own < 0 || i < own) && Date.parse(c.leaseUntil) > ctx.now() && !mineOf(c, ctx.me)
			);
			if (first) {
				// The label stays: it is the winner's now.
				ctx.comment(n, releaseBody(ctx.me.branch, `lost the claim to ${first.branch}`));
				step = null;
				ctx.log(`#${n}: ${describe(first)} claimed it first.`);
				undo(ctx, made, 'a claim in the same set was lost');
				ctx.log(`Claimed none of ${all}.`);
				return EXIT_HELD;
			}
			if (!step.renewal) made.push(step);
			step = null;
			ctx.log(
				`#${n}: ${e.state === 'mine' ? 'renewed' : 'claimed'} for ${ctx.me.branch} until ${leaseUntil}`
			);
		}
	} catch (cause) {
		const left = undo(
			ctx,
			step && !step.renewal ? [...made, step] : made,
			'claiming the set failed'
		);
		const detail = String(cause?.stderr || cause?.message || cause).trim();
		throw new Error(
			`${detail}\nClaimed none of ${all}${left.length ? `; could not put back ${left.join(', ')}: release them by hand` : ''}.`
		);
	}
	return 0;
}

/** Put back claims this call made; returns the issues it could not. */
function undo(ctx, steps, reason) {
	const left = [];
	for (const s of steps) {
		try {
			if (s.commented) ctx.comment(s.n, releaseBody(ctx.me.branch, reason));
			ctx.edit(s.n, s.status ?? PLANNED, [IN_PROGRESS]);
		} catch {
			left.push(`#${s.n}`);
		}
	}
	return left;
}

/** Back to the status the claim replaced, else planned (with an execution profile) or triage. */
function release(ctx, n, reason, issue) {
	const own = standingClaims(issue.comments ?? []).filter((c) => mineOf(c, ctx.me));
	const profiled = issue.labels.some((l) => l.name.startsWith('execution:'));
	const status = own.findLast((c) => c.status)?.status ?? (profiled ? PLANNED : TRIAGE);
	ctx.edit(n, status, [IN_PROGRESS]);
	const branches = new Set([ctx.me.branch, ...own.map((c) => c.branch)]);
	for (const branch of branches) ctx.comment(n, releaseBody(branch, reason));
}

function runRelease(ctx, numbers, flags) {
	const reason = String(flags.reason ?? 'released')
		.replace(/[`\p{Cc}]/gu, "'")
		.slice(0, 300);
	let refused = false;
	for (const n of numbers) {
		const issue = ctx.issue(n);
		if (issue.state === 'CLOSED') {
			if (issue.labels.some((label) => label.name === IN_PROGRESS)) {
				// End old leases before removing the label, or reclaiming after reopen revives them.
				if (standingClaims(issue.comments).length)
					ctx.comment(n, releaseBody(undefined, 'issue closed'));
				ctx.edit(n, null, [IN_PROGRESS]);
				ctx.log(`#${n}: closed, removed ${IN_PROGRESS}`);
			} else {
				ctx.log(`#${n}: closed, nothing to release`);
			}
			continue;
		}
		if (flags['closed-only']) {
			ctx.log(`#${n}: open, skipping closed-issue cleanup`);
			continue;
		}
		const { e } = evaluateNumber(ctx, n, issue);
		if (e.state === 'held' && !flags.force) {
			ctx.log(`${sentence(n, e)}. Not released: pass --force to take another holder's claim away.`);
			refused = true;
			continue;
		}
		if (e.state === 'free' && !issue.labels.some((l) => l.name === IN_PROGRESS)) {
			ctx.log(`#${n}: not claimed, nothing to release`);
			continue;
		}
		const holder = e.holder && !mineOf(e.holder, ctx.me) ? e.holder.branch : null;
		release(ctx, n, reason, issue);
		if (holder) ctx.comment(n, releaseBody(holder, reason));
		ctx.log(`#${n}: released (${reason})`);
	}
	return refused ? EXIT_HELD : 0;
}

function runStale(ctx, flags) {
	const rows = [];
	for (const { number, title } of ctx.list()) {
		const { e } = evaluateNumber(ctx, number);
		if (e.state === 'stale') rows.push({ number, title, holder: e.holder ?? null });
	}
	if (flags.json) ctx.log(JSON.stringify(rows, null, 2));
	else if (!rows.length) ctx.log(`No stale ${IN_PROGRESS} claims.`);
	else
		for (const r of rows)
			ctx.log(
				`#${r.number} ${String(r.title).replace(/\p{Cc}/gu, ' ')}: ${r.holder ? describe(r.holder) : 'no claim comment'}`
			);
	return 0;
}

// ---------- CLI ----------

export function parseArgs(argv) {
	const positionals = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			positionals.push(arg);
			continue;
		}
		const eq = arg.indexOf('=');
		const key = arg.slice(2, eq < 0 ? undefined : eq);
		if (eq >= 0) flags[key] = arg.slice(eq + 1);
		else if (key === 'json' || key === 'force' || key === 'closed-only') flags[key] = true;
		else flags[key] = argv[++i];
	}
	return { positionals, flags };
}

/** Run the CLI; every side effect goes through `deps`, so tests pass a fake gh. Returns the exit code. */
export function run(argv, deps = {}) {
	const { positionals, flags } = parseArgs(argv);
	const [command, ...rest] = positionals;
	const error = deps.error ?? console.error;
	if (!COMMANDS.includes(command ?? '')) {
		error(
			'Usage: issue-claim.mjs <check|claim|release|stale> [<issue>...] [--hours 24] [--reason text] [--force] [--closed-only] [--json]'
		);
		return EXIT_ERROR;
	}
	const numbers = rest.map((v) => Number.parseInt(String(v).replace(/^#/, ''), 10));
	if (command !== 'stale' && (!numbers.length || numbers.some((n) => !(n > 0)))) {
		error(`${command} needs one or more issue numbers.`);
		return EXIT_ERROR;
	}
	if (!(Number(flags.hours ?? DEFAULT_HOURS) > 0)) {
		error('--hours must be a positive number.');
		return EXIT_ERROR;
	}
	try {
		const ctx = makeContext(deps, flags);
		if (command === 'check') return runCheck(ctx, numbers, flags);
		if (command === 'claim') return runClaim(ctx, numbers);
		if (command === 'release') return runRelease(ctx, numbers, flags);
		return runStale(ctx, flags);
	} catch (cause) {
		const detail = String(cause?.stderr || cause?.message || cause).trim();
		error(`issue-claim: ${detail}`);
		if (/auth|login|token/i.test(detail))
			error('Run `gh auth status`: a claim that could not be checked is not a free issue.');
		return EXIT_ERROR;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = run(process.argv.slice(2));
}
