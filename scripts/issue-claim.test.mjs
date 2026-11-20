import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimBody, EXIT_HELD, IN_PROGRESS, run, standingClaims } from './issue-claim.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

// A comment exactly as botcore_factory/claims.py writes it (copied from a live issue).
const factoryClaim = (branch, leaseUntil) =>
	`<!-- botcore-factory:claim {"branch": "${branch}", "leaseUntil": "${leaseUntil}", "machine": "random"} -->\n` +
	`Claimed by the software factory for branch \`${branch}\` on \`random\`; the lease runs until ${leaseUntil}.`;

/** A fake gh over in-memory issues and PRs; `onComment` lets a test land a rival claim. */
function world({ issues = {}, prs = [], onComment, failOn } = {}) {
	const writes = [];
	const store = {};
	for (const [n, i] of Object.entries(issues)) {
		store[n] = {
			number: Number(n),
			title: `Issue ${n}`,
			state: i.state ?? 'OPEN',
			labels: (i.labels ?? ['status:planned', 'execution:bounded']).map((name) => ({ name })),
			comments: (i.comments ?? []).map((body) => ({ body, createdAt: iso(NOW - HOUR) })),
			updatedAt: i.updatedAt ?? iso(NOW - HOUR),
		};
	}
	const gh = (args) => {
		const [noun, verb, n] = args;
		const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
		if (failOn?.(args)) throw Object.assign(new Error('gh failed'), { stderr: 'HTTP 502' });
		if (noun === 'pr') return JSON.stringify(prs);
		if (verb === 'list')
			return JSON.stringify(
				Object.values(store).filter((i) => i.labels.some((l) => l.name === IN_PROGRESS))
			);
		const issue = store[n];
		if (verb === 'view') return JSON.stringify(issue);
		if (verb === 'comment') {
			writes.push({ n: Number(n), comment: flag('--body') });
			issue.comments.push({ body: flag('--body'), createdAt: iso(NOW) });
			onComment?.(issue);
			return '';
		}
		if (verb === 'edit') {
			const remove = flag('--remove-label')?.split(',') ?? [];
			writes.push({ n: Number(n), add: flag('--add-label'), remove });
			issue.labels = issue.labels.filter((l) => !remove.includes(l.name));
			if (flag('--add-label') && !issue.labels.some((l) => l.name === flag('--add-label')))
				issue.labels.push({ name: flag('--add-label') });
			return '';
		}
		throw new Error(`unexpected gh ${args.join(' ')}`);
	};
	const lines = [];
	const deps = {
		gh,
		now: () => NOW,
		host: 'hero',
		env: { T3CODE_THREAD_ID: 'thread-a' },
		git: () => 't3/a',
		log: (s) => lines.push(s),
		error: (s) => lines.push(s),
	};
	const labels = (n) => store[n].labels.map((l) => l.name);
	return { deps, writes, lines, labels, store };
}

