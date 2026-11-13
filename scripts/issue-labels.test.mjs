import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	dispatchOrder,
	issueViolations,
	isUntriaged,
	labelDifferences,
	loadDefinitions,
	parseDefinitions,
	RULE_LABELS,
	run,
} from './issue-labels.mjs';

const DEFINITIONS = loadDefinitions();

const violations = (labels, assigned = false) => issueViolations({ labels, assigned }, DEFINITIONS);

/** A fake `gh` that answers reads from fixtures and records every call. */
function fakeGh({ issues = [], prs = [], labels = [], fail = false } = {}) {
	const calls = [];
	const gh = (args) => {
		calls.push(args);
		if (fail) throw new Error('HTTP 502');
		const key = `${args[0]} ${args[1]}`;
		if (key === 'issue list') return JSON.stringify(issues);
		if (key === 'issue view') return JSON.stringify(issues.find((i) => `${i.number}` === args[2]));
		if (key === 'pr list') return JSON.stringify(prs);
		if (key === 'label list') return JSON.stringify(labels);
		if (key === 'label create') return '';
		throw new Error(`unexpected gh call: ${args.join(' ')}`);
	};
	return { gh, calls };
}

function exec(argv, gh) {
	const out = [];
	const err = [];
	const code = run(argv, {
		gh,
		log: (line) => out.push(line),
		error: (line) => err.push(line),
	});
	return { code, out: out.join('\n'), err: err.join('\n') };
}

const issue = (
	number,
	names,
	assignees = [],
	createdAt = `2030-01-01T${10 + (number % 10)}:00:00Z`
) => ({
	number,
	title: `Issue ${number}`,
	state: 'OPEN',
	labels: names.map((name) => ({ name })),
	assignees: assignees.map((login) => ({ login })),
	createdAt,
});

const isRead = ([group, action]) =>
	(group === 'issue' && (action === 'list' || action === 'view')) ||
	(group === 'pr' && action === 'list') ||
	(group === 'label' && action === 'list');

describe('.github/labels.json', () => {
	it('defines every label a rule names, none of them legacy', () => {
		const byName = new Map(DEFINITIONS.map((entry) => [entry.name, entry]));
		for (const name of RULE_LABELS) {
			assert.ok(byName.get(name), name);
			assert.equal(byName.get(name).legacy, undefined, name);
		}
		const executions = DEFINITIONS.filter((e) => e.name.startsWith('execution:') && !e.legacy);
		assert.equal(executions.length, 5);
	});

	it('rejects duplicate names and malformed entries', () => {
		const one = { name: 'a', color: 'ffffff', description: 'x' };
		assert.throws(() => parseDefinitions(JSON.stringify([one, one])), /defined twice/);
		assert.throws(() => parseDefinitions(JSON.stringify([{ ...one, color: 'red' }])), /color/);
		assert.throws(
			() => parseDefinitions(JSON.stringify([{ name: 'a', color: 'ffffff' }])),
			/description/
		);
		assert.throws(() => parseDefinitions(JSON.stringify(one)), /list/);
	});
});

describe('issueViolations', () => {
	it('accepts a planned issue with one profile and gate labels', () => {
		assert.deepEqual(
			violations([
				'status:planned',
				'execution:bounded',
				'needs:approach',
				'risk:high',
				'type:bug',
			]),
			[]
		);
		assert.deepEqual(violations(['status:deferred', 'needs:decision'], true), []);
		assert.deepEqual(violations(['status:in-progress', 'execution:deep']), []);
	});

	const cases = [
		[['status:planned', 'status:deferred', 'execution:bounded'], /2 status labels/],
		[['status:in-progress', 'status:triage'], /status:triage left beside/],
		[['status:triage', 'priority:medium'], /legacy label priority:medium/],
		[['status:triage', 'status:needs-info'], /legacy label status:needs-info/],
		[['status:triage', 'made-up'], /made-up is not defined/],
		[['status:triage', 'priority:0', 'priority:1'], /both priority:0 and priority:1/],
		[['status:triage', 'priority:0'], /priority:0 unassigned/],
		[['status:triage', 'risk:high', 'risk:medium'], /both risk:high and risk:medium/],
		[['status:planned'], /status:planned without an execution profile/],
		[['status:planned', 'execution:bounded', 'execution:deep'], /several execution profiles/],
		[['status:deferred', 'blocked', 'execution:deep'], /status:deferred keeps execution:deep/],
		[['status:planned', 'execution:expert-escalation'], /expert-escalation unassigned/],
		[['status:deferred', 'needs:decision'], /needs:decision unassigned/],
		[['status:deferred', 'needs:operator'], /needs:operator unassigned/],
		[['status:planned', 'execution:bounded', 'blocked'], /status:planned with blocked/],
	];
	for (const [labels, message] of cases) {
		it(`flags ${JSON.stringify(labels)}`, () => {
			assert.match(violations(labels).join('\n'), message);
		});
	}

	it('lets an assignee satisfy the rules that need the owner', () => {
		assert.deepEqual(violations(['status:triage', 'priority:0'], true), []);
		assert.deepEqual(violations(['status:planned', 'execution:expert-escalation'], true), []);
		assert.deepEqual(violations(['status:planned', 'execution:bounded', 'needs:operator'], true), [
			'status:planned with needs:operator',
		]);
	});
});

