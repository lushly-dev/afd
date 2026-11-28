/**
 * `scripts/ceiling-raises.mjs`: after D115 ends, a ceiling rises only with an amendment, its reason and an approval
 * (Loam's D161, #1929). The parser is reconciled with the modules it reads, both ways, so a row it cannot see fails.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CEILINGS } from '../../scripts/budget.mjs';
import { CEILING_AMENDMENTS, D115_ENDS_ON } from '../../scripts/ceiling-amendments.mjs';
import {
	AMENDMENTS_FILE,
	type CeilingAmendment,
	ceilingChanges,
	checkAmendment,
	checkCeilingRaises,
	checkEndDate,
	DECISIONS,
	decisionRow,
	parseCeilings,
	REPO_ROOT,
	runCeilingRaiseCheck,
	SOURCES,
	sectionText,
} from '../../scripts/ceiling-raises.mjs';
import { PAINT_CEILINGS } from '../browser/first-paint-budget';

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');
const SPEC = 'endpoints/loam/docs/phases/2-scope-projects/spec.md';
const BUDGET_FILE = 'endpoints/loam/packages/web/scripts/budget.mjs';
const PAINT_FILE = 'endpoints/loam/packages/web/test/browser/first-paint-budget.ts';
const D161 = (date: string) =>
	`| D161 | 2026-11-21 | D115 ends on ${date} |\n| D170 | x | jsMinified to 344,000, approved |`;

const BUDGET = (js: number, extra = '') =>
	`// head\nexport const CEILINGS = Object.freeze({\n\t// a comment\n\tjsMinified: ${js},\n\tjsGzip: 108_800,${extra}\n});\n`;
const PAINT = (ms: number) =>
	`export const PAINT_CEILINGS = {\n\tfirstContentfulPaintMs: ${ms},\n} as const;\n`;

function entry(overrides: Partial<CeilingAmendment> = {}): CeilingAmendment {
	return {
		row: 'jsMinified',
		from: 343_500,
		to: 344_000,
		measured: 343_812,
		reason: 'The step adds the inbox badge to first paint, 312 bytes measured',
		amendment: `${SPEC}#24-the-budget-and-the-rule`,
		approvedBy: 'coordinator',
		approval: 'https://github.com/lushly-dev/afd/pull/2300#issuecomment-1',
		approvedOn: '2026-12-01',
		...overrides,
	};
}

/** A synthetic tree: `budget.mjs` and the paint module at their real paths, and a spec that records 344,000. */
const SECTION = (body: string) =>
	`## 2. First paint\n\n### 2.4 The budget, and the rule\n\n${body}\n\n## 3. Scope\n`;
function files(
	js: number,
	ms = 1_275,
	spec = SECTION('jsMinified rises to 344,000'),
	extra: Record<string, string> = {}
) {
	const tree: Record<string, string> = {
		[BUDGET_FILE]: BUDGET(js),
		[PAINT_FILE]: PAINT(ms),
		[SPEC]: spec,
		...extra,
	};
	return (path: string) => tree[path] ?? null;
}

function check(options: {
	endsOn?: string | null;
	today?: string;
	head?: (path: string) => string | null;
	base?: (path: string) => string | null;
	amendments?: unknown[];
	decisions?: string;
}) {
	const head = options.head ?? files(344_000);
	return checkCeilingRaises({
		endsOn: options.endsOn === undefined ? '2026-11-30' : options.endsOn,
		amendments: options.amendments ?? [],
		today: options.today ?? '2026-12-02',
		decisions: options.decisions ?? D161('2026-11-30'),
		readRepoFile: head,
		readHead: head,
		readBase: options.base ?? files(343_500),
	});
}

