import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// The histories the factory's triage scenario and tests/test_commands.py read too. Each
// issue's `expected` says what both readers observe, or what each does where they differ.
const HISTORIES = JSON.parse(
	readFileSync(
		new URL(
			'../docs/features/active/software-factory/scenarios/fixtures/claim-histories.json',
			import.meta.url
		),
		'utf8'
	)
);
const AT = Date.parse(HISTORIES.now);

/** One fixture issue as a fake-gh world, with the fixture's clock and open PRs. */
function history(number) {
	const { labels, comments } = HISTORIES.issues.find((issue) => issue.number === number);
	const w = world({
		issues: { [number]: { labels, comments: comments.map((c) => c.body), updatedAt: iso(AT) } },
		prs: HISTORIES.pullRequests.map((pr) => ({
			number: pr.number,
			headRefName: pr.branch,
			closingIssuesReferences: pr.closes.map((n) => ({ number: n })),
		})),
	});
	/** Run the CLI as the session working on `branch`; returns the exit code. */
	const as = (branch, ...argv) =>
		run(argv, {
			...w.deps,
			now: () => AT,
			git: () => branch,
			env: { T3CODE_THREAD_ID: `thread-${branch}` },
		});
	const branches = () => standingClaims(w.store[number].comments).map((c) => c.branch);
	return { ...w, as, branches };
}

const standingIn = (number) =>
	standingClaims(HISTORIES.issues.find((issue) => issue.number === number).comments).map(
		(c) => c.branch
	);

test('issue-claim check names the standing holder in the factory triage histories', () => {
	for (const { number, title, expected } of HISTORIES.issues) {
		const want = expected.cli ?? expected;
		const w = history(number);
		const status = w.as('fix/observer', 'check', String(number), '--json');
		const [row] = JSON.parse(w.lines[0]);
		const seen = { state: row.state, holder: row.holder?.branch ?? null };
		assert.deepEqual(seen, { state: want.state, holder: want.holder }, title);
		assert.equal(status, want.state === 'held' ? EXIT_HELD : 0, title);
		if (want.leaseUntil) assert.equal(row.holder.leaseUntil, want.leaseUntil, title);
		if (want.machine) assert.equal(row.holder.machine, want.machine, title);
		assert.deepEqual(w.writes, [], title);
	}
});