test('claim writes the factory format, then the label', () => {
	const w = world({ issues: { 7: {} } });
	assert.equal(run(['claim', '7'], w.deps), 0);
	assert.deepEqual(w.writes[0], { n: 7, add: IN_PROGRESS, remove: ['status:planned'] });
	assert.match(
		w.writes[1].comment,
		/^<!-- botcore-factory:claim \{"branch": "t3\/a", "leaseUntil": "2026-11-20T12:00:00Z", "machine": "hero", "session": "thread-a", "status": "status:planned"\} -->/
	);
	assert.equal(run(['check', '7'], w.deps), 0);
	assert.match(w.lines.at(-1), /#7: yours/);
});

test("a factory cell's live claim holds the issue, and claim writes nothing", () => {
	const w = world({
		issues: {
			8: { labels: [IN_PROGRESS], comments: [factoryClaim('fleet/8-x', iso(NOW + HOUR))] },
		},
	});
	assert.equal(run(['check', '8'], w.deps), EXIT_HELD);
	assert.match(w.lines[0], /held by branch fleet\/8-x on random/);
	assert.equal(run(['claim', '8'], w.deps), EXIT_HELD);
	assert.deepEqual(w.writes, []);
});

test('an expired claim is stale unless its branch has an open PR', () => {
	const issues = {
		9: { labels: [IN_PROGRESS], comments: [factoryClaim('fleet/9', iso(NOW - HOUR))] },
	};
	assert.equal(run(['check', '9'], world({ issues }).deps), 0);
	const withPr = world({
		issues,
		prs: [{ number: 50, headRefName: 'fleet/9', closingIssuesReferences: [] }],
	});
	assert.equal(run(['check', '9'], withPr.deps), EXIT_HELD);
	assert.match(withPr.lines[0], /open PR #50/);
});

test('an open PR that would close the issue holds it; one that only refers to it does not', () => {
	const prs = [{ number: 51, headRefName: 'other', closingIssuesReferences: [{ number: 10 }] }];
	assert.equal(run(['check', '10'], world({ issues: { 10: {} }, prs }).deps), EXIT_HELD);
	const refers = [{ number: 52, headRefName: 'other', closingIssuesReferences: [{ number: 100 }] }];
	assert.equal(run(['check', '10'], world({ issues: { 10: {} }, prs: refers }).deps), 0);
});

test('the label alone holds until the issue has been quiet for the lease', () => {
	const recent = world({ issues: { 11: { labels: [IN_PROGRESS] } } });
	assert.equal(run(['check', '11'], recent.deps), EXIT_HELD);
	assert.match(recent.lines[0], /unknown holder/);
	const quiet = world({
		issues: { 11: { labels: [IN_PROGRESS], updatedAt: iso(NOW - 30 * HOUR) } },
	});
	assert.equal(run(['check', '11'], quiet.deps), 0);
	assert.match(quiet.lines[0], /stale/);
});

test('a set is claimed all or nothing', () => {
	const w = world({ issues: { 12: {}, 13: { labels: [IN_PROGRESS] } } });
	assert.equal(run(['claim', '12', '13'], w.deps), EXIT_HELD);
	assert.deepEqual(w.writes, []);
	assert.deepEqual(w.labels(12), ['status:planned', 'execution:bounded']);
});

test('closed issues in a set are skipped', () => {
	const w = world({ issues: { 14: { state: 'CLOSED' }, 15: {} } });
	assert.equal(run(['claim', '14', '15'], w.deps), 0);
	assert.deepEqual(
		w.writes.map((x) => x.n),
		[15, 15]
	);
});

test('a failed write puts back what the call claimed', () => {
	const w = world({
		issues: { 22: {}, 23: {} },
		failOn: (args) => args[1] === 'comment' && args[2] === '23',
	});
	assert.equal(run(['claim', '22', '23'], w.deps), 1);
	assert.deepEqual(w.labels(22), ['execution:bounded', 'status:planned']);
	assert.deepEqual(w.labels(23), ['execution:bounded', 'status:planned']);
	assert.equal(standingClaims(w.store[22].comments).length, 0);
	assert.match(w.lines.join('\n'), /HTTP 502[\s\S]*Claimed none of #22 #23\./);
});

test('release restores the status the claim replaced', () => {
	const w = world({ issues: { 24: { labels: ['status:deferred', 'execution:bounded'] } } });
	run(['claim', '24'], w.deps);
	assert.deepEqual(w.labels(24), ['execution:bounded', IN_PROGRESS]);
	run(['release', '24'], w.deps);
	assert.deepEqual(w.labels(24), ['execution:bounded', 'status:deferred']);
});

test('release clears only the claim label on a closed issue, once', () => {
	const w = world({
		issues: {
			28: {
				state: 'CLOSED',
				labels: ['execution:bounded', IN_PROGRESS, 'status:deferred'],
			},
		},
	});
	assert.equal(run(['release', '28'], w.deps), 0);
	assert.deepEqual(w.labels(28), ['execution:bounded', 'status:deferred']);
	assert.equal(run(['release', '28'], w.deps), 0);
	assert.deepEqual(w.writes, [{ n: 28, add: undefined, remove: [IN_PROGRESS] }]);
});

test('retrying a closed release ends old leases once so another branch can claim after reopen', () => {
	let failEdit = true;
	const w = world({
		issues: {
			29: {
				state: 'CLOSED',
				labels: [IN_PROGRESS],
				comments: [factoryClaim('fleet/29', iso(NOW + HOUR))],
			},
		},
		failOn: (args) => failEdit && args[1] === 'edit',
	});
	assert.equal(run(['release', '29', '--closed-only'], w.deps), 1);
	failEdit = false;
	assert.equal(run(['release', '29', '--closed-only'], w.deps), 0);
	assert.equal(w.writes.filter((write) => write.comment).length, 1);
	assert.deepEqual(standingClaims(w.store[29].comments), []);
	w.store[29].state = 'OPEN';
	assert.equal(run(['claim', '29'], w.deps), 0);
	assert.equal(run(['check', '29'], w.deps), 0);
	assert.match(w.lines.at(-1), /#29: yours/);
});

test('closed-only release skips a reopened issue even if the caller owns its current claim', () => {
	const w = world({ issues: { 30: {} } });
	assert.equal(run(['claim', '30'], w.deps), 0);
	const before = [...w.writes];
	assert.equal(run(['release', '30', '--closed-only'], w.deps), 0);
	assert.deepEqual(w.writes, before);
});

test('losing a race undoes new claims in the set but not a renewal', () => {
	const mine = claimBody(
		{ branch: 't3/a', machine: 'hero', session: 'thread-a' },
		iso(NOW + HOUR),
		'status:planned'
	);
	const w = world({
		issues: {
			25: { labels: [IN_PROGRESS, 'execution:bounded'], comments: [mine] },
			26: {},
			27: {},
		},
		onComment: (issue) => {
			if (issue.number === 27 && issue.comments.length === 1)
				issue.comments.unshift({
					body: factoryClaim('fleet/27', iso(NOW + HOUR)),
					createdAt: iso(NOW),
				});
		},
	});
	assert.equal(run(['claim', '25', '26', '27'], w.deps), EXIT_HELD);
	assert.ok(w.labels(25).includes(IN_PROGRESS));
	assert.equal(standingClaims(w.store[25].comments).length, 2);
	assert.deepEqual(w.labels(26), ['execution:bounded', 'status:planned']);
	assert.equal(standingClaims(w.store[26].comments).length, 0);
});

test('losing a race releases the own claim and leaves the label to the winner', () => {
	let landed = false;
	const w = world({
		issues: { 16: {} },
		// A cell's claim lands between our check and our comment.
		onComment: (issue) => {
			if (landed) return;
			landed = true;
			issue.comments.splice(issue.comments.length - 1, 0, {
				body: factoryClaim('fleet/16', iso(NOW + HOUR)),
				createdAt: iso(NOW),
			});
		},
	});
	assert.equal(run(['claim', '16'], w.deps), EXIT_HELD);
	assert.match(w.writes.at(-1).comment, /botcore-factory:release \{"branch": "t3\/a"\}/);
	assert.ok(w.labels(16).includes(IN_PROGRESS));
	const standing = standingClaims(w.store[16].comments);
	assert.deepEqual(
		standing.map((c) => c.branch),
		['fleet/16']
	);
});

test('a later rival claim does not make the earlier claimant back off', () => {
	const w = world({
		issues: { 17: {} },
		onComment: (issue) => {
			if (issue.comments.length === 1)
				issue.comments.push({
					body: factoryClaim('fleet/17', iso(NOW + HOUR)),
					createdAt: iso(NOW),
				});
		},
	});
	assert.equal(run(['claim', '17'], w.deps), 0);
	assert.ok(w.labels(17).includes(IN_PROGRESS));
});

test('release puts the issue back and ends the claim; another holder needs --force', () => {
	const w = world({ issues: { 18: {} } });
	run(['claim', '18'], w.deps);
	assert.equal(run(['release', '18', '--reason', 'done for now'], w.deps), 0);
	assert.deepEqual(w.labels(18), ['execution:bounded', 'status:planned']);
	assert.equal(standingClaims(w.store[18].comments).length, 0);

	const other = world({
		issues: {
			19: { labels: [IN_PROGRESS], comments: [factoryClaim('fleet/19', iso(NOW + HOUR))] },
		},
	});
	assert.equal(run(['release', '19'], other.deps), EXIT_HELD);
	assert.deepEqual(other.writes, []);
	assert.equal(run(['release', '19', '--force'], other.deps), 0);
	assert.equal(standingClaims(other.store[19].comments).length, 0);
	assert.ok(!other.labels(19).includes(IN_PROGRESS));
});

test('stale lists only claims whose holder went quiet', () => {
	const w = world({
		issues: {
			20: { labels: [IN_PROGRESS], comments: [factoryClaim('fleet/20', iso(NOW - HOUR))] },
			21: { labels: [IN_PROGRESS], comments: [factoryClaim('fleet/21', iso(NOW + HOUR))] },
		},
	});
	assert.equal(run(['stale'], w.deps), 0);
	assert.equal(w.lines.length, 1);
	assert.match(w.lines[0], /^#20 /);
});

test('marker fields that are not plain values are ignored', () => {
	const body = claimBody({ branch: 'ok', machine: 'm', session: 's' }, iso(NOW + HOUR)).replace(
		'"ok"',
		'"bad branch`"'
	);
	assert.equal(standingClaims([{ body, createdAt: iso(NOW) }]).length, 0);
});

test('usage errors exit 1', () => {
	const w = world();
	assert.equal(run(['claim'], w.deps), 1);
	assert.equal(run(['nope', '1'], w.deps), 1);
	assert.equal(run(['claim', '1', '--hours', '0'], w.deps), 1);
});