describe('ceiling-raises: the parser reads every row of what it guards', () => {
	it('reads budget.mjs CEILINGS and the paint ceiling exactly as the modules export them, both ways', () => {
		const budget = parseCeilings(read(BUDGET_FILE), 'CEILINGS');
		expect(budget).toEqual({ rows: { ...CEILINGS } });
		expect(Object.keys(CEILINGS).length).toBeGreaterThan(30);
		const paint = parseCeilings(read(PAINT_FILE), 'PAINT_CEILINGS');
		expect(paint).toEqual({ rows: { ...PAINT_CEILINGS } });
		expect(SOURCES).toEqual([
			{ file: BUDGET_FILE, name: 'CEILINGS' },
			{ file: PAINT_FILE, name: 'PAINT_CEILINGS' },
		]);
	});

	it('parses CRLF-delimited ceilings, decision rows and spec sections cleanly', () => {
		const crlfBudget = BUDGET(344_000).replaceAll('\n', '\r\n');
		expect(parseCeilings(crlfBudget, 'CEILINGS')).toEqual({
			rows: { jsMinified: 344_000, jsGzip: 108_800 },
		});
		const crlfDecisions = D161('2026-11-30').replaceAll('\n', '\r\n');
		expect(decisionRow(crlfDecisions, 'D161')).toBe(
			'| D161 | 2026-11-21 | D115 ends on 2026-11-30 |'
		);
		const crlfSpec = SECTION('jsMinified rises to 344,000').replaceAll('\n', '\r\n');
		const section = sectionText(crlfSpec, '24-the-budget-and-the-rule');
		expect(section).toContain('344,000');
		expect(section).not.toContain('\r');
	});

	it('refuses a row it cannot read, a missing object, an empty one and a row named twice', () => {
		expect(parseCeilings(BUDGET(1, '\n\tkernelMinified: 100_000 + 5,'), 'CEILINGS')).toEqual({
			error: expect.stringContaining('kernelMinified: 100_000 + 5'),
		});
		expect(parseCeilings('const CEILINGS = {};', 'CEILINGS')).toEqual({
			error: expect.stringContaining('no `export const CEILINGS`'),
		});
		expect(parseCeilings('export const CEILINGS = Object.freeze({\n});', 'CEILINGS')).toEqual({
			error: expect.stringContaining('holds no ceiling'),
		});
		expect(parseCeilings(BUDGET(1, '\n\tjsMinified: 2,'), 'CEILINGS')).toEqual({
			error: expect.stringContaining('twice'),
		});
	});

	it('reads CRLF-formatted ceiling sources, decision rows, and spec sections', () => {
		const crlfBudget = BUDGET(344_000).replaceAll('\n', '\r\n');
		expect(parseCeilings(crlfBudget, 'CEILINGS')).toEqual({
			rows: { jsMinified: 344_000, jsGzip: 108_800 },
		});
		const crlfDecisions = D161('2026-11-30').replaceAll('\n', '\r\n');
		expect(decisionRow(crlfDecisions, 'D161')).toBe(
			'| D161 | 2026-11-21 | D115 ends on 2026-11-30 |'
		);
		const crlfSpec = SECTION('jsMinified rises to 344,000').replaceAll('\n', '\r\n');
		expect(sectionText(crlfSpec, '24-the-budget-and-the-rule')).toBe(
			'### 2.4 The budget, and the rule\n\njsMinified rises to 344,000\n'
		);
	});

	it('counts a raise, an added and a removed row, and leaves a lowering and an unchanged row out', () => {
		expect(ceilingChanges({ a: 10, b: 10, c: 10, d: 10 }, { a: 11, b: 9, c: 10, e: 5 })).toEqual([
			{ row: 'a', from: 10, to: 11 },
			{ row: 'e', from: null, to: 5 },
			{ row: 'd', from: 10, to: null },
		]);
	});
});