test('the holder renews beside a later rival claim and keeps the issue', () => {
	const w = history(302);
	assert.equal(w.as('fix/alpha', 'claim', '302', '--hours', '48'), 0);
	assert.match(w.lines.at(-1), /#302: renewed for fix\/alpha until 2030-01-05T00:00:00Z/);
	assert.deepEqual(w.branches(), ['fix/alpha', 'fix/bravo', 'fix/alpha']);
	w.lines.length = 0;
	assert.equal(w.as('fix/observer', 'check', '302', '--json'), EXIT_HELD);
	const [row] = JSON.parse(w.lines[0]);
	assert.equal(row.holder.branch, 'fix/alpha');
	assert.equal(row.holder.leaseUntil, '2030-01-05T00:00:00Z');
});

test('a lapsed claim keeps no place: claiming again backs off to the branch that holds', () => {
	// fix/alpha's first lease ran out and fix/bravo holds. The label was taken off by hand, so
	// `claim` sees a free issue and writes; its read-back then finds fix/bravo's live claim
	// ahead of the new one. An old claim of the caller's own does not put it first.
	const w = history(307);
	w.store[307].labels = w.store[307].labels.filter((l) => l.name !== IN_PROGRESS);
	assert.equal(w.as('fix/alpha', 'claim', '307'), EXIT_HELD);
	assert.match(w.lines.join('\n'), /#307: branch fix\/bravo on workstation.* holds it\./);
	assert.deepEqual(w.branches(), ['fix/bravo']);
	assert.ok(w.labels(307).includes(IN_PROGRESS));
});

test('claim reads back liveness as check does: a claim held open by its branch PR counts', () => {
	// #312: fix/charlie's lease ran out but its branch has an open PR, so check calls it yours.
	const own = history(312);
	assert.equal(own.as('fix/charlie', 'check', '312'), 0);
	assert.match(own.lines.at(-1), /#312: yours/);
	assert.equal(own.as('fix/charlie', 'claim', '312'), 0);
	assert.match(own.lines.at(-1), /#312: renewed for fix\/charlie/);
	assert.deepEqual(own.branches(), ['fix/charlie', 'fix/bravo', 'fix/charlie']);
	// #313 with the label taken off by hand: claim sees a free issue and writes, then finds
	// fix/charlie's PR-backed claim ahead of its own and backs off, as check would report.
	const other = history(313);
	other.store[313].labels = other.store[313].labels.filter((l) => l.name !== IN_PROGRESS);
	assert.equal(other.as('fix/alpha', 'claim', '313'), EXIT_HELD);
	assert.match(other.lines.join('\n'), /#313: branch fix\/charlie on workstation.* holds it\./);
	assert.deepEqual(other.branches(), ['fix/charlie']);
});

test('claim reads back the caller as holding when any of the holding branch claims is its own', () => {
	// The same session claimed fix/x, another session renewed it; the first session now works on
	// another branch. check calls the issue its own, so claim renews rather than backing off.
	const mine = claimBody(
		{ branch: 'fix/x', machine: 'hero', session: 'thread-a' },
		iso(NOW + HOUR)
	);
	const theirs = claimBody(
		{ branch: 'fix/x', machine: 'mini', session: 'thread-b' },
		iso(NOW + 2 * HOUR)
	);
	const w = world({
		issues: { 41: { labels: [IN_PROGRESS, 'execution:bounded'], comments: [mine, theirs] } },
	});
	assert.equal(run(['check', '41'], w.deps), 0);
	assert.match(w.lines.at(-1), /#41: yours/);
	assert.equal(run(['claim', '41'], w.deps), 0);
	assert.match(w.lines.at(-1), /#41: renewed for t3\/a/);
});

test('a release names the remaining holder by its latest lease', () => {
	const renewed =
		'<!-- botcore-factory:claim {"branch":"fix/bravo","machine":"laptop","leaseUntil":"2030-01-06T00:00:00Z"} -->';
	const w = history(302);
	w.store[302].comments.push({ body: renewed });
	assert.equal(w.as('fix/alpha', 'release', '302'), 0);
	assert.match(w.lines.at(-1), /still held by branch fix\/bravo on laptop, lease until 2030-01-06/);
});

test('a branch that released and claims again goes behind the rival that stayed', () => {
	const w = history(304); // fix/alpha claimed, fix/bravo claimed, fix/alpha released
	assert.equal(w.as('fix/alpha', 'claim', '304'), EXIT_HELD);
	assert.match(w.lines.join('\n'), /#304: held by branch fix\/bravo/);
	assert.deepEqual(w.writes, []);
	// Racing past the check (the label taken off by hand), its new claim reads back behind.
	w.store[304].labels = w.store[304].labels.filter((l) => l.name !== IN_PROGRESS);
	assert.equal(w.as('fix/alpha', 'claim', '304'), EXIT_HELD);
	assert.match(w.lines.join('\n'), /#304: branch fix\/bravo on workstation.* holds it\./);
	assert.deepEqual(w.branches(), ['fix/bravo']);
});

test('a caller whose own claim lapsed takes it back on an issue an open PR holds', () => {
	const lapsed = claimBody(
		{ branch: 't3/a', machine: 'hero', session: 'thread-a' },
		iso(NOW - HOUR),
		'status:planned'
	);
	const w = world({
		issues: { 40: { labels: [IN_PROGRESS, 'execution:bounded'], comments: [lapsed] } },
		prs: [{ number: 77, headRefName: 'fix/other', closingIssuesReferences: [{ number: 40 }] }],
	});
	assert.equal(run(['release', '40'], w.deps), 0);
	assert.match(w.lines.at(-1), /held by open PR #77\. Released your own claim/);
	assert.deepEqual(standingClaims(w.store[40].comments), []);
	assert.ok(w.labels(40).includes(IN_PROGRESS), 'the label stays with the PR');
});

test('releasing either of two live claims leaves the other holding the issue', () => {
	for (const [leaving, staying, row] of [
		['fix/bravo', 'fix/alpha', 303],
		['fix/alpha', 'fix/bravo', 304],
	]) {
		const w = history(302);
		assert.equal(w.as(leaving, 'release', '302'), 0, leaving);
		// The release command leaves exactly the history the fixture row writes by hand.
		assert.deepEqual(w.branches(), standingIn(row), leaving);
		assert.deepEqual(
			w.writes.map((x) => Object.keys(x).sort().join()),
			['comment,n'],
			`${leaving} must not touch the label: it is ${staying}'s`
		);
		assert.ok(w.labels(302).includes(IN_PROGRESS), leaving);
		w.lines.length = 0;
		assert.equal(w.as('fix/observer', 'check', '302', '--json'), EXIT_HELD, leaving);
		assert.equal(JSON.parse(w.lines[0])[0].holder.branch, staying, leaving);
		// The last claim released puts the issue back.
		assert.equal(w.as(staying, 'release', '302'), 0, staying);
		assert.deepEqual(w.labels(302), ['execution:bounded', 'area:core', 'status:planned']);
		assert.equal(w.as('fix/observer', 'check', '302'), 0, staying);
		assert.match(w.lines.at(-1), /#302: free/);
	}
});

test('force ends the holder and the caller, and the label stays with a third live claim', () => {
	const third =
		'<!-- botcore-factory:claim {"branch":"fix/charlie-2","machine":"mini","leaseUntil":"2030-01-04T00:00:00Z"} -->';
	const w = history(302);
	w.store[302].comments.push({ body: third });
	assert.equal(w.as('fix/observer', 'release', '302'), EXIT_HELD);
	assert.deepEqual(w.writes, []);
	assert.equal(w.as('fix/bravo', 'release', '302', '--force'), 0);
	assert.deepEqual(w.branches(), ['fix/charlie-2']);
	assert.ok(w.labels(302).includes(IN_PROGRESS));
	assert.match(w.lines.at(-1), /still held by branch fix\/charlie-2 on mini/);
});

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

test('undoing a set leaves the label to a claim that landed beside one of its issues', () => {
	const w = world({
		issues: { 31: {}, 32: {} },
		// A cell that read #31 before our label claims it just after us; it does not read back.
		onComment: (issue) => {
			if (issue.number === 31 && issue.comments.length === 1)
				issue.comments.push({ body: factoryClaim('fleet/31', iso(NOW + HOUR)) });
		},
		failOn: (args) => args[1] === 'comment' && args[2] === '32',
	});
	assert.equal(run(['claim', '31', '32'], w.deps), 1);
	assert.deepEqual(
		standingClaims(w.store[31].comments).map((c) => c.branch),
		['fleet/31']
	);
	assert.ok(w.labels(31).includes(IN_PROGRESS));
	assert.deepEqual(w.labels(32), ['execution:bounded', 'status:planned']);
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
