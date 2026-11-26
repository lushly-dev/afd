import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpecimenCommandBench } from '@lushly-dev/specimen-afd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), 'specimen-cli-'));
	directories.push(path);
	return path;
}
function harness() {
	const output: string[] = [];
	const errors: string[] = [];
	const bench: SpecimenCommandBench & { close(): Promise<void> } = {
		list: vi.fn(() => [
			{ id: 'button', title: 'Button', module: './button.ts', exportName: 'Primary' },
		]),
		validate: vi.fn(() => ({ valid: true, scope: 'static' as const, checked: 1, issues: [] })),
		migrate: vi.fn(async (request) => ({
			mode: (request?.apply ? 'apply' : 'preview') as 'apply' | 'preview',
			files: [],
			problems: [],
			summary: { files: 0, present: 0, proposed: 0, manual: 0, applied: 0 },
		})),
		inspect: vi.fn(async (request) => ({
			id: request.id,
			component: 'plain-button',
			schema: null,
			args: { label: 'Save' },
			context: {
				viewport: { width: 1280, height: 720 },
				theme: 'light' as const,
				locale: 'en-US',
				reducedMotion: 'no-preference' as const,
				motion: 'natural' as const,
			},
			limitations: ['No schema source describes plain-button.'],
			plugins: [],
		})),
		profile: vi.fn(async () => ({
			reports: [],
			counts: {
				total: 0,
				passed: 0,
				warnings: 0,
				failed: 0,
				notComparable: 0,
				noBaseline: 0,
				errored: 0,
			},
			orphanedBaselines: [],
			elapsedMs: 1,
		})),
		recordBaseline: vi.fn(async () => ({
			reports: [],
			counts: {
				total: 0,
				passed: 0,
				warnings: 0,
				failed: 0,
				notComparable: 0,
				noBaseline: 0,
				errored: 0,
			},
			orphanedBaselines: [],
			elapsedMs: 1,
		})),
		suggest: vi.fn(async () => ({
			component: 'x-a',
			status: 'unverified' as const,
			file: 'x-a.specimens.ts',
			source: '// proposed',
			entries: [],
			suggestions: [],
			skipped: [],
			elapsedMs: 1,
		})),
		contract: vi.fn(async () => ({
			rules: 'fastbot-parity@1',
			valid: true,
			findings: [],
			counts: { errors: 0, warnings: 0 },
			stats: { components: 1, storyFiles: 1, scoped: false },
			cases: { total: 1, passed: 1, failed: [] },
			workers: 2,
			elapsedMs: 1,
		})),
		coverage: vi.fn(async () => ({
			obligations: 'schema-partitions@1',
			complete: false,
			components: [],
			counts: { verified: 0, asserted: 0, represented: 0, missing: 0, unknown: 0 },
			waived: 0,
			waivers: { version: null, unused: [] },
			invalidClaims: [],
			cases: { total: 1, passed: 1, failed: [], skipped: 0 },
			workers: 2,
			elapsedMs: 1,
		})),
		pack: vi.fn(async () => ({ ...packReport, written: [], removed: [] })),
		packCheck: vi.fn(async () => ({
			...packReport,
			valid: packValid,
			changed: packValid ? [] : ['data/example/components/example-select.json'],
			added: [],
			removed: [],
		})),
		packExport: vi.fn(async ({ directory }: { directory: string }) => ({
			library: 'example',
			directory,
			digest: `sha256:${'0'.repeat(64)}`,
			files: ['rules/example.json'],
			keptPackToml: false,
		})),
		matrix: vi.fn(async (request) => ({
			id: request.id,
			checkpoint: 'after-run',
			axes: Object.keys(request.axes),
			cells: [],
			counts: { total: 0, captured: 0, unavailable: 0, changed: 0, unchanged: 0, insufficient: 0 },
			elapsedMs: 1,
		})),
		themes: vi.fn(async () => ({
			themes: ['light' as const, 'dark' as const, 'high-contrast' as const],
			checkpoint: 'mount',
			threshold: 0.02,
			valid: true,
			reports: [],
			counts: {
				total: 0,
				follows: 0,
				declared: 0,
				pinned: 0,
				undeclared: 0,
				contradicted: 0,
				unavailable: 0,
			},
			workers: 2,
			elapsedMs: 1,
		})),
		a11y: vi.fn(async () => ({
			reports: [],
			counts: { total: 0, passed: 0, warning: 0, failed: 0, notRun: 0 },
			workers: 2,
			elapsedMs: 1,
		})),
		runSuite: vi.fn(async () => ({
			outcome: 'passed' as const,
			counts: {
				total: 0,
				passed: 0,
				failed: 0,
				flaky: 0,
				skipped: 0,
				excluded: 0,
				outOfContext: 0,
			},
			retry: { ran: false, reason: 'no story failed' },
			stories: [],
			workers: 2,
			elapsedMs: 1,
			sourcesChanged: false,
		})),
		run: vi.fn(async (request) => ({
			id: request.id,
			outcome: {
				status: 'skipped' as const,
				play: 'none' as const,
				failures: [],
				a11y: {
					status: 'not-run' as const,
					policy: 'error' as const,
					violations: [],
					incomplete: 0,
					incompleteChecks: [],
					exceptions: [],
				},
			},
			observation: null,
		})),
		render: vi.fn(async () => {
			throw new Error('No render configured');
		}),
		captureSet: vi.fn(async (request) => ({
			set: 'set-4f1c0a9e2b7d',
			label: request?.label ?? null,
			revision: 'a1b2c3d',
			dirty: false,
			counts: {
				captured: 142,
				unavailable: 0,
				axe: { passed: 142, failed: 0, incomplete: 0 },
			},
			unavailable: [],
			skipped: { jobs: 0, gates: 0 },
		})),
		compare: vi.fn(async (request) => ({
			set: 'set-1a2b3c4d5e6f',
			context: {
				viewport: request.context?.viewport ?? { width: 1280, height: 720 },
				theme: request.context?.theme ?? ('light' as const),
				locale: request.context?.locale ?? 'en-US',
				reducedMotion: request.context?.reducedMotion ?? ('no-preference' as const),
				motion: request.context?.motion ?? ('natural' as const),
			},
			checkpoint: request.checkpoint ?? 'mount',
			captures: request.ids.map((id: string, index: number) => ({
				id,
				status: 'captured' as const,
				axe: index === 2 ? ('failed' as const) : ('passed' as const),
				violations: index === 2 ? ['color-contrast'] : [],
				screenshot: `.specimen/sets/set-1a2b3c4d5e6f/screenshots/${id}.png`,
			})),
			differences: request.ids.slice(1).map((id: string) => ({
				id,
				against: request.ids[0] as string,
				status: 'changed' as const,
				channels: ['layout' as const],
			})),
			page: 'compare.html?set=set-1a2b3c4d5e6f',
		})),
		diff: vi.fn(async () => ({
			status: 'no-change-observed' as const,
			differences: [],
			limitations: [],
		})),
		review: vi.fn(async () => ({
			before: { set: 'set-4f1c0a9e2b7d', label: 'main', revision: 'a1b2c3d', dirty: false },
			after: { set: 'set-7e2a90c4d311', label: 'branch', revision: 'e4f5a6b', dirty: false },
			open: [],
			blocking: [],
			settled: { unchanged: 4, kept: 2, answered: 1 },
			page: 'review.html?before=set-4f1c0a9e2b7d&after=set-7e2a90c4d311',
		})),
		build: vi.fn(async (outDir) => ({
			directory: outDir,
			shellBytes: 1000,
			budget: 50000,
			files: ['index.html'],
		})),
		point: vi.fn(async () => ({ point: cliSamplePoint })),
		pointMove: vi.fn(async () => ({ point: { ...cliSamplePoint, id: 'pt-9w4m2c1x5r8k' } })),
		pointCheck: vi.fn(async () => ({ status: 'current' as const, changed: [] })),
		noteAdd: vi.fn(async () => ({ note: cliSampleNote })),
		noteList: vi.fn(async () => ({ notes: [cliSampleNote] })),
		noteCheck: vi.fn(async () => ({
			checked: 1,
			orphaned: [],
			weakened: [],
			unchecked: [],
			restored: [],
		})),
		noteMove: vi.fn(async () => ({
			note: {
				...cliSampleNote,
				orphaned: false,
				history: [{ change: 'moved' as const, reason: 'Moved' }],
			},
		})),
		noteResolve: vi.fn(async () => ({
			resolved: [
				{
					...cliSampleNote,
					state: 'resolved' as const,
					resolution: { outcome: 'fixed' as const, reason: 'Fixed' },
					history: [{ change: 'resolved' as const, outcome: 'fixed' as const, reason: 'Fixed' }],
				},
			],
			skipped: [],
		})),
		noteReopen: vi.fn(async () => ({
			note: {
				...cliSampleNote,
				state: 'open' as const,
				history: [
					{ change: 'resolved' as const, outcome: 'fixed' as const, reason: 'Fixed' },
					{ change: 'reopened' as const, reason: 'Reopened' },
				],
			},
		})),
		createJob: vi.fn(async (request) => ({
			written: 'specimen.config.json',
			entry: {
				id: request.id,
				title: request.title ?? request.id,
				module: request.module,
				exportName: request.exportName,
				kind: 'job' as const,
				job: {
					scenario: request.scenario,
					target: request.target,
					...(request.runner ? { runner: request.runner } : {}),
					...(request.pin ? { pin: request.pin } : {}),
					captures: [{ after: 'The note opens', name: 'two-editors' }],
				},
			},
		})),
		runJob: vi.fn(async (request) => ({
			set: 'set-4f1c0a9e2b7d',
			label: request.label ?? null,
			id: request.id,
			job: 'keep-a-draft',
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			status: 'passed' as const,
			pinned: { clock: '2026-03-02T09:00:00Z', random: 'seeded' as const },
			counts: { captured: 1, unavailable: 0, axe: { passed: 1, failed: 0, incomplete: 0 } },
			steps: [
				{
					step: 1,
					description: 'The note opens',
					command: 'note-open',
					status: 'passed' as const,
					capture: { key: `${request.id}/1`, name: 'two-editors', status: 'captured' as const },
				},
			],
			captures: [
				{
					key: `${request.id}/1`,
					name: 'two-editors',
					step: 1,
					status: 'captured' as const,
					screenshot: null,
				},
			],
		})),
		recordDecision: vi.fn(async (request) => ({
			decision: 'dec-q7k2m4xab3na',
			kind: 'choice' as const,
			path: 'specimens/decisions/dec-q7k2m4xab3na.json',
			chosen: request.chosen,
			kept: ['toolbar--airy'],
			evidence: {
				set: 'set-9c03e1d27a55',
				dir: 'specimens/evidence/set-9c03e1d27a55/',
			},
			evidenceDir: 'specimens/evidence/set-9c03e1d27a55/',
			subjects: { specimens: [request.chosen] },
		})),
		getDecision: vi.fn(async (request) => ({
			decision: request.decision,
			id: request.decision,
			kind: 'choice' as const,
			slug: 'toolbar-density',
			status: 'current' as const,
			question: 'How dense should the toolbar be?',
			variants: ['toolbar--dense', 'toolbar--airy'],
			chosen: 'toolbar--dense',
			kept: ['toolbar--airy'],
			discarded: [],
			reason: 'Fits twelve commands.',
			evidence: {
				set: 'set-9c03e1d27a55',
				dir: 'specimens/evidence/set-9c03e1d27a55/',
				captures: [
					{
						key: 'toolbar--dense',
						id: 'toolbar--dense',
						status: 'captured' as const,
						hash: 'abc123',
						axe: 'passed' as const,
						screenshot: 'specimens/evidence/set-9c03e1d27a55/toolbar--dense.png',
					},
				],
			},
			subjects: { specimens: ['toolbar--dense'] },
			decidedAt: '2026-11-24T00:00:00.000Z',
			decidedBy: { kind: 'script' as const },
		})),
		listDecisions: vi.fn(async () => ({
			decisions: [
				{
					decision: 'dec-q7k2m4xab3na',
					question: 'How dense should the toolbar be?',
					chosen: 'toolbar--dense',
					stale: [],
				},
			],
			undecided: [],
		})),
		checkDecisions: vi.fn(async () => ({
			decisions: [
				{
					decision: 'dec-q7k2m4xab3na',
					question: 'How dense should the toolbar be?',
					chosen: 'toolbar--dense',
					reason: 'Fits twelve commands.',
					matched: { files: ['src/toolbar/toolbar.css'] },
				},
			],
		})),
		designStates: vi.fn(async () => ({
			defaultsVersion: 'afd-defaults@1.0.0',
			states: [
				{
					id: 'error-recovery',
					command: 'order-create',
					trigger: 'result.success === false',
					pattern: 'afd-defaults/error-recovery',
					source: 'default' as const,
					approvalStatus: 'approved' as const,
					setup: 'spec/wire/result-failure.json (order-create failure)',
				},
			],
			nextSteps: [
				'Call umbel: components-brief with patterns [afd-defaults/error-recovery] to load the approved pattern guidance before building the screen.',
			],
			unmeasured: [
				{
					area: 'screen-gates',
					reason: 'No specimen setup cases or captures exist yet to run portable pattern gates.',
					addToMeasure:
						'Bind specimen setups to these patterns and run specimen-capture and specimen-run.',
				},
			],
		})),
		panelWalk: vi.fn(async () => ({
			walk: 'walk-1234567890ab',
			job: 'publish-post',
			persona: 'screen-reader-user',
			modality: 'screen-reader' as const,
			ending: 'done' as const,
			actions: 1,
			path: {
				done: true,
				failed: 0,
				repeats: 0,
				outside: 0,
				deviations: 0,
			},
			findings: [],
			unmeasured: [],
		})),
		listDesignCards: vi.fn(async () => ({
			page: 'cards.html',
			cards: [],
			total: 0,
			more: 0,
			unmeasured: [],
		})),
		recordDesignRelease: vi.fn(async (request) => ({
			release: request.release,
			manifestPath: `specimens/releases/${request.release}.json`,
			releasedAt: '2026-11-26T00:00:00.000Z',
			decisions: request.decisions,
			nextSteps: [],
			unmeasured: [],
		})),
		patternFork: vi.fn(async (request) => ({
			pattern: request.target ?? request.source.split('/')[1] ?? 'error-recovery',
			path: `specimens/patterns/${request.target ?? 'error-recovery'}/pattern.json`,
			approvalStatus: 'proposed' as const,
			derivedFrom: {
				library: request.source.split('/')[0] ?? 'afd-defaults',
				pattern: request.source.split('/')[1] ?? 'error-recovery',
				version: '1.0.0',
				revision: `sha256:${'a'.repeat(64)}`,
				statements: { 'error-recovery.keep.next': `sha256:${'b'.repeat(64)}` },
			},
			bindingStatus: request.bind ? ('pending-approval' as const) : ('unbound' as const),
			card: 'card-f0rk00000001',
			nextSteps: ['Approve via decision-record.'],
		})),
		patternCompare: vi.fn(async (request) =>
			request?.pattern
				? {
						pattern: request.pattern,
						source: {
							library: 'afd-defaults',
							pattern: request.pattern,
							baseVersion: '1.0.0',
							currentVersion: '1.1.0',
						},
						statements: [],
						waivers: [],
						nextSteps: ['Run specimen-pattern-merge.'],
						unmeasured: [],
					}
				: {
						patterns: [],
						nextSteps: ['All copied patterns up to date.'],
						unmeasured: [],
					}
		),
		patternMerge: vi.fn(async (request) => ({
			pattern: request.pattern,
			card: 'card-m3rg00000001',
			upstreamVersion: request.upstreamVersion ?? '1.1.0',
			upstreamDigests: { 'error-recovery.keep.next': `sha256:${'c'.repeat(64)}` },
			accepted: request.accept ?? [],
			declined: request.decline ?? [],
			stagedStatus: 'proposed' as const,
			nextSteps: ['Approve via decision-record.'],
		})),
		close: vi.fn(async () => {}),
	};
	const createBench = vi.fn(async () => bench);
	return {
		output,
		errors,
		bench,
		createBench,
		io: {
			stdout: (text: string) => output.push(text),
			stderr: (text: string) => errors.push(text),
			createBench,
		},
	};
}