describe('isUntriaged', () => {
	it('counts no status or only status:triage, never a claimed issue', () => {
		assert.equal(isUntriaged([]), true);
		assert.equal(isUntriaged(['status:triage', 'type:bug']), true);
		assert.equal(isUntriaged(['status:accepted']), true);
		assert.equal(isUntriaged(['status:in-progress', 'status:triage']), false);
		assert.equal(isUntriaged(['status:planned']), false);
	});
});

describe('dispatchOrder', () => {
	const flat = (number, labels, { assigned = false, createdAt = '2030-01-01T09:00:00Z' } = {}) => ({
		number,
		labels,
		assigned,
		createdAt,
	});

	it('orders priority:0, then priority:1, then the rest, oldest first', () => {
		const planned = ['status:planned', 'execution:bounded'];
		const { dispatchable } = dispatchOrder(
			[
				flat(1, planned, { createdAt: '2030-01-03T00:00:00Z' }),
				flat(2, planned, { createdAt: '2030-01-01T00:00:00Z' }),
				flat(3, [...planned, 'priority:1'], { createdAt: '2030-01-05T00:00:00Z' }),
				flat(4, [...planned, 'priority:1'], { createdAt: '2030-01-04T00:00:00Z' }),
				flat(5, planned, { createdAt: '2030-01-01T00:00:00Z' }),
			],
			DEFINITIONS
		);
		assert.deepEqual(
			dispatchable.map((i) => i.number),
			[4, 3, 2, 5, 1]
		);
	});

	it("holds back the owner's lane, claims, open PRs and rule breakers, with reasons", () => {
		const { dispatchable, held } = dispatchOrder(
			[
				flat(10, ['status:planned', 'execution:bounded']),
				flat(11, ['status:planned', 'execution:expert-escalation'], { assigned: true }),
				flat(12, ['status:planned', 'execution:deep'], { assigned: true }),
				flat(13, ['status:planned', 'execution:bounded']),
				flat(14, ['status:planned']),
				flat(15, ['status:deferred', 'needs:decision'], { assigned: true }),
				flat(16, ['status:triage']),
			],
			DEFINITIONS,
			new Set([13])
		);
		assert.deepEqual(
			dispatchable.map((i) => i.number),
			[10]
		);
		assert.deepEqual(
			held.map((h) => [h.number, h.reasons.join('; ')]),
			[
				[11, "execution:expert-escalation: the owner's lane"],
				[12, "assigned: the owner's lane"],
				[13, 'an open PR would close it'],
				[14, 'breaks a rule: status:planned without an execution profile'],
			]
		);
	});
});

describe('check', () => {
	it('reports violations and untriaged issues from one read, exit 1', () => {
		const { gh, calls } = fakeGh({
			issues: [
				issue(1, ['status:planned', 'execution:bounded']),
				issue(2, ['status:deferred', 'needs:operator']),
				issue(3, ['type:bug']),
			],
		});
		const { code, out } = exec(['check'], gh);
		assert.equal(code, 1);
		assert.ok(out.includes('#2 Issue 2\n  - needs:operator unassigned'));
		assert.ok(out.includes('Untriaged: #3'));
		assert.ok(out.includes('Checked 3 issue(s): 1 with violations, 1 untriaged.'));
		assert.ok(calls.every(isRead));
	});

	it('exits 0 for a clean backlog and emits JSON on request', () => {
		const { gh } = fakeGh({ issues: [issue(4, ['status:planned', 'execution:deep'])] });
		const { code, out } = exec(['check', '--json'], gh);
		assert.equal(code, 0);
		assert.deepEqual(JSON.parse(out), { checked: 1, untriaged: [], violations: [] });
	});

	it('reads only the numbered issues when given numbers', () => {
		const { gh, calls } = fakeGh({ issues: [issue(5, ['status:planned']), issue(6, [])] });
		const { code, out } = exec(['check', '#5'], gh);
		assert.equal(code, 1);
		assert.ok(out.includes('status:planned without an execution profile'));
		assert.deepEqual(calls, [
			['issue', 'view', '5', '--json', 'number,title,state,labels,assignees,createdAt'],
		]);
	});

	it('checks a proposed label set without calling GitHub', () => {
		const { gh, calls } = fakeGh();
		assert.equal(exec(['check', '--labels', 'status:planned,execution:bounded'], gh).code, 0);
		const failing = exec(['check', '--labels', 'status:deferred,needs:decision'], gh);
		assert.equal(failing.code, 1);
		assert.equal(failing.out, '- needs:decision unassigned');
		assert.equal(
			exec(['check', '--labels', 'status:deferred,needs:decision', '--assigned'], gh).code,
			0
		);
		const statusless = exec(['check', '--labels', 'type:bug'], gh);
		assert.equal(statusless.code, 1);
		assert.equal(statusless.out, '- no status label other than status:triage');
		assert.deepEqual(calls, []);
	});

	it('treats a failed or truncated read as an error, not a clean result', () => {
		const failed = exec(['check'], fakeGh({ fail: true }).gh);
		assert.equal(failed.code, 2);
		assert.equal(failed.out, '');
		assert.match(failed.err, /HTTP 502/);
		const many = Array.from({ length: 2000 }, (_, i) => issue(i + 1, []));
		assert.equal(exec(['check'], fakeGh({ issues: many }).gh).code, 2);
	});

	it('rejects bad arguments with exit 2', () => {
		const { gh } = fakeGh();
		assert.equal(exec(['check', 'seven'], gh).code, 2);
		assert.equal(exec(['triage'], gh).code, 2);
		assert.equal(exec(['check', '--bogus'], gh).code, 2);
		assert.equal(exec(['dispatch', '7'], gh).code, 2);
	});
});