describe('ceiling-raises: inert until the date, then the restored rules', () => {
	it('is inert while D115_ENDS_ON is null, the base holding none either', () => {
		const result = check({ endsOn: null });
		expect(result.state).toBe('inert');
		expect(result.notes.join()).toContain('inert');
		expect(result.failures).toEqual([]);
	});

	it('lets a raise through on and before the end date (D115 still holds)', () => {
		const result = check({ today: '2026-11-30' });
		expect(result).toMatchObject({ state: 'within', failures: [] });
	});

	it("fails a change that unsets or moves the base's date while D161 still records it, inert or not", () => {
		const base = files(343_500, 1_275, undefined, {
			[AMENDMENTS_FILE]: `export const D115_ENDS_ON = '2026-11-30';\n`,
		});
		const unset = check({ endsOn: null, base, decisions: D161('2026-11-30') });
		expect(unset.state).toBe('inert');
		expect(unset.failures.join()).toContain('D115_ENDS_ON on the base is 2026-11-30');
		// An edit to D161 that keeps the old date (a space, another clause) does not unlock it.
		const touched = `${D161('2026-11-30')} `;
		expect(check({ endsOn: null, base, decisions: touched }).failures.join()).toContain(
			'still records "D115 ends on 2026-11-30"'
		);
		const both = D161('2026-11-30; D115 ends on 2026-12-31');
		expect(check({ endsOn: '2026-12-31', base, decisions: both }).failures.join()).toContain(
			'still records'
		);
		// The owner's new decision, rewriting D161's date in the same change, moves or removes it.
		expect(check({ endsOn: '2026-12-31', base, decisions: D161('2026-12-31') }).failures).toEqual(
			[]
		);
		expect(
			check({ endsOn: null, base, decisions: '| D161 | 2026-11-21 | D115 holds again |' }).failures
		).toEqual([]);
	});

	it('refuses a base date it cannot read', () => {
		const base = files(343_500, 1_275, undefined, {
			[AMENDMENTS_FILE]: 'export const D115_ENDS_ON = someDate;\n',
		});
		expect(check({ endsOn: null, base }).failures.join()).toContain('on the base');
	});

	it('accepts a chain of entries when one run spans several raises of a row', () => {
		const head = files(344_500, 1_275, SECTION('jsMinified 344,000, then 344,500'));
		const first = entry();
		const second = entry({ from: 344_000, to: 344_500, measured: 344_321 });
		expect(check({ head, amendments: [first, second] }).failures).toEqual([]);
		expect(check({ head, amendments: [second] }).failures.join()).toContain(
			'no CEILING_AMENDMENTS entry'
		);
	});

	it('fails a raise after the date with no amendment, naming the row, both figures and the rules', () => {
		const result = check({});
		expect(result.state).toBe('checked');
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain('raises `jsMinified` from 343500 to 344000');
		expect(result.failures[0]).toContain("phase 0's 8.1, phase 2's 2.4, phase 3's 13");
	});

	it('fails a raise of the paint ceiling too', () => {
		const result = check({ head: files(343_500, 1_400), base: files(343_500, 1_275) });
		expect(result.failures.join()).toContain('raises `firstContentfulPaintMs` from 1275 to 1400');
	});

	it('passes the same raise with its amendment, and a lowering or no change with none', () => {
		expect(check({ amendments: [entry()] })).toMatchObject({ state: 'checked', failures: [] });
		expect(check({ head: files(343_000) }).failures).toEqual([]);
		expect(check({ head: files(343_500) })).toMatchObject({
			failures: [],
			notes: expect.arrayContaining(['no ceiling is raised, added or removed']),
		});
	});

	it('fails an amendment for other figures than the raise it would cover', () => {
		const result = check({ amendments: [entry({ to: 344_500, measured: 344_100 })] });
		expect(result.failures.some((failure) => failure.includes('no CEILING_AMENDMENTS entry'))).toBe(
			true
		);
	});

	it('fails an added row and a removed one with no amendment, so a rename cannot carry a raise', () => {
		const head = (path: string) =>
			path === BUDGET_FILE
				? 'export const CEILINGS = Object.freeze({\n\tjsMinifiedTotal: 400_000,\n\tjsGzip: 108_800,\n});\n'
				: files(343_500)(path);
		const failures = check({ head }).failures.join('\n');
		expect(failures).toContain('adds `jsMinifiedTotal` at 400000');
		expect(failures).toContain('removes `jsMinified` (343500)');
	});

	it('fails a source the head lacks or cannot parse', () => {
		const head = (path: string) => (path === PAINT_FILE ? null : files(343_500)(path));
		expect(check({ head }).failures.join()).toContain('is missing');
	});
});