const cliSamplePoint = {
	id: 'pt-5r8k2w9m4c1x',
	specimen: 'example-toolbar',
	context: { theme: 'dark', viewport: '1280x800' },
	element: {
		ref: 'root/example-toolbar:1/shadow/example-button:1',
		tag: 'example-button',
		text: 'Share',
		box: { x: 420, y: 12, width: 84, height: 32 },
	},
	accessible: {
		role: 'button',
		name: 'Share',
		from: 'root/example-toolbar:1/shadow/example-button:1/shadow/button:1',
	},
	identity: {
		strongest: 'role-name' as const,
		roleName: { role: 'button', name: 'Share' },
		componentPosition: { tag: 'example-button', index: 1 },
		ref: 'root/example-toolbar:1/shadow/example-button:1',
	},
	source: {
		specimen: { module: 'src/toolbar/toolbar.specimens.ts', exportName: 'Toolbar' },
		digests: { 'src/example-button.ts': '4c1e9a071234abcd' },
	},
	ancestors: [],
	neighbourhood: {
		pageData: true as const,
		siblings: [],
		children: [],
		omitted: { siblings: 0, children: 0 },
	},
	pin: { x: 0.5, y: 0.5 },
	check: {
		command: 'specimen-point-check' as const,
		when: 'before editing source for this point' as const,
	},
};

let packValid = true;
const packReport = {
	library: 'example',
	directory: '/pack',
	problems: [],
	components: [],
	omitted: [],
	guides: { verified: 0, authored: 0, invalidClaims: [], claimed: 0 },
	examples: { kept: 0, leftOut: [] },
	selection: { component: null, complete: true, reason: 'Every case ran.' },
	cases: { total: 1, passed: 1, failed: [], retried: [], unstable: [], skipped: 0 },
	elapsedMs: 1,
};