describe('dispatch', () => {
	it('reads issues and open PRs, and lists dispatchable and held issues without writing', () => {
		const { gh, calls } = fakeGh({
			issues: [
				issue(20, ['status:planned', 'execution:bounded', 'priority:1']),
				issue(21, ['status:planned', 'execution:integrative']),
				issue(22, ['status:planned', 'execution:bounded']),
			],
			prs: [{ number: 900, closingIssuesReferences: [{ number: 22 }] }],
		});
		const { code, out } = exec(['dispatch', '--json'], gh);
		assert.equal(code, 0);
		const result = JSON.parse(out);
		assert.deepEqual(
			result.dispatchable.map((i) => i.number),
			[20, 21]
		);
		assert.deepEqual(result.held, [{ number: 22, reasons: ['an open PR would close it'] }]);
		assert.ok(calls.every(isRead));
	});

	it('treats a failed PR read as an error', () => {
		const { gh: base } = fakeGh({ issues: [issue(23, ['status:planned', 'execution:bounded'])] });
		const gh = (args) => {
			if (args[0] === 'pr') throw new Error('HTTP 502');
			return base(args);
		};
		const { code, out } = exec(['dispatch'], gh);
		assert.equal(code, 2);
		assert.equal(out, '');
	});
});

describe('labels', () => {
	const live = DEFINITIONS.filter((entry) => entry.name !== 'needs:repro').map(
		({ name, color, description }) => ({ name, color: color.toLowerCase(), description })
	);

	it('matches the file against an identical repository', () => {
		const all = DEFINITIONS.map(({ name, color, description }) => ({ name, color, description }));
		assert.equal(exec(['labels'], fakeGh({ labels: all }).gh).code, 0);
	});

	it('reports missing, extra and changed labels without writing', () => {
		const changed = live.map((label) =>
			label.name === 'blocked' ? { ...label, description: 'Stuck' } : label
		);
		const { gh, calls } = fakeGh({ labels: [...changed, { name: 'stray', color: '000000' }] });
		const { code, out } = exec(['labels'], gh);
		assert.equal(code, 1);
		assert.ok(out.includes('missing from GitHub: needs:repro'));
		assert.ok(out.includes('not in .github/labels.json: stray'));
		assert.ok(out.includes('blocked: description differs from GitHub ("Stuck")'));
		assert.ok(calls.every(isRead));
	});

	it('creates only the missing labels when asked', () => {
		const { gh, calls } = fakeGh({ labels: live });
		assert.equal(exec(['labels', '--create-missing'], gh).code, 0);
		const writes = calls.filter((call) => !isRead(call));
		const repro = DEFINITIONS.find((entry) => entry.name === 'needs:repro');
		assert.deepEqual(writes, [
			[
				'label',
				'create',
				'needs:repro',
				'--color',
				repro.color,
				'--description',
				repro.description,
			],
		]);
	});

	it('never recreates a legacy label', () => {
		const current = live.filter((label) => label.name !== 'priority:medium');
		const { gh, calls } = fakeGh({ labels: current });
		const { code, out } = exec(['labels', '--create-missing'], gh);
		assert.equal(code, 1);
		assert.ok(out.includes('legacy priority:medium is gone from GitHub: remove it'));
		assert.deepEqual(
			calls.filter((call) => !isRead(call)).map((call) => call[2]),
			['needs:repro']
		);
	});

	it('compares colors without regard to case', () => {
		const [entry] = DEFINITIONS;
		const upper = { ...entry, color: entry.color.toUpperCase() };
		assert.deepEqual(labelDifferences([entry], [upper]).changed, []);
	});
});