describe('ceiling-raises: what an amendment must carry', () => {
	const context = {
		readRepoFile: files(344_000),
		decisions: D161('2026-11-30'),
		today: '2026-12-02',
	};

	it('accepts a complete entry, with a link or a decision the log holds as its approval', () => {
		expect(checkAmendment(entry(), context)).toEqual([]);
		expect(checkAmendment(entry({ approval: 'D170', approvedBy: 'owner' }), context)).toEqual([]);
		expect(checkAmendment(entry({ from: null, measured: 300 }), context)).toEqual([]);
	});

	it.each([
		['a short reason', { reason: 'needed' }, '`reason`'],
		['a measurement over its ceiling', { measured: 344_001 }, '`measured`'],
		['a measurement the old ceiling held', { measured: 343_500 }, '`measured`'],
		['a lowering', { to: 343_000, measured: 342_000 }, 'a lowering needs no entry'],
		['an amendment outside the specifications', { amendment: 'README.md#x' }, '`amendment`'],
		['an amendment with no section', { amendment: SPEC }, '`amendment`'],
		['an anchor no heading has', { amendment: `${SPEC}#x` }, '`amendment`'],
		['a decision that does not name the row', { approval: 'D161' }, 'D161'],
		['an approver who is not one', { approvedBy: 'agent' as 'owner' }, '`approvedBy`'],
		['an approval that is not a link', { approval: 'approved in chat' }, '`approval`'],
		['a decision the log lacks', { approval: 'D999' }, 'D999'],
		['an approval dated later than today', { approvedOn: '2026-12-03' }, '`approvedOn`'],
		['an approval with no date', { approvedOn: '2026-02-30' }, '`approvedOn`'],
	])('refuses %s', (_, overrides, expected) => {
		expect(checkAmendment(entry(overrides), context).join('\n')).toContain(expected);
	});

	it('refuses a specification that does not record the row or its new figure', () => {
		const silent = {
			...context,
			readRepoFile: files(
				344_000,
				1_275,
				`${SECTION('nothing')}\njsMinified 344,000 in another section`
			),
		};
		const problems = checkAmendment(entry(), silent).join('\n');
		expect(problems).toContain('#24-the-budget-and-the-rule does not name the row `jsMinified`');
		expect(problems).toContain('does not record the new ceiling 344,000');
	});

	it('checks the ledger on every run, inert or not, and refuses an entry twice', () => {
		const inert = check({ endsOn: null, amendments: [entry({ reason: '' })] });
		expect(inert.failures.join()).toContain('`reason`');
		expect(check({ amendments: [entry(), entry()] }).failures.join()).toContain('twice');
	});
});

describe("ceiling-raises: D115's end date", () => {
	it('is a real date that D161 records', () => {
		expect(checkEndDate(null, '')).toEqual([]);
		expect(checkEndDate('2026-11-30', D161('2026-11-30'))).toEqual([]);
		expect(checkEndDate('30 November', D161('2026-11-30')).join()).toContain('not a date');
		expect(checkEndDate('2026-11-30', D161('2026-12-07')).join()).toContain('does not record');
		expect(checkEndDate('2026-11-30', '| D160 | x |').join()).toContain('no D161 row');
		// A date the row holds for another reason is not the end date.
		expect(checkEndDate('2026-11-21', D161('2026-11-30')).join()).toContain('does not record');
	});

	it("holds for this repository's own date and ledger", () => {
		const decisions = read(DECISIONS);
		expect(checkEndDate(D115_ENDS_ON, decisions)).toEqual([]);
		const result = checkCeilingRaises({
			endsOn: D115_ENDS_ON,
			amendments: CEILING_AMENDMENTS,
			today: new Date().toISOString().slice(0, 10),
			decisions,
			readRepoFile: (path) => read(path),
			readHead: (path) => read(path),
			readBase: (path) => read(path),
		});
		expect(result.failures).toEqual([]);
	});

	it('activates the day after the recorded 2026-11-30 end date against the real decision log', () => {
		const decisions = read(DECISIONS);
		expect(D115_ENDS_ON).toBe('2026-11-30');
		const within = checkCeilingRaises({
			endsOn: D115_ENDS_ON,
			amendments: [],
			today: '2026-11-30',
			decisions,
			readRepoFile: (path) => read(path),
			readHead: files(344_000),
			readBase: files(343_500),
		});
		expect(within).toMatchObject({ state: 'within', failures: [] });
		const active = checkCeilingRaises({
			endsOn: D115_ENDS_ON,
			amendments: [],
			today: '2026-12-01',
			decisions,
			readRepoFile: (path) => read(path),
			readHead: files(344_000),
			readBase: files(343_500),
		});
		expect(active.state).toBe('checked');
		expect(active.failures).toHaveLength(1);
		expect(active.failures[0]).toContain('raises `jsMinified` from 343500 to 344000');
		expect(active.failures[0]).toContain('after D115 ended (2026-11-30)');
		const tampered = checkCeilingRaises({
			endsOn: null,
			amendments: [],
			today: '2026-12-01',
			decisions,
			readRepoFile: (path) => read(path),
			readHead: files(344_000),
			readBase: (path) => (path === AMENDMENTS_FILE ? read(AMENDMENTS_FILE) : files(343_500)(path)),
		});
		expect(tampered.failures.join('\n')).toContain('D115_ENDS_ON on the base is 2026-11-30');
	});
});