describe('specimen CLI', () => {
	it('dispatches migrate as a preview unless --apply is given', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'migrate'], h.io)).toBe(0);
		expect(h.bench.migrate).toHaveBeenLastCalledWith({});
		expect(
			await runCli(
				['--root', root, 'migrate', '--files', './a.stories.ts,./b.stories.ts', '--apply'],
				h.io
			)
		).toBe(0);
		expect(h.bench.migrate).toHaveBeenLastCalledWith({
			files: ['./a.stories.ts', './b.stories.ts'],
			apply: true,
		});
		expect(await runCli(['--root', root, 'migrate', 'extra'], h.io)).toBe(1);
	});
	it('dispatches inspect with context options only', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'inspect', 'button', '--viewport', '375x812'], h.io)).toBe(
			0
		);
		expect(h.bench.inspect).toHaveBeenCalledWith({
			id: 'button',
			context: { viewport: { width: 375, height: 812 } },
		});
		expect(await runCli(['--root', root, 'inspect', 'button', '--screenshot', 'x.png'], h.io)).toBe(
			1
		);
	});
	it('dispatches run with context options and no checkpoint', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'run', 'button', '--theme', 'dark'], h.io)).toBe(0);
		expect(h.bench.run).toHaveBeenCalledWith({ id: 'button', context: { theme: 'dark' } });
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { id: 'button', outcome: { status: 'skipped' }, observation: null },
		});
		expect(await runCli(['--root', root, 'run', 'button', '--checkpoint', 'mount'], h.io)).toBe(1);
	});
	it('runs a suite without an id, and exits nonzero when its stories failed', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'run',
					'--tag',
					'smoke,keyboard',
					'--match',
					'Button',
					'--workers',
					'4',
					'--retry',
					'--flake-cap',
					'1',
					'--capture',
					'none',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.runSuite).toHaveBeenCalledWith({
			context: {},
			filter: { tags: ['smoke', 'keyboard'], match: 'Button' },
			workers: 4,
			retry: true,
			flakeCap: 1,
			capture: 'none',
		});
		h.bench.runSuite = vi.fn(async () => ({
			outcome: 'failed-after-retry' as const,
			counts: {
				total: 1,
				passed: 0,
				failed: 1,
				flaky: 0,
				skipped: 0,
				excluded: 0,
				outOfContext: 0,
			},
			retry: { ran: true },
			stories: [],
			workers: 2,
			elapsedMs: 1,
			sourcesChanged: false,
		}));
		expect(await runCli(['--root', root, 'run'], h.io)).toBe(1);
		// Suite options need the suite: with a story id they are a mistake, not ignored.
		expect(await runCli(['--root', root, 'run', 'button', '--workers', '2'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'run', '--workers', 'many'], h.io)).toBe(1);
	});
	it('dispatches a11y by id or filter, and exits nonzero when a check failed', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'a11y', 'button', '--checkpoint', 'mount'], h.io)).toBe(0);
		expect(h.bench.a11y).toHaveBeenCalledWith({ id: 'button', context: {}, checkpoint: 'mount' });
		expect(await runCli(['--root', root, 'a11y', '--tag', 'smoke', '--workers', '3'], h.io)).toBe(
			0
		);
		expect(h.bench.a11y).toHaveBeenLastCalledWith({
			context: {},
			filter: { tags: ['smoke'] },
			workers: 3,
		});
		h.bench.a11y = vi.fn(async () => ({
			reports: [],
			counts: { total: 1, passed: 0, warning: 0, failed: 1, notRun: 0 },
			workers: 2,
			elapsedMs: 1,
		}));
		expect(await runCli(['--root', root, 'a11y'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'a11y', 'button', '--workers', '2'], h.io)).toBe(1);
	});
	it('dispatches themes, reading --theme as a list, and exits nonzero when one is undeclared', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'themes',
					'--match',
					'auth',
					'--theme',
					'light,dark',
					'--threshold',
					'0.01',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.themes).toHaveBeenCalledWith({
			context: {},
			filter: { match: 'auth' },
			themes: ['light', 'dark'],
			threshold: 0.01,
		});
		expect(
			await runCli(['--root', root, 'themes', 'button', '--reduced-motion', 'reduce'], h.io)
		).toBe(0);
		expect(h.bench.themes).toHaveBeenLastCalledWith({
			id: 'button',
			context: { reducedMotion: 'reduce' },
		});
		expect(await runCli(['--root', root, 'themes', '--threshold', 'some'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'themes', 'button', '--tag', 'x'], h.io)).toBe(1);
		h.bench.themes = vi.fn(async () => ({
			themes: ['light' as const, 'dark' as const],
			checkpoint: 'mount',
			threshold: 0.02,
			valid: false,
			reports: [],
			counts: {
				total: 1,
				follows: 0,
				declared: 0,
				pinned: 0,
				undeclared: 1,
				contradicted: 0,
				unavailable: 0,
			},
			workers: 2,
			elapsedMs: 1,
		}));
		expect(await runCli(['--root', root, 'themes'], h.io)).toBe(1);
	});
	it('dispatches profile and baseline, and exits nonzero on a failed budget or a broken run', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'profile', 'button', '--runs', '5'], h.io)).toBe(0);
		expect(h.bench.profile).toHaveBeenCalledWith({ id: 'button', context: {}, runs: 5 });
		expect(await runCli(['--root', root, 'profile'], h.io)).toBe(0);
		expect(h.bench.profile).toHaveBeenLastCalledWith({ context: {} });
		expect(
			await runCli(['--root', root, 'baseline', 'button', '--note', 'After cutover'], h.io)
		).toBe(0);
		expect(h.bench.recordBaseline).toHaveBeenCalledWith({
			id: 'button',
			context: {},
			notes: ['After cutover'],
		});
		const counts = { total: 1, passed: 0, warnings: 0, notComparable: 0, noBaseline: 0 };
		const result = (failed: number, errored: number) => ({
			reports: [],
			counts: { ...counts, failed, errored },
			orphanedBaselines: [],
			elapsedMs: 1,
		});
		h.bench.profile = vi.fn(async () => result(1, 0));
		expect(await runCli(['--root', root, 'profile', 'button'], h.io)).toBe(1);
		h.bench.profile = vi.fn(async () => result(0, 1));
		expect(await runCli(['--root', root, 'profile', 'button'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'profile', 'button', '--runs', 'many'], h.io)).toBe(1);
	});
	it('dispatches matrix with its axes as lists', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'matrix',
					'button',
					'--theme',
					'light,dark',
					'--viewport',
					'375x812,1280x720',
					'--locale',
					'en-US,de',
					'--workers',
					'3',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.matrix).toHaveBeenCalledWith({
			id: 'button',
			axes: {
				theme: ['light', 'dark'],
				viewport: [
					{ width: 375, height: 812 },
					{ width: 1280, height: 720 },
				],
				locale: ['en-US', 'de'],
			},
			workers: 3,
		});
		expect(await runCli(['--root', root, 'matrix', 'button'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'matrix', '--theme', 'dark'], h.io)).toBe(1);
	});
	it('dispatches coverage for one component or all, with a selection', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'coverage'], h.io)).toBe(0);
		expect(h.bench.coverage).toHaveBeenLastCalledWith({});
		expect(
			await runCli(
				['--root', root, 'coverage', 'violet-button', '--file', './a.stories.ts', '--workers', '2'],
				h.io
			)
		).toBe(0);
		expect(h.bench.coverage).toHaveBeenLastCalledWith({
			component: 'violet-button',
			filter: { file: './a.stories.ts' },
			workers: 2,
		});
		expect(await runCli(['--root', root, 'coverage', 'a', 'b'], h.io)).toBe(1);
	});
	it('dispatches pack, pack-check and pack-export, and fails a check that found drift', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(['--root', root, 'pack', 'example-option', '--allow-failed', 'a,b'], h.io)
		).toBe(0);
		expect(h.bench.pack).toHaveBeenLastCalledWith({
			component: 'example-option',
			allowFailed: ['a', 'b'],
		});
		packValid = true;
		expect(await runCli(['--root', root, 'pack-check', '--workers', '2'], h.io)).toBe(0);
		expect(h.bench.packCheck).toHaveBeenLastCalledWith({ workers: 2 });
		packValid = false;
		expect(await runCli(['--root', root, 'pack-check'], h.io)).toBe(1);
		packValid = true;
		expect(
			await runCli(['--root', root, 'pack-export', 'out', '--revision', 'a'.repeat(40)], h.io)
		).toBe(0);
		expect(h.bench.packExport).toHaveBeenLastCalledWith({
			directory: join(root, 'out'),
			revision: 'a'.repeat(40),
		});
		expect(await runCli(['--root', root, 'pack-export'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'pack', '--revision', 'x'], h.io)).toBe(1);
	});
	it('dispatches point, point-move, and point-check with pointer URIs, role/selector targets, and index', async () => {
		const h = harness();
		const root = await directory();
		const uri =
			'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1';
		expect(await runCli(['--root', root, 'point', uri], h.io)).toBe(0);
		expect(h.bench.point).toHaveBeenLastCalledWith({ pointer: uri });

		expect(
			await runCli(
				[
					'--root',
					root,
					'point',
					'example-toolbar',
					'--role',
					'button',
					'--name',
					'Share',
					'--theme',
					'dark',
					'--viewport',
					'1280x800',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.point).toHaveBeenLastCalledWith({
			id: 'example-toolbar',
			context: { theme: 'dark', viewport: { width: 1280, height: 800 } },
			target: { role: 'button', name: 'Share' },
		});

		expect(
			await runCli(['--root', root, 'point', 'example-toolbar', '--selector', 'button.share'], h.io)
		).toBe(0);
		expect(h.bench.point).toHaveBeenLastCalledWith({
			id: 'example-toolbar',
			target: { selector: 'button.share' },
		});

		expect(await runCli(['--root', root, 'point-move', 'pt-5r8k2w9m4c1x', 'next'], h.io)).toBe(0);
		expect(h.bench.pointMove).toHaveBeenLastCalledWith({ id: 'pt-5r8k2w9m4c1x', to: 'next' });

		expect(
			await runCli(['--root', root, 'point-move', 'pt-5r8k2w9m4c1x', 'child', '--index', '2'], h.io)
		).toBe(0);
		expect(h.bench.pointMove).toHaveBeenLastCalledWith({
			id: 'pt-5r8k2w9m4c1x',
			to: 'child',
			index: 2,
		});

		expect(await runCli(['--root', root, 'point-check', 'pt-5r8k2w9m4c1x'], h.io)).toBe(0);
		expect(h.bench.pointCheck).toHaveBeenLastCalledWith({ id: 'pt-5r8k2w9m4c1x' });

		// Invalid option combinations
		expect(
			await runCli(
				['--root', root, 'point', 'example-toolbar', '--role', 'button', '--selector', 'button'],
				h.io
			)
		).toBe(1);
		expect(
			await runCli(['--root', root, 'point', 'example-toolbar', '--name', 'Share'], h.io)
		).toBe(1);
		expect(await runCli(['--root', root, 'point', uri, '--theme', 'dark'], h.io)).toBe(1);
		expect(
			await runCli(
				['--root', root, 'point-move', 'pt-5r8k2w9m4c1x', 'child', '--index', 'bad'],
				h.io
			)
		).toBe(1);
		expect(await runCli(['--root', root, 'point-move', 'pt-5r8k2w9m4c1x'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'point-check'], h.io)).toBe(1);
	});
	it('dispatches suggest, and writes the proposal only where nothing is', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(['--root', root, 'suggest', 'x-a', '--gaps', 'default,form:validity'], h.io)
		).toBe(0);
		expect(h.bench.suggest).toHaveBeenLastCalledWith({
			component: 'x-a',
			gaps: ['default', 'form:validity'],
		});
		expect(
			await runCli(['--root', root, 'suggest', 'x-a', '--out', 'x-a.specimens.ts'], h.io)
		).toBe(0);
		expect(await readFile(join(root, 'x-a.specimens.ts'), 'utf8')).toBe('// proposed');
		await writeFile(join(root, 'x-a.specimens.ts'), '// corrected');
		expect(
			await runCli(['--root', root, 'suggest', 'x-a', '--out', 'x-a.specimens.ts'], h.io)
		).toBe(1);
		expect(await readFile(join(root, 'x-a.specimens.ts'), 'utf8')).toBe('// corrected');
		expect(await runCli(['--root', root, 'suggest'], h.io)).toBe(1);
	});
	it('dispatches contract, and exits non-zero when it is not valid', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'contract', 'violet-button'], h.io)).toBe(0);
		expect(h.bench.contract).toHaveBeenLastCalledWith({ component: 'violet-button' });
		expect(await runCli(['--root', root, 'contract', '--file', './a.stories.ts'], h.io)).toBe(0);
		expect(h.bench.contract).toHaveBeenLastCalledWith({ filter: { file: './a.stories.ts' } });
		vi.mocked(h.bench.contract).mockResolvedValueOnce({
			rules: 'fastbot-parity@1',
			valid: false,
			findings: [{ code: 'MISSING_STORY', severity: 'error', message: 'a', suggestion: 'b' }],
			counts: { errors: 1, warnings: 0 },
			stats: { components: 1, storyFiles: 0, scoped: false },
			cases: { total: 0, passed: 0, failed: [] },
			workers: 2,
			elapsedMs: 1,
		});
		expect(await runCli(['--root', root, 'contract'], h.io)).toBe(1);
	});
	it('exits non-zero when a case behind the coverage failed', async () => {
		const h = harness();
		const root = await directory();
		vi.mocked(h.bench.coverage).mockResolvedValueOnce({
			obligations: 'schema-partitions@1',
			complete: false,
			components: [],
			counts: { verified: 0, asserted: 0, represented: 0, missing: 0, unknown: 0 },
			waived: 0,
			waivers: { version: null, unused: [] },
			invalidClaims: [],
			cases: { total: 1, passed: 0, failed: [{ id: 'a', message: 'b' }], skipped: 0 },
			workers: 2,
			elapsedMs: 1,
		});
		expect(await runCli(['--root', root, 'coverage'], h.io)).toBe(1);
	});
	it('dispatches validate with an optional story or file', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'validate', '--id', 'button'], h.io)).toBe(0);
		expect(h.bench.validate).toHaveBeenCalledWith({ id: 'button' });
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { valid: true, scope: 'static' },
		});
		expect(await runCli(['--root', root, 'validate', '--file', 'src/a.stories.ts'], h.io)).toBe(0);
		expect(h.bench.validate).toHaveBeenLastCalledWith({ file: 'src/a.stories.ts' });
		expect(await runCli(['--root', root, 'validate', 'extra'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'list', '--id', 'button'], h.io)).toBe(1);
	});

	it('dispatches list and emits one JSON result', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'list'], h.io)).toBe(0);
		expect(h.createBench).toHaveBeenCalledWith({ root, configFile: undefined });
		expect(h.bench.close).toHaveBeenCalledTimes(1);
		expect(h.output).toHaveLength(1);
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { specimens: [{ id: 'button' }] },
		});
	});
	it('rejects malformed options and positional counts without starting a browser', async () => {
		const cases = [
			[],
			['wat'],
			['list', 'extra'],
			['render'],
			['render', 'button', '--root'],
			['list', '--wat'],
			['list', '--root', 'one', '--root', 'two'],
			['list', '--viewport', '375x812'],
			['diff', 'one.json'],
		];
		for (const args of cases) {
			const h = harness();
			expect(await runCli(args, h.io)).toBe(1);
			expect(h.createBench).not.toHaveBeenCalled();
			expect(JSON.parse(h.output[0] ?? '').error.code).toBe('SPECIMEN_CLI_ERROR');
			expect(h.errors.length).toBeGreaterThan(0);
		}
	});
	it('keeps invalid viewport and theme values out of render execution', async () => {
		for (const args of [
			['render', 'button', '--viewport', 'phone'],
			['render', 'button', '--viewport', '0x812'],
			['render', 'button', '--theme', 'drak'],
			['render', 'button', '--reduced-motion', 'less'],
			['render', 'button', '--motion', 'frozen'],
			['render', 'button', '--locale', 'not a locale'],
		]) {
			const h = harness();
			expect(await runCli(args, h.io)).toBe(1);
			expect(h.bench.render).not.toHaveBeenCalled();
			expect(h.bench.close).toHaveBeenCalledTimes(1);
		}
	});
	it('sends render options through the schema and closes on handler failure', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'render',
					'button',
					'--root',
					root,
					'--viewport',
					'375x812',
					'--container',
					'300x500',
					'--theme',
					'dark',
					'--locale',
					'fr-FR',
					'--reduced-motion',
					'reduce',
					'--motion',
					'settled',
					'--checkpoint',
					'focused',
					'--screenshot',
					'shot.png',
				],
				h.io
			)
		).toBe(1);
		expect(h.bench.render).toHaveBeenCalledWith({
			id: 'button',
			context: {
				viewport: { width: 375, height: 812 },
				container: { width: 300, height: 500 },
				theme: 'dark',
				locale: 'fr-FR',
				reducedMotion: 'reduce',
				motion: 'settled',
			},
			checkpoint: 'focused',
			screenshot: join(root, 'shot.png'),
		});
		expect(h.bench.close).toHaveBeenCalledTimes(1);
		expect(JSON.parse(h.output[0] ?? '').error.code).toBe('SPECIMEN_RENDER_FAILED');
	});
	it('writes full result JSON atomically and resolves build paths against root', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(['build', 'site', '--root', root, '--output', 'reports/build.json'], h.io)
		).toBe(0);
		expect(h.bench.build).toHaveBeenCalledWith(join(root, 'site'));
		expect(JSON.parse(await readFile(join(root, 'reports/build.json'), 'utf8'))).toMatchObject({
			success: true,
			data: { directory: join(root, 'site') },
		});
	});
	it('rejects malformed JSON captures without initializing a bench', async () => {
		const h = harness();
		const root = await directory();
		await writeFile(join(root, 'a.json'), '{}');
		await writeFile(join(root, 'b.json'), '{}');
		expect(
			await runCli(['diff', 'a.json', 'b.json', '--root', root, '--require-visual'], h.io)
		).toBe(1);
		expect(h.createBench).not.toHaveBeenCalled();
		expect(JSON.parse(h.output[0] ?? '').error.code).toBe('VALIDATION_ERROR');
		await writeFile(join(root, 'a.json'), '{bad json');
		expect(await runCli(['diff', 'a.json', 'b.json', '--root', root], h.io)).toBe(1);
		expect(JSON.parse(h.output[1] ?? '').error.code).toBe('SPECIMEN_CLI_ERROR');
	});
	it('reports setup and disposal failures as nonzero results', async () => {
		const h = harness();
		h.createBench.mockRejectedValueOnce(new Error('Invalid config'));
		expect(await runCli(['list'], h.io)).toBe(1);
		h.bench.close = vi.fn(async () => {
			throw new Error('Cleanup failed');
		});
		expect(await runCli(['list'], h.io)).toBe(1);
		expect(JSON.parse(h.output[1] ?? '')).toMatchObject({ success: false });
	});
	it('defaults to one stdout JSON value and stderr diagnostics without injected IO', async () => {
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		try {
			expect(await runCli(['wat'])).toBe(1);
			expect(stdout).toHaveBeenCalledTimes(1);
			expect(JSON.parse(String(stdout.mock.calls[0]?.[0])).error.code).toBe('SPECIMEN_CLI_ERROR');
			expect(String(stderr.mock.calls[0]?.[0])).toContain('Unknown command');
		} finally {
			stdout.mockRestore();
			stderr.mockRestore();
		}
	});

	it('dispatches capture with labels, filters, --no-axe and keeps 142-entry stdout under 4 KB with no observation', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(['--root', root, 'capture', '--label', 'main', '--theme', 'light'], h.io)
		).toBe(0);
		expect(h.bench.captureSet).toHaveBeenLastCalledWith({
			label: 'main',
			context: { theme: 'light' },
		});
		const stdoutJson = h.output[0] ?? '';
		expect(Buffer.byteLength(stdoutJson, 'utf8')).toBeLessThan(4096);
		expect(stdoutJson).not.toContain('channels');
		expect(JSON.parse(stdoutJson)).toMatchObject({
			success: true,
			data: { set: 'set-4f1c0a9e2b7d', label: 'main', counts: { captured: 142 } },
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'capture',
					'toolbar--dense',
					'toolbar--airy',
					'--no-axe',
					'--checkpoint',
					'mount',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.captureSet).toHaveBeenLastCalledWith({
			ids: ['toolbar--dense', 'toolbar--airy'],
			axe: false,
			checkpoint: 'mount',
		});

		expect(
			await runCli(['--root', root, 'capture', '--kind', 'gate', '--workers', '4'], h.io)
		).toBe(0);
		expect(h.bench.captureSet).toHaveBeenLastCalledWith({
			filter: { kind: ['gate'] },
			workers: 4,
		});

		expect(await runCli(['--root', root, 'capture', '--ids', 'a', '--file', './a.ts'], h.io)).toBe(
			1
		);
	});

	it('dispatches set-backed diff without starting a bench and validates paired set/id options', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'diff',
					'--left-set',
					'main',
					'--left-id',
					'toolbar--dense',
					'--right-set',
					'dark',
					'--right-id',
					'toolbar--dense',
				],
				h.io
			)
		).toBe(1);
		expect(h.createBench).not.toHaveBeenCalled();
		expect(JSON.parse(h.output[0] ?? '').error.code).toBe('CAPTURE_SET_NOT_FOUND');

		expect(await runCli(['--root', root, 'diff', '--left-set', 'main', 'right.json'], h.io)).toBe(
			1
		);
		expect(JSON.parse(h.output[1] ?? '').error.code).toBe('SPECIMEN_CLI_ERROR');

		// Happy path: set-to-set refusal, --allow-context override, and mixed set + file diff.
		const { CAPTURE_VERSION, NORMALIZATION_VERSION, writeCaptureSet } = await import(
			'@lushly-dev/specimen'
		);
		const baseContext = {
			viewport: { width: 1280, height: 720 },
			theme: 'light' as const,
			locale: 'en-US',
			reducedMotion: 'no-preference' as const,
			motion: 'natural' as const,
		};
		const makeObs = (theme: 'light' | 'dark', dom: string) => ({
			manifest: {
				captureVersion: CAPTURE_VERSION,
				normalizationVersion: NORMALIZATION_VERSION,
				specimenId: 'toolbar--dense',
				capturedUtc: '2026-11-23T00:00:00.000Z',
				bench: { name: 'specimen', version: '0.1.0', plugins: [] },
				driver: { name: 'host' as const, emulates: ['viewport', 'color-scheme'] },
				checkpoint: {
					name: 'mount',
					actionMode: 'none' as const,
					ready: {
						steps: ['upgrade', 'fonts', 'frame'],
						outcome: 'ready' as const,
						deadlineMs: 10000,
					},
					baseline: {
						clock: 'real' as const,
						random: { source: 'seeded' as const, seed: 0x5b3c1a2d },
						storage: 'empty' as const,
					},
				},
				source: { revision: 'a1b2c3d', dirty: false, digest: 'abc' },
				dependencies: 'lock-1',
				browser: { name: 'chromium', version: '130.0', platform: 'win32-x64', build: 'b1' },
				context: {
					...baseContext,
					theme,
					pixelRatio: 1,
					observed: {
						width: 1280,
						height: 720,
						media: true,
						colorScheme: theme === 'dark' ? ('dark' as const) : ('light' as const),
						contrast: 'no-preference' as const,
						reducedMotion: 'no-preference' as const,
						language: 'en-US',
						devicePixelRatio: 1,
					},
					resources: { fonts: [], remote: [] },
				},
			},
			channels: {
				dom: { raw: dom, normalized: dom },
				a11y: { snapshot: 'toolbar', axe: 'not-run' as const },
				events: { declared: [], history: [] },
				evidence: {
					expectations: [],
					claims: [],
					commands: [],
					formData: [],
					validity: [],
					attributesSet: [],
				},
				elements: [],
				console: { errors: [], warnings: [] },
				visual: { path: null },
			},
			completeness: {
				dom: { status: 'complete' as const, scope: 'dom', reasons: [] },
				a11y: { status: 'partial' as const, scope: 'a11y', reasons: ['AXE_NOT_RUN'] },
				layout: { status: 'complete' as const, scope: 'layout', reasons: [] },
				styles: { status: 'complete' as const, scope: 'styles', reasons: [] },
				tokens: { status: 'unsupported' as const, scope: 'tokens', reasons: [] },
				events: { status: 'not-requested' as const, scope: 'events', reasons: [] },
				visual: { status: 'not-requested' as const, scope: 'visual', reasons: [] },
			},
		});
		const lightObs = makeObs('light', '<div>light</div>');
		const darkObs = makeObs('dark', '<div>dark</div>');
		await writeCaptureSet(root, {
			kind: 'capture',
			context: baseContext,
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: lightObs.manifest.checkpoint.baseline,
			},
			browser: { name: 'chromium', version: '130.0' },
			axe: false,
			revision: 'a1b2c3d',
			dirty: false,
			label: 'main',
			entries: [
				{ key: 'toolbar--dense', id: 'toolbar--dense', status: 'captured', observation: lightObs },
			],
			skipped: { jobs: 0, gates: 0 },
		});
		await writeCaptureSet(root, {
			kind: 'capture',
			context: { ...baseContext, theme: 'dark' },
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: darkObs.manifest.checkpoint.baseline,
			},
			browser: { name: 'chromium', version: '130.0' },
			axe: false,
			revision: 'a1b2c3d',
			dirty: false,
			label: 'dark',
			entries: [
				{ key: 'toolbar--dense', id: 'toolbar--dense', status: 'captured', observation: darkObs },
			],
			skipped: { jobs: 0, gates: 0 },
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'diff',
					'--left-set',
					'main',
					'--left-id',
					'toolbar--dense',
					'--right-set',
					'dark',
					'--right-id',
					'toolbar--dense',
				],
				h.io
			)
		).toBe(1);
		expect(JSON.parse(h.output[2] ?? '').error).toMatchObject({
			code: 'CAPTURES_INCOMPARABLE',
			message: expect.stringContaining('context.theme'),
			suggestion: expect.stringContaining('allowContextDifferences'),
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'diff',
					'--left-set',
					'main',
					'--left-id',
					'toolbar--dense',
					'--right-set',
					'dark',
					'--right-id',
					'toolbar--dense',
					'--allow-context',
					'theme',
				],
				h.io
			)
		).toBe(0);
		expect(JSON.parse(h.output[3] ?? '')).toMatchObject({
			success: true,
			data: { status: 'changed' },
		});

		const rightFile = join(root, 'right-light.json');
		await writeFile(rightFile, JSON.stringify(lightObs), 'utf8');
		expect(
			await runCli(
				['--root', root, 'diff', '--left-set', 'main', '--left-id', 'toolbar--dense', rightFile],
				h.io
			)
		).toBe(0);
		expect(JSON.parse(h.output[4] ?? '')).toMatchObject({
			success: true,
			data: { status: 'no-change-observed' },
		});
		expect(h.createBench).not.toHaveBeenCalled();
	});

	it('passes --kind to specimen-list and rejects invalid kinds', async () => {
		const h = harness();
		h.bench.list = () => [
			{
				id: 'button',
				title: 'Components/Button',
				module: './button.ts',
				exportName: 'Button',
			},
			{
				id: 'example-keep-a-draft',
				title: 'Notes/Keep a draft',
				module: './notes.ts',
				exportName: 'NotesApp',
				job: {
					scenario: './keep-a-draft.scenario.yaml',
					target: 'app',
					captures: [{ after: 'The note opens', name: 'open' }],
				},
			},
		];

		expect(await runCli(['--root', '.', 'list', '--kind', 'component'], h.io)).toBe(0);
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { specimens: [{ id: 'button', kind: 'component' }] },
		});

		expect(await runCli(['--root', '.', 'list', '--kind', 'job'], h.io)).toBe(0);
		expect(JSON.parse(h.output[1] ?? '')).toMatchObject({
			success: true,
			data: { specimens: [{ id: 'example-keep-a-draft', kind: 'job' }] },
		});

		expect(await runCli(['--root', '.', 'list', '--kind', 'invalid'], h.io)).toBe(1);
		expect(JSON.parse(h.output[2] ?? '')).toMatchObject({ success: false });
	});

	it('dispatches compare with positional or --ids variants and prints no observation to stdout', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'compare',
					'toolbar--dense',
					'toolbar--airy',
					'toolbar--grouped',
					'--theme',
					'light',
					'--viewport',
					'1280x800',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.compare).toHaveBeenLastCalledWith({
			ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
			context: { theme: 'light', viewport: { width: 1280, height: 800 } },
		});
		const rawStdout = h.output[0] ?? '';
		const parsed = JSON.parse(rawStdout);
		expect(parsed).toMatchObject({
			success: true,
			data: {
				set: 'set-1a2b3c4d5e6f',
				captures: [
					{ id: 'toolbar--dense', axe: 'passed' },
					{ id: 'toolbar--airy', axe: 'passed' },
					{ id: 'toolbar--grouped', axe: 'failed', violations: ['color-contrast'] },
				],
				page: 'compare.html?set=set-1a2b3c4d5e6f',
			},
		});
		// Exit criterion 1: CLI stdout prints no observation.
		expect(rawStdout).not.toContain('"manifest"');
		expect(rawStdout).not.toContain('"completeness"');

		expect(
			await runCli(
				[
					'--root',
					root,
					'compare',
					'--ids',
					'toolbar--dense,toolbar--airy',
					'--checkpoint',
					'after-run',
					'--workers',
					'2',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.compare).toHaveBeenLastCalledWith({
			ids: ['toolbar--dense', 'toolbar--airy'],
			checkpoint: 'after-run',
			workers: 2,
		});

		// Rejects mixing positional ids with --ids, or using --no-axe on compare.
		expect(
			await runCli(['--root', root, 'compare', 'toolbar--dense', '--ids', 'toolbar--airy'], h.io)
		).toBe(1);
		expect(
			await runCli(['--root', root, 'compare', 'toolbar--dense', 'toolbar--airy', '--no-axe'], h.io)
		).toBe(1);
	});

	it('dispatches job-create, job-run, render --set, and a11y --set', async () => {
		const h = harness();
		const root = await directory();

		// job-create with comma-separated step numbers and pin-clock
		expect(
			await runCli(
				[
					'--root',
					root,
					'job-create',
					'example-keep-a-draft',
					'--scenario',
					'./scenarios/keep-a-draft.scenario.yaml',
					'--module',
					'./app.specimens.ts',
					'--export-name',
					'NotesApp',
					'--target',
					'app',
					'--pin-clock',
					'2026-03-02T09:00:00Z',
					'--captures',
					'3,4',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.createJob).toHaveBeenLastCalledWith({
			id: 'example-keep-a-draft',
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			module: './app.specimens.ts',
			exportName: 'NotesApp',
			target: 'app',
			pin: { clock: '2026-03-02T09:00:00Z' },
			captures: [3, 4],
		});

		// job-create with JSON array captures
		expect(
			await runCli(
				[
					'--root',
					root,
					'job-create',
					'example-keep-a-draft',
					'--scenario',
					'./scenarios/keep-a-draft.scenario.yaml',
					'--module',
					'./app.specimens.ts',
					'--export-name',
					'NotesApp',
					'--target',
					'app',
					'--captures',
					'[{"step":3,"name":"two-editors"}]',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.createJob).toHaveBeenLastCalledWith({
			id: 'example-keep-a-draft',
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			module: './app.specimens.ts',
			exportName: 'NotesApp',
			target: 'app',
			captures: [{ step: 3, name: 'two-editors' }],
		});

		// job-run passing exits 0 and prints references only
		expect(
			await runCli(
				[
					'--root',
					root,
					'job-run',
					'example-keep-a-draft',
					'--label',
					'main',
					'--theme',
					'dark',
					'--timeout',
					'15000',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.runJob).toHaveBeenLastCalledWith({
			id: 'example-keep-a-draft',
			context: { theme: 'dark' },
			label: 'main',
			timeoutMs: 15000,
		});
		expect(h.output.at(-1) ?? '').not.toContain('"channels"');

		// job-run with status: failed exits 1 while returning valid CommandResult JSON
		vi.mocked(h.bench.runJob).mockResolvedValueOnce({
			set: 'set-4f1c0a9e2b7d',
			label: null,
			id: 'example-keep-a-draft',
			job: 'keep-a-draft',
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			status: 'failed',
			pinned: { clock: '2026-03-02T09:00:00Z', random: 'seeded' },
			counts: { captured: 0, unavailable: 1, axe: { passed: 0, failed: 0, incomplete: 0 } },
			steps: [{ step: 1, status: 'failed', error: 'Step 1 failed' }],
			captures: [
				{
					key: 'example-keep-a-draft/1',
					name: 'two-editors',
					step: 1,
					status: 'not-taken',
					reason: 'Step 1 failed; capture not taken.',
					screenshot: null,
				},
			],
		});
		expect(await runCli(['--root', root, 'job-run', 'example-keep-a-draft'], h.io)).toBe(1);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: true,
			data: { status: 'failed' },
		});

		// render --set and a11y --set dispatch cleanly without empty context noise
		await runCli(
			[
				'--root',
				root,
				'render',
				'example-keep-a-draft',
				'--set',
				'set-4f1c0a9e2b7d',
				'--checkpoint',
				'two-editors',
			],
			h.io
		);
		expect(h.bench.render).toHaveBeenLastCalledWith({
			id: 'example-keep-a-draft',
			set: 'set-4f1c0a9e2b7d',
			checkpoint: 'two-editors',
		});

		expect(await runCli(['--root', root, 'a11y', '--set', 'set-4f1c0a9e2b7d'], h.io)).toBe(0);
		expect(h.bench.a11y).toHaveBeenLastCalledWith({ set: 'set-4f1c0a9e2b7d' });

		// Invalid captures / timeout are refused cleanly
		expect(
			await runCli(
				[
					'--root',
					root,
					'job-create',
					'x',
					'--scenario',
					'./s.yaml',
					'--module',
					'./a.ts',
					'--export-name',
					'A',
					'--target',
					'app',
					'--captures',
					'0',
				],
				h.io
			)
		).toBe(1);
		expect(await runCli(['--root', root, 'job-run', 'x', '--timeout', 'bad'], h.io)).toBe(1);
	});

	it('dispatches coverage with --obligations jobs@1 and --captures, and rejects invalid combinations', async () => {
		const h = harness();
		const root = await directory();
		vi.mocked(h.bench.coverage).mockResolvedValueOnce({
			obligations: 'jobs@1',
			complete: false,
			components: [
				{
					tag: 'example-notice',
					sources: ['manifest'],
					cases: 1,
					obligations: [],
					counts: { verified: 0, asserted: 0, represented: 1, missing: 1, unknown: 0 },
					openEnded: [],
					unknownToSchema: ['commands'],
					jobs: {
						reachedBy: [{ key: 'example-keep-a-draft/4', name: 'conflict-notice', step: 4 }],
						unreached: ['variant=error'],
					},
				},
			],
			counts: { verified: 0, asserted: 0, represented: 1, missing: 1, unknown: 0 },
			waived: 0,
			waivers: { version: null, unused: [] },
			invalidClaims: [],
			cases: { total: 1, passed: 1, failed: [], skipped: 0 },
			workers: 1,
			elapsedMs: 1,
		});
		expect(
			await runCli(
				[
					'--root',
					root,
					'coverage',
					'example-notice',
					'--obligations',
					'jobs@1',
					'--captures',
					'main',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.coverage).toHaveBeenLastCalledWith({
			component: 'example-notice',
			obligations: 'jobs@1',
			captures: 'main',
		});
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: true,
			data: {
				obligations: 'jobs@1',
				components: [
					{
						tag: 'example-notice',
						jobs: {
							reachedBy: [{ key: 'example-keep-a-draft/4', name: 'conflict-notice', step: 4 }],
							unreached: ['variant=error'],
						},
					},
				],
			},
		});

		// Missing --captures with --obligations jobs@1 fails validation.
		expect(await runCli(['--root', root, 'coverage', '--obligations', 'jobs@1'], h.io)).toBe(1);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR' },
		});

		// --captures without --obligations jobs@1 fails validation.
		expect(await runCli(['--root', root, 'coverage', '--captures', 'main'], h.io)).toBe(1);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR' },
		});
	});

	it('forwards Patterns B3 flags for list, run, coverage, and tagless suggest', async () => {
		const h = harness();
		const root = await directory();
		h.bench.list = vi.fn(() => [
			{
				id: 'sel--gate--named',
				title: 'select / named',
				module: 'specimens/patterns/select/pattern.json',
				exportName: 'named',
				kind: 'gate' as const,
				component: 'example-select',
				pattern: { library: 'example', pattern: 'select', setup: 'default', gate: 'named' },
			},
		]);
		expect(
			await runCli(
				[
					'--root',
					root,
					'list',
					'--kind',
					'gate',
					'--component',
					'example-select',
					'--pattern',
					'select',
					'--match',
					'named',
					'--limit',
					'10',
				],
				h.io
			)
		).toBe(0);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: true,
			data: { specimens: [{ id: 'sel--gate--named', kind: 'gate' }] },
		});

		h.bench.run = vi.fn(async () => ({
			id: 'sel--gate--named',
			outcome: { status: 'passed' as const, failures: [] },
			observation: null,
		}));
		expect(
			await runCli(['--root', root, 'run', 'sel--gate--named', '--capture', 'none'], h.io)
		).toBe(0);
		expect(h.bench.run).toHaveBeenLastCalledWith({
			id: 'sel--gate--named',
			context: {},
			capture: 'none',
		});

		expect(
			await runCli(['--root', root, 'run', '--kind', 'gate', '--pattern', 'select'], h.io)
		).toBe(0);
		expect(h.bench.runSuite).toHaveBeenLastCalledWith({
			context: {},
			filter: { kind: ['gate'], pattern: 'select' },
		});

		expect(await runCli(['--root', root, 'coverage', '--pattern', 'example/select'], h.io)).toBe(0);
		expect(h.bench.coverage).toHaveBeenLastCalledWith({ pattern: 'example/select' });

		h.bench.suggest = vi.fn(async () => ({
			status: 'unverified' as const,
			file: 'select.specimens.ts',
			source: '// stub\n',
			entries: [
				{
					id: 'select-default-setup',
					title: 'select/SelectDefaultSetup',
					module: './select.specimens.ts',
					exportName: 'SelectDefaultSetup',
					patternSetup: { library: 'example', pattern: 'select', setup: 'default' },
				},
			],
			suggestions: [
				{
					obligation: 'pattern:example/select.keep.named',
					exportName: 'SelectDefaultSetup',
					placeholder: true,
				},
			],
			skipped: [],
			elapsedMs: 1,
		}));
		expect(
			await runCli(
				[
					'--root',
					root,
					'suggest',
					'--pattern',
					'example/select',
					'--gaps',
					'pattern:example/select.keep.named',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.suggest).toHaveBeenLastCalledWith({
			pattern: 'example/select',
			gaps: ['pattern:example/select.keep.named'],
		});
	});

	it('dispatches note-add, note-list, note-check, note-move, note-resolve, and note-reopen', async () => {
		const h = harness();
		const root = await directory();
		const uri =
			'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:2&pin=0.4,0.6';

		expect(
			await runCli(
				[
					'--root',
					root,
					'note-add',
					'--pointer',
					uri,
					'--text',
					'Export needs PDF',
					'--assignee',
					'agent',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.noteAdd).toHaveBeenLastCalledWith({
			pointer: uri,
			text: 'Export needs PDF',
			assignee: 'agent',
		});

		expect(
			await runCli(['--root', root, 'note-add', 'pt-5r8k2w9m4c1x', '--text', 'From point'], h.io)
		).toBe(0);
		expect(h.bench.noteAdd).toHaveBeenLastCalledWith({
			point: 'pt-5r8k2w9m4c1x',
			text: 'From point',
		});

		// Empty --text passes through to specimen-note-add instead of failing option parsing
		vi.mocked(h.bench.noteAdd).mockRejectedValueOnce(
			Object.assign(new Error('Note text cannot be empty.'), {
				code: 'NOTE_EMPTY',
				suggestion: 'Say what you noticed.',
			})
		);
		expect(await runCli(['--root', root, 'note-add', '--pointer', uri, '--text', ''], h.io)).toBe(
			1
		);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: false,
			error: { code: 'NOTE_EMPTY' },
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'note-list',
					'--specimen',
					'example-toolbar',
					'--state',
					'open',
					'--assignee',
					'agent',
					'--orphaned',
					'--limit',
					'10',
					'--after',
					'note-111111111111',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.noteList).toHaveBeenLastCalledWith({
			specimen: 'example-toolbar',
			state: 'open',
			assignee: 'agent',
			orphaned: true,
			limit: 10,
			after: 'note-111111111111',
		});
		expect(await runCli(['--root', root, 'note-list', '--orphaned', '--no-orphaned'], h.io)).toBe(
			1
		);

		expect(await runCli(['--root', root, 'note-check', 'example-toolbar'], h.io)).toBe(0);
		expect(h.bench.noteCheck).toHaveBeenLastCalledWith({ specimen: 'example-toolbar' });
		expect(await runCli(['--root', root, 'note-check'], h.io)).toBe(0);
		expect(h.bench.noteCheck).toHaveBeenLastCalledWith({});

		expect(
			await runCli(
				[
					'--root',
					root,
					'note-move',
					'note-7k2m9q4x1r8t',
					'--point',
					'pt-5r8k2w9m4c1x',
					'--reason',
					'Archive moved into menu',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.noteMove).toHaveBeenLastCalledWith({
			id: 'note-7k2m9q4x1r8t',
			point: 'pt-5r8k2w9m4c1x',
			reason: 'Archive moved into menu',
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'note-resolve',
					'note-9v4b7n2k5m1c',
					'--outcome',
					'fixed',
					'--reason',
					'Export offers CSV and PDF',
					'--revision',
					'4f2c9a1',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.noteResolve).toHaveBeenLastCalledWith({
			id: 'note-9v4b7n2k5m1c',
			outcome: 'fixed',
			reason: 'Export offers CSV and PDF',
			evidence: { revision: '4f2c9a1' },
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'note-resolve',
					'--ids',
					'note-q4z1m6t9b2xe,note-w8c3r5y0k7aj',
					'--outcome',
					'obsolete',
					'--reason',
					'Filter bar removed',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.noteResolve).toHaveBeenLastCalledWith({
			ids: ['note-q4z1m6t9b2xe', 'note-w8c3r5y0k7aj'],
			outcome: 'obsolete',
			reason: 'Filter bar removed',
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'note-reopen',
					'note-9v4b7n2k5m1c',
					'--reason',
					'PDF fails on long reports',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.noteReopen).toHaveBeenLastCalledWith({
			id: 'note-9v4b7n2k5m1c',
			reason: 'PDF fails on long reports',
		});
	});

	it('dispatches decision-record, decision-get, decision-list, and decision-check through CLI options', async () => {
		const h = harness();
		const root = await directory();

		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-record',
					'--slug',
					'toolbar-density',
					'--question',
					'How dense should the toolbar be?',
					'--set',
					'set-9c03e1d27a55',
					'--chosen',
					'toolbar--dense',
					'--reason',
					'Fits twelve commands.',
					'--files',
					'src/toolbar/**/*.{ts,css},src/shared/*.css',
					'--tokens',
					'space.toolbar.gap',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.recordDecision).toHaveBeenLastCalledWith(
			{
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: 'set-9c03e1d27a55',
				chosen: 'toolbar--dense',
				reason: 'Fits twelve commands.',
				subjects: {
					files: ['src/toolbar/**/*.{ts,css}', 'src/shared/*.css'],
					tokens: ['space.toolbar.gap'],
				},
			},
			{ decidedBy: { kind: 'script' }, humanConfirmed: false, invokingActorKind: 'script' }
		);

		// Invalid character range glob in --files fails validation cleanly.
		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-record',
					'--slug',
					'bad-glob',
					'--question',
					'Bad glob?',
					'--set',
					'set-9c03e1d27a55',
					'--chosen',
					'toolbar--dense',
					'--reason',
					'Reason.',
					'--files',
					'src/[z-a]/toolbar.css',
				],
				h.io
			)
		).toBe(1);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR' },
		});

		// Empty --reason passes through to decision-record rather than failing CLI option parsing.
		vi.mocked(h.bench.recordDecision).mockRejectedValueOnce(
			Object.assign(new Error('Reason required'), {
				code: 'REASON_REQUIRED',
				suggestion: 'Give the reason the choice rests on.',
			})
		);
		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-record',
					'--slug',
					'toolbar-density',
					'--question',
					'How dense?',
					'--set',
					'set-9c03e1d27a55',
					'--chosen',
					'toolbar--dense',
					'--reason',
					'',
				],
				h.io
			)
		).toBe(1);
		expect(JSON.parse(h.output.at(-1) ?? '')).toMatchObject({
			success: false,
			error: { code: 'REASON_REQUIRED' },
		});

		// Multi-supersede splits comma-separated ids into an array.
		vi.mocked(h.bench.recordDecision).mockResolvedValueOnce({
			decisions: [
				{
					decision: 'dec-aaaaaaaaaaaa',
					kind: 'choice',
					path: 'specimens/decisions/dec-aaaaaaaaaaaa.json',
					chosen: 'toolbar--dense',
					kept: ['toolbar--airy'],
					supersedes: 'dec-q7k2m4xab3na',
					evidence: { set: 'set-7e2a90c4d311', dir: 'specimens/evidence/set-7e2a90c4d311/' },
					evidenceDir: 'specimens/evidence/set-7e2a90c4d311/',
					subjects: { specimens: ['toolbar--dense'] },
				},
				{
					decision: 'dec-bbbbbbbbbbbb',
					kind: 'choice',
					path: 'specimens/decisions/dec-bbbbbbbbbbbb.json',
					chosen: 'list--empty',
					kept: ['list--empty-plain'],
					supersedes: 'dec-h3np6wz5c2rf',
					evidence: { set: 'set-7e2a90c4d311', dir: 'specimens/evidence/set-7e2a90c4d311/' },
					evidenceDir: 'specimens/evidence/set-7e2a90c4d311/',
					subjects: { specimens: ['list--empty'] },
				},
			],
		});
		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-record',
					'--supersedes',
					'dec-q7k2m4xab3na,dec-h3np6wz5c2rf',
					'--items',
					'changed:abc:def:set-4f1c0a9e2b7d..set-7e2a90c4d311',
					'--chosen',
					'accept',
					'--reason',
					'Shared token updated.',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.recordDecision).toHaveBeenLastCalledWith(
			{
				supersedes: ['dec-q7k2m4xab3na', 'dec-h3np6wz5c2rf'],
				items: ['changed:abc:def:set-4f1c0a9e2b7d..set-7e2a90c4d311'],
				chosen: 'accept',
				reason: 'Shared token updated.',
			},
			{ decidedBy: { kind: 'script' }, humanConfirmed: false, invokingActorKind: 'script' }
		);

		expect(await runCli(['--root', root, 'decision-get', 'dec-q7k2m4xab3na'], h.io)).toBe(0);
		expect(h.bench.getDecision).toHaveBeenLastCalledWith({ decision: 'dec-q7k2m4xab3na' });

		expect(await runCli(['--root', root, 'decision-list'], h.io)).toBe(0);
		expect(h.bench.listDecisions).toHaveBeenCalledTimes(1);

		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-check',
					'--files',
					'src/toolbar/toolbar.css',
					'--specimens',
					'toolbar--dense',
					'--tokens',
					'space.toolbar.gap',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.checkDecisions).toHaveBeenLastCalledWith({
			files: ['src/toolbar/toolbar.css'],
			specimens: ['toolbar--dense'],
			tokens: ['space.toolbar.gap'],
		});

		// Phase C2: design-card-list, design-release, and decision-list filter flags.
		expect(
			await runCli(
				[
					'--root',
					root,
					'design-card-list',
					'--scope',
					'release',
					'--status',
					'open',
					'--severity',
					'blocker',
					'--limit',
					'5',
					'--include-provisional',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.listDesignCards).toHaveBeenLastCalledWith({
			scope: 'release',
			status: 'open',
			severity: 'blocker',
			limit: 5,
			includeProvisional: true,
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'design-release',
					'--release',
					'1.2.0',
					'--decisions',
					'dec-q7k2m4xab3na',
					'--scope',
					'release',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.recordDesignRelease).toHaveBeenLastCalledWith(
			{
				release: '1.2.0',
				decisions: ['dec-q7k2m4xab3na'],
				scope: 'release',
			},
			{ decidedBy: { kind: 'script' }, humanConfirmed: false, invokingActorKind: 'script' }
		);

		expect(
			await runCli(
				['--root', root, 'decision-list', '--kind', 'card', '--released', '--limit', '10'],
				h.io
			)
		).toBe(0);
		expect(h.bench.listDecisions).toHaveBeenLastCalledWith({
			kind: 'card',
			released: true,
			limit: 10,
		});
	});

	it('wires specimen review with positional or --before/--after flags and optional --ids', async () => {
		const root = await directory();
		const h = harness();
		expect(await runCli(['--root', root, 'review', 'main', 'branch'], h.io)).toBe(0);
		expect(h.bench.review).toHaveBeenLastCalledWith({ before: 'main', after: 'branch' });

		expect(
			await runCli(
				[
					'--root',
					root,
					'review',
					'--before',
					'main',
					'--after',
					'branch',
					'--ids',
					'toolbar--dense,editor--shell',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.review).toHaveBeenLastCalledWith({
			before: 'main',
			after: 'branch',
			ids: ['toolbar--dense', 'editor--shell'],
		});

		expect(await runCli(['--root', root, 'review', '--before', 'main'], h.io)).toBe(1);
		expect(
			await runCli(
				['--root', root, 'review', 'main', 'branch', '--before', 'a', '--after', 'b'],
				h.io
			)
		).toBe(1);
		expect(await runCli(['--root', root, 'review', 'only-one'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'review', 'main', 'branch', '--ids', ' , '], h.io)).toBe(
			1
		);
	});

	it('wires design-states with --commands, --scenario, --consumer, --include-proposed, and pagination flags', async () => {
		const root = await directory();
		const h = harness();
		expect(
			await runCli(
				[
					'--root',
					root,
					'design-states',
					'--commands',
					'order-create,stock-list',
					'--consumer',
					'bookshop-ui',
					'--include-proposed',
					'--limit',
					'5',
					'--after',
					'order-create:error-recovery',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.designStates).toHaveBeenLastCalledWith({
			commands: ['order-create', 'stock-list'],
			consumer: 'bookshop-ui',
			includeProposed: true,
			limit: 5,
			after: 'order-create:error-recovery',
		});

		expect(
			await runCli(
				['--root', root, 'design-states', '--scenario', './scenarios/checkout.scenario.yaml'],
				h.io
			)
		).toBe(0);
		expect(h.bench.designStates).toHaveBeenLastCalledWith({
			scenario: './scenarios/checkout.scenario.yaml',
		});

		expect(
			await runCli(['--root', root, 'design-states', 'order-create', 'member-delete'], h.io)
		).toBe(0);
		expect(h.bench.designStates).toHaveBeenLastCalledWith({
			commands: ['order-create', 'member-delete'],
		});

		expect(await runCli(['--root', root, 'design-states', '--limit', '0'], h.io)).toBe(1);
	});

	it('wires panel-walk with modality, target, app-date, max-actions, baseline-walk, and requested-tools flags', async () => {
		const root = await directory();
		const h = harness();
		expect(
			await runCli(
				[
					'--root',
					root,
					'panel-walk',
					'--job',
					'checkout-out-of-stock',
					'--persona',
					'p-sr',
					'--modality',
					'screen-reader',
					'--target',
					'http://127.0.0.1:4180/?screen=checkout',
					'--app-date',
					'2030-05-12',
					'--max-actions',
					'40',
					'--baseline-walk',
					'walk-000000000001',
					'--requested-tools',
					'sr_read,press',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.panelWalk).toHaveBeenLastCalledWith({
			job: 'checkout-out-of-stock',
			persona: 'p-sr',
			modality: 'screen-reader',
			target: 'http://127.0.0.1:4180/?screen=checkout',
			appDate: '2030-05-12',
			maxActions: 40,
			baselineWalk: 'walk-000000000001',
			requestedTools: ['sr_read', 'press'],
		});

		expect(
			await runCli(
				[
					'--root',
					root,
					'panel-walk',
					'--job',
					'j',
					'--persona',
					'p',
					'--modality',
					'pointer',
					'--target',
					'http://127.0.0.1:4180',
					'--max-actions',
					'0',
				],
				h.io
			)
		).toBe(1);
	});

	it('enforces interactive person confirmation on CLI card decision-record and design-release against the real authorization path', async () => {
		const root = await directory();
		await writeFile(join(root, 'sample.ts'), 'export const Sample = {};\n');
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{ id: 'sample', title: 'Test/Sample', module: './sample.ts', exportName: 'Sample' },
				],
			})
		);
		const { writeCardRecord, getDecision, readReleaseManifest } = await import(
			'@lushly-dev/specimen'
		);
		await writeCardRecord(root, {
			card: 'card-c11000000001',
			scope: 'release',
			what: 'Confirm CLI person channel',
			owner: 'product',
			touches: ['src/app.ts'],
			severity: 'major',
			visual: { kind: 'diff', summary: 'Updated copy.' },
			why: {
				findings: [{ summary: 'Verified copy.', evidence: 'observed' }],
				reviewerCount: 3,
				split: '3-0',
				trigger: 'split-3-to-2',
			},
			effect: {
				gatesBefore: { passed: 1, failed: 0 },
				gatesAfter: { passed: 1, failed: 0 },
				regression: false,
			},
			risk: { affects: ['src/app.ts'], undoable: true },
			status: 'open',
		});

		// Non-interactive CLI (declined / no TTY) refuses card approval with PERSON_REQUIRED.
		let out = '';
		const refusedCode = await runCli(
			[
				'--root',
				root,
				'decision-record',
				'--card',
				'card-c11000000001',
				'--chosen',
				'approve',
				'--reason',
				'Automated script attempt.',
			],
			{
				stdout: (text) => {
					out += text;
				},
				stderr: () => {},
				confirmPrompt: async () => false,
			}
		);
		expect(refusedCode).toBe(1);
		expect(JSON.parse(out)).toMatchObject({
			success: false,
			error: { code: 'PERSON_REQUIRED' },
		});

		// Malformed --meant-to-fix produces a clear flag-specific error.
		let badJsonOut = '';
		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-record',
					'--card',
					'card-c11000000001',
					'--chosen',
					'approve',
					'--reason',
					'Bad json.',
					'--meant-to-fix',
					'{not-json',
				],
				{
					stdout: (text) => {
						badJsonOut += text;
					},
					stderr: () => {},
				}
			)
		).toBe(1);
		expect(JSON.parse(badJsonOut).error?.message).toContain('--meant-to-fix');

		// Interactive confirmation records channel: 'cli' and person id.
		let okOut = '';
		const okCode = await runCli(
			[
				'--root',
				root,
				'decision-record',
				'--card',
				'card-c11000000001',
				'--chosen',
				'approve',
				'--reason',
				'Approved interactively via CLI.',
			],
			{
				stdout: (text) => {
					okOut += text;
				},
				stderr: () => {},
				confirmPrompt: async () => ({ confirmed: true, confirmedBy: 'cli-person' }),
			}
		);
		expect(okCode).toBe(0);
		const decisionId = (JSON.parse(okOut) as { data: { decision: string } }).data.decision;
		const fetched = await getDecision(root, { decision: decisionId });
		expect(fetched.decidedBy).toEqual({ kind: 'person', id: 'cli-person', channel: 'cli' });

		// Non-interactive design-release fails with PERSON_REQUIRED; interactive succeeds with channel: 'cli'.
		let relRefused = '';
		expect(
			await runCli(
				['--root', root, 'design-release', '--release', '1.0.0', '--decisions', decisionId],
				{
					stdout: (text) => {
						relRefused += text;
					},
					stderr: () => {},
					confirmPrompt: async () => false,
				}
			)
		).toBe(1);
		expect(JSON.parse(relRefused)).toMatchObject({
			success: false,
			error: { code: 'PERSON_REQUIRED' },
		});

		let relOk = '';
		expect(
			await runCli(
				['--root', root, 'design-release', '--release', '1.0.0', '--decisions', decisionId],
				{
					stdout: (text) => {
						relOk += text;
					},
					stderr: () => {},
					confirmPrompt: async () => ({ confirmed: true, confirmedBy: 'cli-person' }),
				}
			)
		).toBe(0);
		expect(JSON.parse(relOk)).toMatchObject({ success: true, data: { release: '1.0.0' } });
		const manifest = await readReleaseManifest(root, '1.0.0');
		expect(manifest?.releasedBy).toEqual({ kind: 'person', id: 'cli-person', channel: 'cli' });
	});

	it('dispatches pattern-fork, pattern-compare, and pattern-merge CLI actions', async () => {
		const h = harness();
		expect(
			await runCli(
				[
					'pattern-fork',
					'--source',
					'afd-defaults/error-recovery',
					'--target',
					'error-recovery',
					'--bind',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.patternFork).toHaveBeenCalledWith({
			source: 'afd-defaults/error-recovery',
			target: 'error-recovery',
			bind: true,
		});

		expect(
			await runCli(
				[
					'pattern-compare',
					'--pattern',
					'error-recovery',
					'--upstream-version',
					'1.1.0',
					'--all-statements',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.patternCompare).toHaveBeenCalledWith({
			pattern: 'error-recovery',
			upstreamVersion: '1.1.0',
			onlyChanged: false,
		});

		expect(
			await runCli(
				[
					'pattern-merge',
					'--pattern',
					'error-recovery',
					'--accept',
					'error-recovery.keep.next',
					'--decline',
					'error-recovery.keep.focus',
					'--waivers',
					JSON.stringify([{ id: 'error-recovery.keep.focus', reason: 'Kiosk touch display' }]),
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.patternMerge).toHaveBeenCalledWith({
			pattern: 'error-recovery',
			accept: ['error-recovery.keep.next'],
			decline: ['error-recovery.keep.focus'],
			waivers: [{ id: 'error-recovery.keep.focus', reason: 'Kiosk touch display' }],
		});
	});
});

const cliSampleNote = {
	id: 'note-9v4b7n2k5m1c',
	text: 'Export should offer CSV and PDF',
	subject: {
		specimen: 'example-toolbar',
		context: { theme: 'dark', viewport: '1280x800' },
		accessible: { role: 'button', name: 'Export' },
		identity: {
			strongest: 'role-name' as const,
			roleName: { role: 'button', name: 'Export' },
			componentPosition: { tag: 'example-button', index: 2 },
			ref: 'root/example-toolbar:1/shadow/example-button:2',
		},
	},
	pin: { x: 0.4, y: 0.6 },
	state: 'open' as const,
	orphaned: false,
	assignee: 'agent',
	history: [],
};