/** The environment without GIT_*: a hook running these tests exports GIT_DIR, which would point git at AFD. */
const GIT_ENV = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
);

describe('ceiling-raises: against git', { timeout: 30_000 }, () => {
	let root: string | undefined;
	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true });
		root = undefined;
	});

	function repository() {
		root = mkdtempSync(join(tmpdir(), 'ceiling-raises-'));
		// Identity by `-c`, never `git config`, and no GIT_* from a hook: either would reach AFD's own repository.
		const git = (...args: string[]) =>
			execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
				cwd: root,
				env: GIT_ENV,
				encoding: 'utf8',
				stdio: 'pipe',
			});
		const write = (path: string, text: string) => {
			mkdirSync(dirname(join(root as string, path)), { recursive: true });
			writeFileSync(join(root as string, path), text);
		};
		git('init', '-q', '-b', 'main');
		write(BUDGET_FILE, BUDGET(343_500));
		write(PAINT_FILE, PAINT(1_275));
		write(DECISIONS, D161('2026-11-30'));
		write(SPEC, SECTION('jsMinified rises to 344,000'));
		git('add', '.');
		git('commit', '-q', '-m', 'base');
		return { git, write };
	}

	const run = (options: Parameters<typeof runCeilingRaiseCheck>[0]) => {
		const lines: string[] = [];
		const failures = runCeilingRaiseCheck({
			cwd: root,
			argv: ['node', 'ceiling-raises.mjs', '--base', 'HEAD'],
			env: {},
			endsOn: '2026-11-30',
			today: '2026-12-02',
			log: (line) => lines.push(line),
			error: (line) => lines.push(`ERROR ${line}`),
			...options,
		});
		return { failures, output: lines.join('\n') };
	};

	it('fails a raise in the working tree against the base commit, then passes it with its amendment', () => {
		const { write } = repository();
		write(BUDGET_FILE, BUDGET(344_000));
		const red = run({ amendments: [] });
		expect(red.failures).toBe(1);
		expect(red.output).toContain(
			'ERROR ceiling-raises: this change raises `jsMinified` from 343500 to 344000'
		);
		const green = run({ amendments: [entry()] });
		expect(green).toMatchObject({ failures: 0 });
		expect(green.output).toContain('amended in');
	});

	it("acts on its own repositories when a hook's GIT_DIR and GIT_INDEX_FILE point at another", () => {
		// The decoy stands for AFD's repository, as a push hook exports it: nothing here may change it.
		const decoy = mkdtempSync(join(tmpdir(), 'ceiling-raises-decoy-'));
		const inDecoy = (...args: string[]) =>
			execFileSync('git', ['-c', 'user.name=D', '-c', 'user.email=d@example.invalid', ...args], {
				cwd: decoy,
				env: GIT_ENV,
				encoding: 'utf8',
				stdio: 'pipe',
			});
		inDecoy('init', '-q');
		inDecoy('commit', '-q', '--allow-empty', '-m', 'decoy');
		const before = {
			head: inDecoy('rev-parse', 'HEAD'),
			refs: inDecoy('for-each-ref'),
			config: readFileSync(join(decoy, '.git/config'), 'utf8'),
		};
		const saved = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE };
		process.env.GIT_DIR = join(decoy, '.git');
		process.env.GIT_INDEX_FILE = join(decoy, '.git/index');
		try {
			const { write } = repository();
			write(BUDGET_FILE, BUDGET(344_000));
			const result = run({ amendments: [] });
			expect(result.output).toContain('raises `jsMinified` from 343500 to 344000');
		} finally {
			if (saved.dir === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = saved.dir;
			if (saved.index === undefined) delete process.env.GIT_INDEX_FILE;
			else process.env.GIT_INDEX_FILE = saved.index;
		}
		try {
			expect({
				head: inDecoy('rev-parse', 'HEAD'),
				refs: inDecoy('for-each-ref'),
				config: readFileSync(join(decoy, '.git/config'), 'utf8'),
			}).toEqual(before);
		} finally {
			rmSync(decoy, { recursive: true, force: true });
		}
	});

	it('is inert with no date on either side', () => {
		repository();
		const result = run({ endsOn: null });
		expect(result.failures).toBe(0);
		expect(result.output).toContain('inert');
	});

	it('fails under CI when the base cannot be read, and only notes it locally', () => {
		repository();
		const argv = ['node', 'x', '--base', 'no-such-ref'];
		expect(run({ argv, env: { CI: 'true' } })).toMatchObject({ failures: 1 });
		const local = run({ argv });
		expect(local.failures).toBe(0);
		expect(local.output).toContain('not checked');
		// A full clone is never fetched into, which would make it shallow.
		expect(local.output).toContain('is not in this clone');
		expect(
			execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
				cwd: root,
				env: GIT_ENV,
				encoding: 'utf8',
			}).trim()
		).toBe('false');
	});

	it('reads a pull request merge commit by its first parent, as a shallow checkout names it', () => {
		const { git, write } = repository();
		const base = git('rev-parse', 'HEAD').trim();
		git('checkout', '-q', '-b', 'topic');
		write(BUDGET_FILE, BUDGET(344_000));
		git('commit', '-qam', 'raise');
		git('checkout', '-q', 'main');
		write('other.txt', 'x');
		git('add', 'other.txt');
		git('commit', '-qm', 'main moves');
		const parent = git('rev-parse', 'HEAD').trim();
		git('merge', '-q', '--no-ff', '-m', 'merge', 'topic');
		expect(parent).not.toBe(base);
		const result = run({
			argv: ['node', 'x'],
			env: { GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_EVENT_NAME: 'pull_request' },
			amendments: [],
		});
		expect(result.failures).toBe(1);
		expect(result.output).toContain('raises `jsMinified` from 343500 to 344000');
	});

	const withEvent = (name: string, event: object) => {
		const path = join(root as string, `event-${name}-${Math.random().toString(36).slice(2)}.json`);
		writeFileSync(path, JSON.stringify(event));
		return {
			GITHUB_ACTIONS: 'true',
			CI: 'true',
			GITHUB_EVENT_NAME: name,
			GITHUB_EVENT_PATH: path,
		};
	};

	it('reads merge_group base_sha and push before as the base', () => {
		const { git, write } = repository();
		const base = git('rev-parse', 'HEAD').trim();
		write(BUDGET_FILE, BUDGET(344_000));
		git('commit', '-qam', 'raise');
		for (const env of [
			withEvent('merge_group', { merge_group: { base_sha: base } }),
			withEvent('push', { before: base }),
		]) {
			const result = run({ argv: ['node', 'x'], env, amendments: [] });
			expect(result.output).toContain('raises `jsMinified` from 343500 to 344000');
		}
		// A new branch's push has no `before`: nothing to compare, which fails under CI.
		const created = run({
			argv: ['node', 'x'],
			env: withEvent('push', { before: '0'.repeat(40) }),
		});
		expect(created).toMatchObject({ failures: 1 });
	});

	it('fetches a base a shallow clone lacks', () => {
		const { git, write } = repository();
		const base = git('rev-parse', 'HEAD').trim();
		write(BUDGET_FILE, BUDGET(344_000));
		git('commit', '-qam', 'raise');
		const origin = root as string;
		const clone = mkdtempSync(join(tmpdir(), 'ceiling-raises-clone-'));
		try {
			execFileSync('git', ['clone', '-q', '--depth=1', `file://${origin}`, clone], {
				env: GIT_ENV,
				stdio: 'pipe',
			});
			expect(() =>
				execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], {
					cwd: clone,
					env: GIT_ENV,
					stdio: 'pipe',
				})
			).toThrow();
			const result = run({ cwd: clone, argv: ['node', 'x', '--base', base], amendments: [] });
			expect(result.output).toContain('raises `jsMinified` from 343500 to 344000');
		} finally {
			rmSync(clone, { recursive: true, force: true });
		}
	});
});
