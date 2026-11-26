import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	checkDecisions,
	createSpecimenBench,
	diffCaptures,
	diffObservations,
	getDecision,
	listDecisions,
	listDesignCards,
	recordDecision,
	recordDesignRelease,
	runCaptureSet,
	runCompare,
	runReview,
	writeCardRecord,
} from '@lushly-dev/specimen';
import type { Observation, SpecimenEntry } from '@lushly-dev/specimen/types';
import { describe, expect, it, vi } from 'vitest';
import {
	createSpecimenCommands,
	createSpecimenDirectRegistry,
	executeSpecimenCommand,
	executeSpecimenDiff,
	markSpecimenChangeAuthor,
	markSpecimenRelayConfirmed,
	observationSchema,
	SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY,
	SPECIMEN_RELAY_CONTEXT_KEY,
	type SpecimenCommandBench,
} from './commands.js';

function observation(): Observation {
	const channel = { status: 'complete' as const, scope: 'declared targets', reasons: [] };
	return {
		manifest: {
			captureVersion: '0.10',
			normalizationVersion: '0.2',
			specimenId: 'button',
			capturedUtc: '2026-11-01T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '1.0.0', plugins: [] },
			driver: { name: 'host', emulates: [] },
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
				baseline: {
					clock: 'real',
					random: { source: 'seeded', seed: 1 },
					storage: 'empty',
				},
			},
			source: { revision: null, digest: 'source', dirty: null },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '1', platform: 'linux-x64', build: null },
			context: {
				viewport: { width: 800, height: 600 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
				pixelRatio: 1,
				observed: {
					width: 800,
					height: 600,
					media: false,
					colorScheme: 'light',
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: { fonts: [], remote: [] },
			},
		},
		channels: {
			dom: { raw: '<button>Save</button>', normalized: '<button>Save</button>' },
			a11y: { snapshot: '- button "Save"', axe: 'not-run' },
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
			dom: channel,
			a11y: channel,
			layout: channel,
			styles: channel,
			tokens: { ...channel, status: 'unsupported' },
			events: { ...channel, status: 'unsupported' },
			visual: { ...channel, status: 'not-requested' },
		},
	};
}
function bench(): SpecimenCommandBench {
	return {
		list: vi.fn(() => [
			{ id: 'button', title: 'Button', module: './button.ts', exportName: 'Primary' },
			{
				id: 'sign-in',
				title: 'Auth/Sign in',
				module: './sign-in.ts',
				exportName: 'Page',
				themes: {
					supported: ['light' as const],
					basis: 'declared' as const,
					reason: 'matches the marketing site',
				},
			},
		]),
		validate: vi.fn((target) => ({
			valid: target?.id !== 'broken',
			scope: 'static' as const,
			checked: 1,
			issues:
				target?.id === 'broken'
					? [
							{
								severity: 'error' as const,
								code: 'UNSUPPORTED_ANNOTATION',
								message: 'broken: the meta sets `loaders`',
								suggestion: 'Move the behavior into the render.',
								id: 'broken',
								field: 'meta.loaders',
							},
						]
					: [],
		})),
		render: vi.fn(async () => observation()),
		captureSet: vi.fn(async (request) => ({
			set: 'set-4f1c0a9e2b7d',
			label: request?.label ?? null,
			revision: 'a1b2c3d',
			dirty: false,
			counts: {
				captured: 2,
				unavailable: 0,
				axe: { passed: 2, failed: 0, incomplete: 0 },
			},
			unavailable: [],
			skipped: { jobs: 0, gates: 0 },
		})),
		compare: vi.fn(async (request) => ({
			set: 'set-1a2b3c4d5e6f',
			context: {
				viewport: { width: 1280, height: 800 },
				theme: 'light' as const,
				locale: 'en-US',
				reducedMotion: 'no-preference' as const,
				motion: 'natural' as const,
			},
			checkpoint: request.checkpoint ?? 'mount',
			captures: request.ids.map((id: string) => ({
				id,
				status: 'captured' as const,
				axe: 'passed' as const,
				violations: [],
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
		diff: vi.fn(async (request) => {
			if ('manifest' in request.left && 'manifest' in request.right) {
				return diffObservations(request.left, request.right, {
					allowContextDifferences: request.allowContextDifferences,
					requireVisual: request.requireVisual,
				});
			}
			throw new Error('Set diff not configured on mock bench');
		}),
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
		matrix: vi.fn(async (request) => ({
			id: request.id,
			checkpoint: 'after-run',
			axes: Object.keys(request.axes),
			cells: [],
			counts: { total: 0, captured: 0, unavailable: 0, changed: 0, unchanged: 0, insufficient: 0 },
			elapsedMs: 1,
		})),
		a11y: vi.fn(async () => ({
			reports: [
				{
					id: 'button',
					checkpoint: 'mount',
					status: 'failed' as const,
					policy: 'error' as const,
					violations: [
						{
							id: 'image-alt',
							impact: 'critical',
							help: 'Images must have alternative text',
							targets: ['img'],
							details: ['Fix any of the following'],
						},
					],
					incomplete: 0,
					incompleteChecks: [],
					exceptions: [],
					failures: [],
				},
			],
			counts: { total: 1, passed: 0, warning: 0, failed: 1, notRun: 0 },
			workers: 2,
			elapsedMs: 1,
		})),
		themes: vi.fn(async () => ({
			themes: ['light' as const, 'dark' as const],
			checkpoint: 'mount',
			threshold: 0.02,
			valid: false,
			reports: [
				{
					id: 'sign-in',
					title: 'Auth/Sign in',
					status: 'undeclared' as const,
					declared: null,
					frames: [
						{ theme: 'light' as const, rendered: 'light' as const, changed: 0 },
						{ theme: 'dark' as const, rendered: 'dark' as const, changed: 0 },
					],
				},
			],
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
				status: 'passed' as const,
				play: 'ran' as const,
				failures: [],
				a11y: {
					status: 'passed' as const,
					policy: 'error' as const,
					violations: [],
					incomplete: 0,
					incompleteChecks: [],
					exceptions: [],
					engine: '4.14.0',
				},
			},
			observation: observation(),
		})),
		pack: vi.fn(async () => ({ ...packReport, written: ['rules/example.json'], removed: [] })),
		packCheck: vi.fn(async () => ({
			...packReport,
			valid: false,
			changed: ['data/example/components/example-select.json'],
			added: [],
			removed: [],
		})),
		packExport: vi.fn(async ({ directory }) => ({
			library: 'example',
			directory,
			digest: `sha256:${'0'.repeat(64)}`,
			files: ['data/example/library.json', 'rules/example.json'],
			keptPackToml: true,
		})),
		build: vi.fn(async (outDir) => ({
			directory: outDir,
			shellBytes: 1000,
			budget: 50000,
			files: ['index.html'],
		})),
		point: vi.fn(async () => ({ point: samplePoint })),
		pointMove: vi.fn(async () => ({ point: { ...samplePoint, id: 'pt-9w4m2c1x5r8k' } })),
		pointCheck: vi.fn(async () => ({ status: 'current' as const, changed: [] })),
		noteAdd: vi.fn(async () => ({ note: sampleNote })),
		noteList: vi.fn(async () => ({ notes: [sampleNote] })),
		noteCheck: vi.fn(async () => ({
			checked: 1,
			orphaned: [],
			weakened: [],
			unchecked: [],
			restored: [],
		})),
		noteMove: vi.fn(async () => ({
			note: {
				...sampleNote,
				orphaned: false,
				history: [{ change: 'moved' as const, reason: 'Archive moved into overflow menu' }],
			},
		})),
		noteResolve: vi.fn(async () => ({
			resolved: [
				{
					...sampleNote,
					state: 'resolved' as const,
					resolution: { outcome: 'fixed' as const, reason: 'Export offers CSV and PDF' },
					history: [
						{
							change: 'resolved' as const,
							outcome: 'fixed' as const,
							reason: 'Export offers CSV and PDF',
						},
					],
				},
			],
			skipped: [],
		})),
		noteReopen: vi.fn(async () => ({
			note: {
				...sampleNote,
				state: 'open' as const,
				history: [
					{
						change: 'resolved' as const,
						outcome: 'fixed' as const,
						reason: 'Export offers CSV and PDF',
					},
					{ change: 'reopened' as const, reason: 'PDF fails for long reports' },
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
					captures: [{ after: 'The note opens beside itself', name: 'two-editors' }],
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
					description: 'A note is created',
					command: 'document-create',
					status: 'passed' as const,
				},
				{
					step: 2,
					description: 'The note opens beside itself',
					command: 'editor-open-beside',
					status: 'passed' as const,
					capture: { key: `${request.id}/2`, name: 'two-editors', status: 'captured' as const },
				},
			],
			captures: [
				{
					key: `${request.id}/2`,
					name: 'two-editors',
					step: 2,
					status: 'captured' as const,
					screenshot: `.specimen/sets/set-4f1c0a9e2b7d/screenshots/${request.id}__2.png`,
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
		listDecisions: vi.fn(async () => ({ decisions: [], undecided: [] })),
		checkDecisions: vi.fn(async () => ({ decisions: [] })),
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
			walk: 'walk-aaaaaaaaaaaa',
			job: 'checkout-out-of-stock',
			persona: 'p-sr',
			modality: 'screen-reader' as const,
			ending: 'done' as const,
			actions: 2,
			path: { done: true, failed: 0, repeats: 0, outside: 0, deviations: 0 },
			findings: [],
			unmeasured: [
				{ area: 'forced-colors', reason: 'not tested', addToMeasure: 'specimen-themes' },
			],
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
		designObserve: vi.fn(async (request) => ({
			decision: request.decision,
			releasedAt: '2030-05-12T00:00:00.000Z',
			meantToFix: { job: 'checkout-out-of-stock', target: 'checkout.substitutes' },
			status: 'improved' as const,
			metrics: {
				runs: 2,
				completionRate: 1,
				unexpectedFailures: 0,
				repeats: 0,
				outsideSteps: 0,
				...(request.beforeJournal
					? {
							before: {
								runs: 2,
								completionRate: 0.5,
								unexpectedFailures: 1,
								repeats: 1,
								outsideSteps: 1,
							},
						}
					: {}),
			},
			note: 'Movement after release is observation, not proof of causation.',
			unmeasured: [
				{
					area: 'perception-only-trouble',
					reason: 'Command journals cannot observe visual friction.',
					addToMeasure: 'Run panel-walk or panel-review.',
				},
			],
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
		panelReview: vi.fn(async (request) =>
			request.action === 'withdraw'
				? {
						run: request.run,
						withdrawn: true as const,
						withdrawnCards: [],
						withdrawnProvisional: 1,
						preservedDecidedCards: [],
						reason: request.reason,
					}
				: {
						run: 'run-a1b2c3d4e5f6',
						round: 1,
						panelSize: request.panelSize ?? 5,
						walks: ['walk-a1b2c3d4e5f6'],
						overlap: { families: ['anthropic', 'openai'], sharedFindings: 1, uniqueFindings: 0 },
						provisional: [
							{
								item: 'item-1',
								summary: 'Agreed clean.',
								decidedBy: { kind: 'panel' as const, reviewers: ['rev-1'], split: '5-0' },
								provisional: true as const,
							},
						],
						escalated: [],
						stoppedBy: 'converged' as const,
						nextSteps: ['Inspect design-card-list.'],
						unmeasured: [],
					}
		),
		panelCalibrate: vi.fn(async (request) =>
			request.action === 'sample'
				? {
						sample: 'cal-a1b2c3d4e5f6',
						items: [
							{
								item: 'item-1',
								summary: 'Agreed clean.',
								evidence: { walk: 'walk-a1b2c3d4e5f6' },
							},
						],
						unmeasured: [],
					}
				: {
						sample: request.sample,
						items: [
							{
								item: 'item-1',
								summary: 'Agreed clean.',
								evidence: { walk: 'walk-a1b2c3d4e5f6' },
								panelVerdict: 'accept' as const,
							},
						],
						recorded: request.judgements.length,
						disagreed: 0,
						disagreementRate: 0,
						reopenedCards: [],
						unmeasured: [],
					}
		),
		review: vi.fn(async () => ({
			before: { set: 'set-4f1c0a9e2b7d', revision: 'a1b2c3d', dirty: false },
			after: { set: 'set-7e2a90c4d311', revision: 'e4f5a6b', dirty: false },
			open: [],
			blocking: [],
			settled: { unchanged: 0, kept: 0, answered: 0 },
			page: 'review.html?before=set-4f1c0a9e2b7d&after=set-7e2a90c4d311',
		})),
	};
}

const samplePoint = {
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
	component: { tag: 'example-button', module: 'src/example-button.ts' },
	source: {
		specimen: { module: 'src/toolbar/toolbar.specimens.ts', exportName: 'Toolbar' },
		component: { module: 'src/example-button.ts' },
		digests: { 'src/example-button.ts': '4c1e9a071234abcd' },
	},
	ancestors: [{ tag: 'example-toolbar', role: 'toolbar' }],
	neighbourhood: {
		pageData: true as const,
		parent: { tag: 'example-toolbar', role: 'toolbar' },
		siblings: [{ tag: 'example-button', role: 'button', name: 'Export' }],
		children: [{ tag: 'button', role: 'button', name: 'Share' }],
		omitted: { siblings: 0, children: 0 },
	},
	pin: { x: 0.5, y: 0.5 },
	check: {
		command: 'specimen-point-check' as const,
		when: 'before editing source for this point' as const,
	},
};

const sampleNote = {
	id: 'note-9v4b7n2k5m1c',
	text: 'Export should offer CSV and PDF, not only CSV',
	subject: {
		specimen: 'example-toolbar',
		context: { theme: 'dark', viewport: '1280x800' },
		accessible: {
			role: 'button',
			name: 'Export',
			from: 'root/example-toolbar:1/shadow/example-button:2/shadow/button:1',
		},
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

const packReport = {
	library: 'example',
	directory: '/pack',
	problems: [],
	components: [{ tag: 'example-select', gaps: [] }],
	omitted: [],
	guides: { verified: 2, authored: 7, invalidClaims: [], claimed: 2 },
	examples: { kept: 3, leftOut: [] },
	selection: { component: null, complete: true, reason: 'Every case ran.' },
	cases: { total: 9, passed: 9, failed: [], retried: [], unstable: [], skipped: 0 },
	elapsedMs: 10,
};

describe('specimen commands', () => {
	it('exposes schema-backed CLI/MCP commands and returns the registered metadata', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		expect(commands.map((command) => command.name)).toEqual([
			'specimen-list',
			'specimen-render',
			'specimen-capture',
			'specimen-compare',
			'specimen-diff',
			'specimen-review',
			'specimen-build',
			'specimen-validate',
			'specimen-run',
			'specimen-a11y',
			'specimen-profile',
			'specimen-baseline',
			'specimen-contract',
			'specimen-suggest',
			'specimen-coverage',
			'specimen-matrix',
			'specimen-inspect',
			'specimen-migrate',
			'specimen-pack',
			'specimen-pack-check',
			'specimen-pack-export',
			'specimen-themes',
			'specimen-point',
			'specimen-point-move',
			'specimen-point-check',
			'specimen-note-add',
			'specimen-note-list',
			'specimen-note-check',
			'specimen-note-move',
			'specimen-note-resolve',
			'specimen-note-reopen',
			'specimen-job-create',
			'specimen-job-run',
			'decision-record',
			'decision-get',
			'decision-list',
			'decision-check',
			'design-states',
			'panel-walk',
			'design-card-list',
			'design-release',
			'design-observe',
			'specimen-pattern-fork',
			'specimen-pattern-compare',
			'specimen-pattern-merge',
			'panel-review',
			'panel-calibrate',
		]);
		for (const command of commands) {
			expect(command.expose).toEqual({ mcp: true, cli: true });
			expect(command.outputSchema).toBeDefined();
		}
		const result = await executeSpecimenCommand(instance, 'specimen-list', {});
		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			specimens: instance.list().map((entry) => ({
				...entry,
				kind: entry.job ? 'job' : 'component',
			})),
		});

		// specimen-list accepts job entries and filters cleanly by kind ('job' | 'component').
		const jobBench = bench();
		jobBench.list = vi.fn(() => [
			{ id: 'primary', title: 'Primary', module: './primary.ts', exportName: 'Primary' },
			{
				id: 'example-keep-a-draft',
				title: 'Example/Notes/Keep a draft',
				module: './app.specimens.ts',
				exportName: 'NotesApp',
				job: {
					scenario: '../scenarios/keep-a-draft.scenario.yaml',
					target: 'app',
					pin: { clock: '2026-03-02T09:00:00Z' },
					captures: [
						{ after: 'The note opens beside itself', name: 'two-editors' },
						{
							after: 'Another writer saves the note',
							name: 'conflict-notice',
							before: [{ action: { fill: 'second-editor', value: ' draft' } }],
						},
					],
				},
			},
		]);
		const allListed = await executeSpecimenCommand(jobBench, 'specimen-list', {});
		expect(allListed.success).toBe(true);
		expect(
			(allListed.data as { specimens: { id: string; kind: string }[] }).specimens
		).toMatchObject([
			{ id: 'primary', kind: 'component' },
			{ id: 'example-keep-a-draft', kind: 'job' },
		]);
		const jobsOnly = await executeSpecimenCommand(jobBench, 'specimen-list', { kind: 'job' });
		expect(jobsOnly.success).toBe(true);
		expect((jobsOnly.data as { specimens: { id: string }[] }).specimens.map((s) => s.id)).toEqual([
			'example-keep-a-draft',
		]);
		const componentsOnly = await executeSpecimenCommand(jobBench, 'specimen-list', {
			kind: 'component',
		});
		expect(componentsOnly.success).toBe(true);
		expect(
			(componentsOnly.data as { specimens: { id: string }[] }).specimens.map((s) => s.id)
		).toEqual(['primary']);
	});
	it('validates stories through the bench and returns its report, issues included', async () => {
		const instance = bench();
		const broken = await executeSpecimenCommand(instance, 'specimen-validate', { id: 'broken' });
		expect(broken.success).toBe(true);
		expect(broken.data).toMatchObject({
			valid: false,
			issues: [{ code: 'UNSUPPORTED_ANNOTATION' }],
		});
		expect(instance.validate).toHaveBeenCalledWith({ id: 'broken' });
		const all = await executeSpecimenCommand(instance, 'specimen-validate', {});
		expect(all.data).toEqual({ valid: true, scope: 'static', checked: 1, issues: [] });
		const invalid = await executeSpecimenCommand(instance, 'specimen-validate', { name: 'x' });
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('runs Job 5 (05-refuse-an-unportable-gate) end-to-end against a real bench and specimen-validate command', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-job5-'));
		try {
			await writeFile(join(root, 'example.specimen.js'), 'export default {};\n');
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify({
					specimens: [
						{
							id: 'example-select',
							title: 'Example select',
							module: './example.specimen.js',
							exportName: 'default',
						},
					],
				})
			);
			await mkdir(join(root, 'specimens/patterns/select'), { recursive: true });
			await mkdir(join(root, 'specimens/patterns/listbox'), { recursive: true });
			await writeFile(
				join(root, 'specimens/patterns/select/pattern.json'),
				JSON.stringify({
					pattern: 'select',
					scope: 'control',
					setups: {
						default: {
							text: 'Mount a labelled select.',
							targets: { trigger: { role: ['combobox', 'button'], nameStartsWith: 'Fruit' } },
						},
					},
					gates: {
						'escape-closes': {
							setup: 'default',
							scenario: [
								{ id: 'open', action: { click: 'trigger' } },
								{ id: 'close', action: { press: 'Escape' } },
							],
						},
					},
				})
			);
			await writeFile(
				join(root, 'specimens/patterns/listbox/pattern.json'),
				JSON.stringify({
					pattern: 'listbox',
					scope: 'control',
					setups: {
						default: {
							text: 'Mount a listbox.',
							targets: { list: { role: 'listbox', name: 'Size' } },
						},
					},
					gates: {
						'shows-choice': {
							setup: 'default',
							scenario: [
								{ id: 'pick', action: { click: { selector: 'example-option[selected]' } } },
								{
									id: 'check',
									expect: { target: 'list', state: { attribute: 'selected', equals: 'true' } },
								},
							],
						},
					},
				})
			);
			const realBench = await createSpecimenBench({ root });
			try {
				const validPattern = await executeSpecimenCommand(realBench, 'specimen-validate', {
					file: 'specimens/patterns/select/pattern.json',
				});
				expect(validPattern.success).toBe(true);
				expect(validPattern.data).toEqual({
					valid: true,
					scope: 'static',
					checked: 1,
					issues: [],
				});

				const badPattern = await executeSpecimenCommand(realBench, 'specimen-validate', {
					file: 'specimens/patterns/listbox/pattern.json',
				});
				expect(badPattern.success).toBe(true);
				expect(badPattern.data).toMatchObject({
					valid: false,
					scope: 'static',
					issues: [
						{
							severity: 'error',
							code: 'GATE_NOT_PORTABLE',
							field: 'gates.shows-choice.scenario[0]',
						},
						{
							severity: 'error',
							code: 'GATE_NOT_PORTABLE',
							field: 'gates.shows-choice.scenario[1]',
						},
					],
				});
				const issues = (badPattern.data as { issues: Array<{ suggestion: string }> }).issues;
				expect(issues).toHaveLength(2);
				expect(issues[0]?.suggestion).toContain('role');
			} finally {
				await realBench.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it('previews the codemod by default and applies it only when asked', async () => {
		const instance = bench();
		const preview = await executeSpecimenCommand(instance, 'specimen-migrate', {});
		expect(preview.data).toMatchObject({ mode: 'preview' });
		const applied = await executeSpecimenCommand(instance, 'specimen-migrate', {
			files: ['./src/a.stories.ts'],
			apply: true,
		});
		expect(applied.data).toMatchObject({ mode: 'apply' });
		expect(instance.migrate).toHaveBeenLastCalledWith({
			files: ['./src/a.stories.ts'],
			apply: true,
		});
		const invalid = await executeSpecimenCommand(instance, 'specimen-migrate', { files: [] });
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('inspects a specimen and validates the report against the inspect schema', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-inspect', { id: 'button' });
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({ id: 'button', component: 'plain-button', schema: null });
		const invalid = await executeSpecimenCommand(instance, 'specimen-inspect', {
			id: 'button',
			screenshot: 'x.png',
		});
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('runs a retained story and returns its outcome and capture', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-run', { id: 'button' });
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({ id: 'button', outcome: { status: 'passed', play: 'ran' } });
		const invalid = await executeSpecimenCommand(instance, 'specimen-run', {
			id: 'button',
			checkpoint: 'mount',
		});
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('checks accessibility, and reports a failing check as a successful command', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-a11y', {
			id: 'button',
			checkpoint: 'mount',
		});
		expect(result.success).toBe(true);
		expect(instance.a11y).toHaveBeenCalledWith({ id: 'button', checkpoint: 'mount' });
		expect(result.data).toMatchObject({
			counts: { failed: 1 },
			reports: [{ id: 'button', status: 'failed', violations: [{ id: 'image-alt' }] }],
		});
		const invalid = await executeSpecimenCommand(instance, 'specimen-a11y', { other: true });
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('reports what does not follow the theme as data a gate can read', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-themes', {
			filter: { match: 'auth' },
			themes: ['light', 'dark'],
		});
		expect(result.success).toBe(true);
		expect(instance.themes).toHaveBeenCalledWith({
			filter: { match: 'auth' },
			themes: ['light', 'dark'],
		});
		expect(result.data).toMatchObject({
			valid: false,
			counts: { undeclared: 1 },
			reports: [{ id: 'sign-in', status: 'undeclared' }],
		});
		for (const input of [{ themes: ['light'] }, { themes: ['light', 'light'] }, { threshold: 2 }])
			expect((await executeSpecimenCommand(instance, 'specimen-themes', input)).error?.code).toBe(
				'VALIDATION_ERROR'
			);
		const commands = createSpecimenCommands(instance);
		expect(commands.find((command) => command.name === 'specimen-themes')?.mutation).toBe(false);
	});
	it('exposes specimen-point, specimen-point-move, and specimen-point-check with validation and structured errors', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const byName = (name: string) => commands.find((command) => command.name === name);
		expect(byName('specimen-point')?.mutation).toBe(true);
		expect(byName('specimen-point')?.description).toContain('specimen-point-check');
		expect(byName('specimen-point-move')?.mutation).toBe(true);
		expect(byName('specimen-point-check')?.mutation).toBe(false);

		const pointed = await executeSpecimenCommand(instance, 'specimen-point', {
			pointer:
				'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1',
		});
		expect(pointed.success).toBe(true);
		expect(pointed.data).toEqual({ point: samplePoint });

		const byTarget = await executeSpecimenCommand(instance, 'specimen-point', {
			id: 'example-toolbar',
			context: { theme: 'dark', viewport: '1280x800' },
			target: { role: 'button', name: 'Share' },
		});
		expect(byTarget.success).toBe(true);

		const moved = await executeSpecimenCommand(instance, 'specimen-point-move', {
			id: 'pt-5r8k2w9m4c1x',
			to: 'next',
		});
		expect(moved.success).toBe(true);
		expect(instance.pointMove).toHaveBeenCalledWith({ id: 'pt-5r8k2w9m4c1x', to: 'next' });

		const checked = await executeSpecimenCommand(instance, 'specimen-point-check', {
			id: 'pt-5r8k2w9m4c1x',
		});
		expect(checked.success).toBe(true);
		expect(checked.data).toEqual({ status: 'current', changed: [] });

		// Input schema rejects invalid combinations
		expect((await executeSpecimenCommand(instance, 'specimen-point', {})).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect(
			(
				await executeSpecimenCommand(instance, 'specimen-point', {
					pointer: 'specimen:a#ref=root/div:1',
					id: 'a',
				})
			).error?.code
		).toBe('VALIDATION_ERROR');
		expect(
			(
				await executeSpecimenCommand(instance, 'specimen-point-move', {
					id: 'pt-5r8k2w9m4c1x',
					to: 'parent',
					index: 0,
				})
			).error?.code
		).toBe('VALIDATION_ERROR');

		// Structured Pointing errors pass through cleanly
		for (const [cmd, input, method, code, suggestion] of [
			[
				'specimen-point',
				{ pointer: 'bad' },
				'point',
				'POINTER_INVALID',
				'Copy the pointer again from the review page.',
			],
			[
				'specimen-point',
				{ id: 'nope', target: { role: 'button' } },
				'point',
				'SPECIMEN_NOT_FOUND',
				'Nearest specimen ids: example-toolbar.',
			],
			[
				'specimen-point-move',
				{ id: 'pt-5r8k2w9m4c1x', to: 'next' },
				'pointMove',
				'POINT_STALE',
				'Run specimen-point to point again.',
			],
			[
				'specimen-point-move',
				{ id: 'pt-5r8k2w9m4c1x', to: 'parent' },
				'pointMove',
				'NO_SUCH_LEVEL',
				'Available moves from this element: child.',
			],
			[
				'specimen-point-check',
				{ id: 'pt-000000000000' },
				'pointCheck',
				'POINT_NOT_FOUND',
				'Run specimen-point to create a point.',
			],
		] as const) {
			vi.mocked(instance[method]).mockRejectedValueOnce(
				Object.assign(new Error(code), { code, suggestion })
			);
			const res = await executeSpecimenCommand(instance, cmd, input);
			expect(res.success).toBe(false);
			expect(res.error?.code).toBe(code);
			expect(res.error?.suggestion).toBe(suggestion);
		}
	});
	it('builds, checks and exports a pack, the check as the one command that changes nothing', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const mutation = (name: string) => commands.find((command) => command.name === name)?.mutation;
		expect(mutation('specimen-pack')).toBe(true);
		expect(mutation('specimen-pack-check')).toBe(false);
		expect(mutation('specimen-pack-export')).toBe(true);
		const built = await executeSpecimenCommand(instance, 'specimen-pack', {
			component: 'example-option',
			allowFailed: ['broken'],
		});
		expect(built.success).toBe(true);
		expect(instance.pack).toHaveBeenCalledWith({
			component: 'example-option',
			allowFailed: ['broken'],
		});
		const checked = await executeSpecimenCommand(instance, 'specimen-pack-check', {});
		expect(checked.data).toMatchObject({
			valid: false,
			changed: ['data/example/components/example-select.json'],
		});
		const exported = await executeSpecimenCommand(instance, 'specimen-pack-export', {
			directory: 'out',
			revision: 'a'.repeat(40),
		});
		expect(exported.data).toMatchObject({ directory: 'out', keptPackToml: true });
		const invalid = await executeSpecimenCommand(instance, 'specimen-pack-export', {
			directory: 'out',
			revision: 'main',
		});
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
		vi.mocked(instance.packExport).mockRejectedValueOnce(
			new Error('The committed records are out of date.')
		);
		const refused = await executeSpecimenCommand(instance, 'specimen-pack-export', {
			directory: 'out',
		});
		expect(refused.error).toMatchObject({ code: 'SPECIMEN_PACK_EXPORT_FAILED' });
	});
	it('profiles without changing anything, and records a baseline as a mutation', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const mutation = (name: string) => commands.find((command) => command.name === name)?.mutation;
		expect(mutation('specimen-profile')).toBe(false);
		expect(mutation('specimen-baseline')).toBe(true);
		const profiled = await executeSpecimenCommand(instance, 'specimen-profile', {
			id: 'button',
			runs: 3,
		});
		expect(profiled.success).toBe(true);
		expect(instance.profile).toHaveBeenCalledWith({ id: 'button', runs: 3 });
		const recorded = await executeSpecimenCommand(instance, 'specimen-baseline', {
			id: 'button',
			notes: ['After the page cutover.'],
		});
		expect(recorded.success).toBe(true);
		expect(instance.recordBaseline).toHaveBeenCalledWith({
			id: 'button',
			notes: ['After the page cutover.'],
		});
		const invalid = await executeSpecimenCommand(instance, 'specimen-profile', { runs: 9 });
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('runs a matrix over explicit axes', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-matrix', {
			id: 'button',
			axes: { theme: ['light', 'dark'] },
		});
		expect(result.success).toBe(true);
		expect(instance.matrix).toHaveBeenCalledWith({
			id: 'button',
			axes: { theme: ['light', 'dark'] },
		});
		expect(result.data).toMatchObject({ id: 'button', axes: ['theme'] });
		const invalid = await executeSpecimenCommand(instance, 'specimen-matrix', { id: 'button' });
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
	});
	it('runs a suite without an id, and refuses an id with suite options', async () => {
		const instance = bench();
		const suite = await executeSpecimenCommand(instance, 'specimen-run', {
			filter: { tags: ['smoke'] },
			workers: 2,
			retry: true,
		});
		expect(suite.success).toBe(true);
		expect(instance.runSuite).toHaveBeenCalledWith({
			filter: { tags: ['smoke'] },
			workers: 2,
			retry: true,
		});
		expect(suite.data).toMatchObject({ outcome: 'passed', counts: { total: 0 } });
		const both = await executeSpecimenCommand(instance, 'specimen-run', {
			id: 'button',
			workers: 2,
		});
		expect(both.success).toBe(false);
		expect(both.error?.code).toBe('SPECIMEN_RUN_FAILED');
		expect(instance.run).toHaveBeenCalledTimes(0);
	});
	it('lists retained stories with their Storybook identity', async () => {
		const instance = bench();
		const story = {
			id: 'components-button--primary',
			title: 'Components/Button',
			module: './src/button.stories.ts',
			exportName: 'Primary',
			story: {
				name: 'Primary',
				tags: ['dev', 'test', 'manifest'],
				play: 'unknown' as const,
				unresolved: [{ level: 'story' as const, field: '*', reason: 'a call' }],
				annotations: { meta: ['title'], story: ['*'] },
			},
		};
		instance.list = () => [story];
		const result = await executeSpecimenCommand(instance, 'specimen-list', {});
		expect(result.data).toEqual({ specimens: [{ ...story, kind: 'component' }] });
	});
	it('validates input before a render and rejects unknown fields', async () => {
		const instance = bench();
		for (const input of [
			{ id: '' },
			{ id: 'button', context: { viewport: { width: 0, height: 10 } } },
			{ id: 'button', extra: true },
			{ id: 'button', context: { theme: 'drak' } },
			{ id: 'button', timeoutMs: 90_000 },
			{ id: 'button', context: { viewport: { width: 9000, height: 10 } } },
		]) {
			const result = await executeSpecimenCommand(instance, 'specimen-render', input);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.suggestion).toBeTruthy();
		}
		expect(instance.render).not.toHaveBeenCalled();
	});
	it('preserves the full capture contract and sends validated render options', async () => {
		const instance = bench();
		const input = {
			id: 'button',
			checkpoint: 'focused',
			context: { theme: 'dark' },
			screenshot: '/tmp/button.png',
		};
		const result = await executeSpecimenCommand(instance, 'specimen-render', input);
		expect(result.success).toBe(true);
		expect(instance.render).toHaveBeenCalledWith(input);
		expect(observationSchema.safeParse(result.data).success).toBe(true);
	});
	it('returns actionable bench failures and preserves structured failure codes', async () => {
		const instance = bench();
		instance.render = async () => {
			throw Object.assign(new Error('No such checkpoint'), { code: 'CHECKPOINT_NOT_FOUND' });
		};
		const result = await executeSpecimenCommand(instance, 'specimen-render', { id: 'button' });
		expect(result.error).toMatchObject({
			code: 'CHECKPOINT_NOT_FOUND',
			message: 'No such checkpoint',
		});
		expect(result.error?.suggestion).toContain('checkpoint');

		instance.render = async () => {
			throw Object.assign(
				new Error('Target \'print\' (role "button", name "Print") matched no elements'),
				{
					code: 'TARGET_NOT_FOUND',
					suggestion: 'Point again in the review page, or name a role and name that exist.',
					details: { count: 0, target: 'print' },
				}
			);
		};
		const notFound = await executeSpecimenCommand(instance, 'specimen-render', { id: 'button' });
		expect(notFound.success).toBe(false);
		expect(notFound.error).toMatchObject({
			code: 'TARGET_NOT_FOUND',
			message: 'Target \'print\' (role "button", name "Print") matched no elements',
			suggestion: 'Point again in the review page, or name a role and name that exist.',
			details: { count: 0, target: 'print' },
		});

		instance.render = async () => {
			throw Object.assign(
				new Error('Target \'action\' (role "button") matched 2 elements; expected 1'),
				{
					code: 'TARGET_AMBIGUOUS',
					suggestion:
						'Matched 2 elements; add a name, narrow the selector, or point in the review page.',
					details: { count: 2, target: 'action' },
				}
			);
		};
		const ambiguous = await executeSpecimenCommand(instance, 'specimen-render', { id: 'button' });
		expect(ambiguous.success).toBe(false);
		expect(ambiguous.error).toMatchObject({
			code: 'TARGET_AMBIGUOUS',
			message: 'Target \'action\' (role "button") matched 2 elements; expected 1',
			suggestion:
				'Matched 2 elements; add a name, narrow the selector, or point in the review page.',
			details: { count: 2, target: 'action' },
		});

		const circular: Record<string, unknown> = {};
		circular.self = circular;
		for (const unencodable of [{ attempts: 1n }, circular]) {
			instance.render = async () => {
				throw Object.assign(new Error('Target failure with custom details'), {
					code: 'TARGET_NOT_FOUND',
					suggestion: '   ',
					details: unencodable,
				});
			};
			const safe = await executeSpecimenCommand(instance, 'specimen-render', { id: 'button' });
			expect(safe.success).toBe(false);
			expect(() => JSON.stringify(safe)).not.toThrow();
			expect(safe.error?.code).toBe('TARGET_NOT_FOUND');
			expect(safe.error?.message).toBe('Target failure with custom details');
			expect(safe.error?.suggestion).toContain('specimen-list');
			expect(safe.error?.details).toBeUndefined();
		}

		instance.build = async () => {
			throw new Error('Budget exceeded');
		};
		expect(
			(await executeSpecimenCommand(instance, 'specimen-build', { outDir: 'output' })).error?.code
		).toBe('SPECIMEN_BUILD_FAILED');
	});
	it('does not turn malformed observation data into a successful diff', async () => {
		const instance = bench();
		for (const input of [
			{ left: {}, right: {} },
			{ left: observation(), right: { ...observation(), channels: {} } },
			{ left: observation(), right: observation(), allowContextDifferences: ['typo'] },
		]) {
			const result = await executeSpecimenCommand(instance, 'specimen-diff', input);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		}
	});
	it('compares captures and reports incompatible comparisons as failures', async () => {
		const instance = bench();
		const left = observation();
		const right = observation();
		right.channels.a11y.snapshot = '- button "Delete"';
		const result = await executeSpecimenCommand(instance, 'specimen-diff', { left, right });
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({ status: 'changed' });
		right.manifest.checkpoint.name = 'different';
		const mismatch = await executeSpecimenCommand(instance, 'specimen-diff', { left, right });
		expect(mismatch.error?.code).toBe('CAPTURES_INCOMPARABLE');
		expect(mismatch.error?.suggestion).toContain('allowContextDifferences');
	});
	it('accepts its own diff result when recorded event histories differ', async () => {
		const instance = bench();
		const withEvents = (types: string[]) => {
			const value = observation();
			value.completeness.events = { status: 'complete', scope: 'declared events', reasons: [] };
			value.channels.events.declared = [{ type: 'click' }];
			value.channels.events.history = types.map((type) => ({
				type,
				target: 'root/button:1',
				step: 'activate',
				composed: true,
				bubbles: true,
				trusted: true,
				detail: null,
			}));
			return value;
		};
		const left = withEvents(['click']);
		const right = withEvents([]);
		const expected = {
			status: 'changed',
			differences: [{ channel: 'events', left: 'click root/button:1 activate', right: '' }],
		};
		const viaCommand = await executeSpecimenCommand(instance, 'specimen-diff', { left, right });
		expect(viaCommand.success).toBe(true);
		expect(viaCommand.data).toMatchObject(expected);
		const viaHelper = await executeSpecimenDiff({ left, right });
		expect(viaHelper.success).toBe(true);
		expect(viaHelper.data).toMatchObject(expected);
	});
	it('validates build results and fails unknown commands', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-build', {
			outDir: '/tmp/site',
		});
		expect(result.data).toMatchObject({ directory: '/tmp/site', shellBytes: 1000 });
		instance.list = () => [{ id: 3 }] as unknown as ReturnType<SpecimenCommandBench['list']>;
		expect((await executeSpecimenCommand(instance, 'specimen-list', {})).error?.code).toBe(
			'SPECIMEN_OUTPUT_INVALID'
		);
		expect((await executeSpecimenCommand(instance, 'specimen-nope', {})).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});

	it('exposes specimen-capture as a mutation and runs set-backed capture and diff scenarios end to end', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-sets-'));
		try {
			const entries: SpecimenEntry[] = [
				{ id: 'toolbar--dense', title: 'Toolbar/Dense', module: './t.ts', exportName: 'Dense' },
				{
					id: 'toolbar--airy',
					title: 'Toolbar/Airy',
					module: './t.ts',
					exportName: 'Airy',
					themes: {
						supported: ['light'],
						basis: 'declared',
						reason: 'Dark styles not written yet',
					},
				},
				{
					id: 'toolbar--grouped',
					title: 'Toolbar/Grouped',
					module: './t.ts',
					exportName: 'Grouped',
				},
				{ id: 'list--empty', title: 'List/Empty', module: './l.ts', exportName: 'Empty' },
				{
					id: 'list--empty-plain',
					title: 'List/EmptyPlain',
					module: './l.ts',
					exportName: 'EmptyPlain',
				},
				{ id: 'button--primary', title: 'Button/Primary', module: './b.ts', exportName: 'Primary' },
				{ id: 'editor--shell', title: 'Editor/Shell', module: './e.ts', exportName: 'Shell' },
			];
			const instance = bench();
			instance.captureSet = (request) =>
				runCaptureSet(
					{
						root,
						entries,
						workers: 2,
						prepare: async () => {},
						sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
						render: async ({ entry, context }) => {
							const obs = observation();
							obs.manifest.specimenId = entry.id;
							obs.manifest.context.theme = context.theme;
							obs.manifest.context.viewport = context.viewport;
							obs.channels.dom.raw = `<div data-id="${entry.id}" data-theme="${context.theme}"></div>`;
							obs.channels.a11y.axe =
								entry.id === 'toolbar--grouped'
									? {
											status: 'failed',
											policy: 'error',
											violations: [
												{
													id: 'color-contrast',
													impact: 'serious',
													help: 'contrast',
													targets: ['span.group-label'],
													details: [],
												},
											],
											incomplete: 0,
											incompleteChecks: [],
											exceptions: [],
										}
									: entry.id === 'list--empty'
										? {
												status: 'passed',
												policy: 'error',
												violations: [],
												incomplete: 1,
												incompleteChecks: [
													{
														id: 'color-contrast',
														impact: 'serious',
														help: 'Text over a background image could not be measured',
														targets: ['p.empty-hint'],
														details: [],
													},
												],
												exceptions: [],
											}
										: {
												status: 'passed',
												policy: 'error',
												violations: [],
												incomplete: 0,
												incompleteChecks: [],
												exceptions: [],
											};
							return obs;
						},
					},
					request
				);
			instance.diff = (request) => diffCaptures(root, request);

			const commands = createSpecimenCommands(instance);
			const captureDef = commands.find((command) => command.name === 'specimen-capture');
			expect(captureDef?.mutation).toBe(true);
			expect(captureDef?.description).toContain('not a git ref');

			// Scenario 10 step 1: capture all 7 specimens into label main.
			const main = await executeSpecimenCommand(instance, 'specimen-capture', { label: 'main' });
			expect(main.success).toBe(true);
			expect(main.data).toMatchObject({
				set: expect.stringMatching(/^set-[0-9a-f]{12}$/),
				label: 'main',
				revision: 'a1b2c3d',
				dirty: false,
				counts: {
					captured: 7,
					unavailable: 0,
					axe: { passed: 6, failed: 1, incomplete: 1 },
				},
				unavailable: [],
				skipped: { jobs: 0, gates: 0 },
			});

			// Scenario 10 step 2: dark subset marks light-only toolbar--airy unavailable.
			const mainDark = await executeSpecimenCommand(instance, 'specimen-capture', {
				ids: ['toolbar--dense', 'toolbar--airy'],
				context: { theme: 'dark' },
				label: 'main-dark',
			});
			expect(mainDark.success).toBe(true);
			expect(mainDark.data).toMatchObject({
				set: expect.stringMatching(/^set-[0-9a-f]{12}$/),
				counts: { captured: 1, unavailable: 1 },
				unavailable: [{ id: 'toolbar--airy', reason: expect.stringContaining('light') }],
			});

			// Scenario 07 steps 1-3: capture dark, refuse theme mismatch, allow with allowContextDifferences.
			const dark = await executeSpecimenCommand(instance, 'specimen-capture', {
				ids: ['toolbar--dense'],
				context: { theme: 'dark' },
				label: 'dark',
			});
			const darkSetId = (dark.data as { set: string }).set;
			const refused = await executeSpecimenCommand(instance, 'specimen-diff', {
				left: { set: 'main', id: 'toolbar--dense' },
				right: { set: darkSetId, id: 'toolbar--dense' },
			});
			expect(refused.success).toBe(false);
			expect(refused.error).toMatchObject({
				code: 'CAPTURES_INCOMPARABLE',
				message: expect.stringContaining('context.theme'),
				suggestion: expect.stringContaining('allowContextDifferences'),
			});

			const allowed = await executeSpecimenCommand(instance, 'specimen-diff', {
				left: { set: 'main', id: 'toolbar--dense' },
				right: { set: darkSetId, id: 'toolbar--dense' },
				allowContextDifferences: ['theme'],
			});
			expect(allowed.success).toBe(true);
			expect(allowed.data).toMatchObject({ status: 'changed' });

			// Helper without bench resolves sets under options.root and reports CAPTURE_SET_NOT_FOUND.
			const viaHelper = await executeSpecimenDiff(
				{
					left: { set: 'main', id: 'toolbar--dense' },
					right: { set: 'dark', id: 'toolbar--dense' },
					allowContextDifferences: ['theme'],
				},
				{ root }
			);
			expect(viaHelper.success).toBe(true);
			const missing = await executeSpecimenDiff(
				{
					left: { set: 'missing', id: 'toolbar--dense' },
					right: { set: 'main', id: 'toolbar--dense' },
				},
				{ root }
			);
			expect(missing.error).toMatchObject({
				code: 'CAPTURE_SET_NOT_FOUND',
				suggestion: expect.stringContaining('specimen-capture'),
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes specimen-compare as a mutation and satisfies Scenarios 01 and 07 step 5 without returning observations', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-compare-'));
		try {
			const entries: SpecimenEntry[] = [
				{ id: 'toolbar--dense', title: 'Toolbar/Dense', module: './t.ts', exportName: 'Dense' },
				{
					id: 'toolbar--airy',
					title: 'Toolbar/Airy',
					module: './t.ts',
					exportName: 'Airy',
					themes: {
						supported: ['light'],
						basis: 'declared',
						reason: 'Dark styles not written yet',
					},
				},
				{
					id: 'toolbar--grouped',
					title: 'Toolbar/Grouped',
					module: './t.ts',
					exportName: 'Grouped',
				},
			];
			const instance = bench();
			instance.compare = (request) =>
				runCompare(
					{
						root,
						entries,
						workers: 2,
						prepare: async () => {},
						sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
						render: async ({ entry, context, screenshot }) => {
							await writeFile(screenshot, 'png-bytes');
							const obs = observation();
							obs.manifest.specimenId = entry.id;
							obs.manifest.context.theme = context.theme;
							obs.manifest.context.viewport = context.viewport;
							obs.channels.visual.path = screenshot;
							obs.channels.dom.raw = `<div role="toolbar" data-variant="${entry.id}"></div>`;
							obs.channels.elements = [
								{
									ref: 'root/div:1',
									tag: 'div',
									attributes: { role: 'toolbar' },
									box: {
										x: 0,
										y: 0,
										width: 320,
										height: entry.id === 'toolbar--airy' ? 52 : 36,
									},
									scroll: { width: 320, height: 36, clientWidth: 320, clientHeight: 36 },
									styles: { padding: entry.id === 'toolbar--airy' ? '12px' : '4px' },
									state: { focused: false, value: '' },
								},
							];
							obs.channels.a11y.axe =
								entry.id === 'toolbar--grouped'
									? {
											status: 'failed',
											policy: 'error',
											violations: [
												{
													id: 'color-contrast',
													impact: 'serious',
													help: 'contrast',
													targets: ['span.group-label'],
													details: [],
												},
											],
											incomplete: 0,
											incompleteChecks: [],
											exceptions: [],
										}
									: {
											status: 'passed',
											policy: 'error',
											violations: [],
											incomplete: 0,
											incompleteChecks: [],
											exceptions: [],
										};
							return obs;
						},
					},
					request
				);

			const commands = createSpecimenCommands(instance);
			const compareDef = commands.find((command) => command.name === 'specimen-compare');
			expect(compareDef?.mutation).toBe(true);

			// Input schema validation: rejects fewer than 2 or duplicate ids.
			expect(
				(await executeSpecimenCommand(instance, 'specimen-compare', { ids: ['toolbar--dense'] }))
					.error?.code
			).toBe('VALIDATION_ERROR');
			expect(
				(
					await executeSpecimenCommand(instance, 'specimen-compare', {
						ids: ['toolbar--dense', 'toolbar--dense'],
					})
				).error?.code
			).toBe('VALIDATION_ERROR');

			// Scenario 01 step 1: misspelled variant refused before capturing.
			const typo = await executeSpecimenCommand(instance, 'specimen-compare', {
				ids: ['toolbar--dense', 'toolbar--dence'],
			});
			expect(typo.success).toBe(false);
			expect(typo.error).toMatchObject({
				code: 'SPECIMEN_NOT_FOUND',
				message: expect.stringContaining('toolbar--dence'),
				suggestion: expect.stringContaining('toolbar--dense'),
			});

			// Scenario 01 step 2: 3 variants captured with axe and diffed against toolbar--dense.
			const compared = await executeSpecimenCommand(instance, 'specimen-compare', {
				ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
				context: { theme: 'light', viewport: { width: 1280, height: 800 } },
			});
			expect(compared.success).toBe(true);
			expect(compared.data).toMatchObject({
				set: expect.stringMatching(/^set-[0-9a-f]{12}$/),
				context: { theme: 'light' },
				checkpoint: 'mount',
				captures: [
					{ id: 'toolbar--dense', status: 'captured', axe: 'passed', violations: [] },
					{ id: 'toolbar--airy', status: 'captured', axe: 'passed', violations: [] },
					{
						id: 'toolbar--grouped',
						status: 'captured',
						axe: 'failed',
						violations: ['color-contrast'],
					},
				],
				differences: [
					{
						id: 'toolbar--airy',
						against: 'toolbar--dense',
						status: 'changed',
						channels: expect.arrayContaining(['layout']),
					},
					{
						id: 'toolbar--grouped',
						against: 'toolbar--dense',
						status: 'changed',
					},
				],
				page: expect.stringContaining('compare.html?set=set-'),
			});
			expect(JSON.stringify(compared)).not.toContain('"manifest"');

			// Scenario 07 step 5: theme-excluded variant refused with VARIANT_UNAVAILABLE.
			const unavailable = await executeSpecimenCommand(instance, 'specimen-compare', {
				ids: ['toolbar--dense', 'toolbar--airy'],
				context: { theme: 'dark' },
			});
			expect(unavailable.success).toBe(false);
			expect(unavailable.error).toMatchObject({
				code: 'VARIANT_UNAVAILABLE',
				message: expect.stringContaining('toolbar--airy'),
				suggestion: expect.stringContaining('light'),
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes specimen-job-create and specimen-job-run with mutation metadata, references-only output, and all 8 job error codes', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const byName = (name: string) => commands.find((command) => command.name === name);
		expect(byName('specimen-job-create')?.mutation).toBe(true);
		expect(byName('specimen-job-run')?.mutation).toBe(true);

		const created = await executeSpecimenCommand(instance, 'specimen-job-create', {
			id: 'example-keep-a-draft',
			scenario: './scenarios/keep-a-draft.scenario.yaml',
			module: './app.specimens.ts',
			exportName: 'NotesApp',
			target: 'app',
			captures: [3, { step: 4, name: 'conflict-notice' }],
		});
		expect(created.success).toBe(true);
		expect(created.data).toMatchObject({
			written: 'specimen.config.json',
			entry: { id: 'example-keep-a-draft', kind: 'job' },
		});

		const ran = await executeSpecimenCommand(instance, 'specimen-job-run', {
			id: 'example-keep-a-draft',
			label: 'main',
		});
		expect(ran.success).toBe(true);
		expect(ran.data).toMatchObject({
			set: 'set-4f1c0a9e2b7d',
			status: 'passed',
			captures: [{ key: 'example-keep-a-draft/2', status: 'captured' }],
		});
		// References only: never raw observations in specimen-job-run output.
		expect(JSON.stringify(ran)).not.toContain('"channels"');
		expect(JSON.stringify(ran)).not.toContain('"normalized"');

		// Public specimen-job-run schema refuses internal inline `scenario` overrides.
		const inlineScenario = await executeSpecimenCommand(instance, 'specimen-job-run', {
			id: 'example-keep-a-draft',
			scenario: { job: 'spoofed', steps: [{ step: 1, command: 'noop' }] },
		});
		expect(inlineScenario.success).toBe(false);
		expect(inlineScenario.error?.code).toBe('VALIDATION_ERROR');

		// All 8 job error codes pass through with actionable suggestions.
		const errorCases: Array<{
			cmd: string;
			input: Record<string, unknown>;
			method: 'createJob' | 'runJob' | 'render';
			code: string;
			suggestion: string;
			expectedSuggestionContains: string;
		}> = [
			{
				cmd: 'specimen-job-run',
				input: { id: 'button' },
				method: 'runJob',
				code: 'NOT_A_JOB',
				suggestion: 'Use specimen-list with kind: job.',
				expectedSuggestionContains: 'specimen-list',
			},
			{
				cmd: 'specimen-render',
				input: { id: 'example-keep-a-draft' },
				method: 'render',
				code: 'JOB_NEEDS_RUN',
				suggestion: 'Run specimen-job-run first, then pass set to specimen-render.',
				expectedSuggestionContains: 'specimen-job-run',
			},
			{
				cmd: 'specimen-job-run',
				input: { id: 'example-keep-a-draft' },
				method: 'runJob',
				code: 'CAPTURE_STEP_UNKNOWN',
				suggestion: 'Run specimen-validate to inspect scenario step descriptions.',
				expectedSuggestionContains: 'specimen-validate',
			},
			{
				cmd: 'specimen-job-run',
				input: { id: 'example-keep-a-draft' },
				method: 'runJob',
				code: 'CAPTURE_STEP_AMBIGUOUS',
				suggestion: 'Make step descriptions unique in the scenario.',
				expectedSuggestionContains: 'unique',
			},
			{
				cmd: 'specimen-job-create',
				input: {
					id: 'example-no-desc',
					scenario: './s.yaml',
					module: './app.ts',
					exportName: 'App',
					target: 'app',
					captures: [1],
				},
				method: 'createJob',
				code: 'STEP_HAS_NO_DESCRIPTION',
				suggestion: 'Add a description to step 1 in the scenario.',
				expectedSuggestionContains: 'description',
			},
			{
				cmd: 'specimen-job-run',
				input: { id: 'example-keep-a-draft' },
				method: 'runJob',
				code: 'JOB_SCENARIO_INVALID',
				suggestion: 'Fix the scenario YAML syntax and schema.',
				expectedSuggestionContains: 'scenario',
			},
			{
				cmd: 'specimen-job-run',
				input: { id: 'example-keep-a-draft' },
				method: 'runJob',
				code: 'RUNNER_MISSING',
				suggestion: 'Add the runner plugin to specimen.config.json plugins.',
				expectedSuggestionContains: 'plugins',
			},
			{
				cmd: 'specimen-job-run',
				input: { id: 'example-keep-a-draft' },
				method: 'runJob',
				code: 'BROWSER_UNAVAILABLE',
				suggestion: 'Install Chromium.',
				expectedSuggestionContains: 'afd scenario run',
			},
		];

		for (const item of errorCases) {
			const error = Object.assign(new Error(`Simulated ${item.code}`), {
				code: item.code,
				suggestion: item.suggestion,
			});
			vi.mocked(instance[item.method]).mockRejectedValueOnce(error);
			const res = await executeSpecimenCommand(instance, item.cmd, item.input);
			expect(res.success, item.code).toBe(false);
			expect(res.error?.code, item.code).toBe(item.code);
			expect(res.error?.suggestion, item.code).toContain(item.expectedSuggestionContains);
		}
	});

	it('exposes jobs@1 obligations and captures on specimen-coverage, validates coupling, and passes CAPTURE_SET_NOT_FOUND', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const covCmd = commands.find((command) => command.name === 'specimen-coverage');
		expect(covCmd?.mutation).toBe(false);
		expect(covCmd?.description).toContain('jobs@1');
		expect(covCmd?.description).toContain('unreached:<partition>');

		// Rejects jobs@1 without captures, captures without jobs@1, and unknown obligation sets.
		for (const bad of [
			{ obligations: 'jobs@1' },
			{ captures: 'main' },
			{ obligations: 'schema-partitions@1', captures: 'main' },
			{ obligations: 'unknown@1', captures: 'main' },
		]) {
			const res = await executeSpecimenCommand(instance, 'specimen-coverage', bad);
			expect(res.success, JSON.stringify(bad)).toBe(false);
			expect(res.error?.code, JSON.stringify(bad)).toBe('VALIDATION_ERROR');
		}
		expect(instance.coverage).not.toHaveBeenCalled();

		vi.mocked(instance.coverage).mockResolvedValueOnce({
			obligations: 'jobs@1',
			complete: false,
			components: [
				{
					tag: 'example-notice',
					sources: ['manifest'],
					cases: 1,
					obligations: [
						{
							id: 'unreached:variant=warning',
							kind: 'property',
							level: 'represented',
							evidence: [
								{
									specimen: 'example-keep-a-draft/4',
									checkpoint: 'conflict-notice',
									target: 'root/example-notice:1',
								},
							],
							evidenceCount: 1,
						},
						{
							id: 'unreached:variant=error',
							kind: 'property',
							level: 'missing',
							evidence: [],
							evidenceCount: 0,
							reason: 'No job capture shows variant as error.',
						},
					],
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

		const ok = await executeSpecimenCommand(instance, 'specimen-coverage', {
			component: 'example-notice',
			obligations: 'jobs@1',
			captures: 'main',
		});
		expect(ok.success).toBe(true);
		expect(instance.coverage).toHaveBeenCalledWith({
			component: 'example-notice',
			obligations: 'jobs@1',
			captures: 'main',
		});
		expect(ok.data).toMatchObject({
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
		});

		vi.mocked(instance.coverage).mockRejectedValueOnce(
			Object.assign(new Error('Capture set not found: nope'), {
				code: 'CAPTURE_SET_NOT_FOUND',
				suggestion:
					'Run specimen-capture with label "nope" first; labels are local pointers, not git refs.',
			})
		);
		const missing = await executeSpecimenCommand(instance, 'specimen-coverage', {
			obligations: 'jobs@1',
			captures: 'nope',
		});
		expect(missing.success).toBe(false);
		expect(missing.error?.code).toBe('CAPTURE_SET_NOT_FOUND');
		expect(missing.error?.suggestion).toContain('specimen-capture');
	});

	it('filters and paginates specimen-list and validates GateRun + single-id capture on specimen-run', async () => {
		const instance = bench();
		instance.list = vi.fn(() => [
			{
				id: 'select-setup',
				title: 'Select / Setup',
				module: './select.js',
				exportName: 'Setup',
				kind: 'native' as const,
				component: 'example-select',
				pattern: { library: 'example', pattern: 'select', setup: 'three-options' },
			},
			{
				id: 'select-setup--gate--named',
				title: 'select / named',
				module: 'specimens/patterns/select/pattern.json',
				exportName: 'named',
				kind: 'gate' as const,
				component: 'example-select',
				pattern: { library: 'example', pattern: 'select', setup: 'three-options', gate: 'named' },
			},
			{
				id: 'select-setup--gate--escape-closes',
				title: 'select / escape-closes',
				module: 'specimens/patterns/select/pattern.json',
				exportName: 'escape-closes',
				kind: 'gate' as const,
				component: 'example-select',
				pattern: {
					library: 'example',
					pattern: 'select',
					setup: 'three-options',
					gate: 'escape-closes',
				},
			},
		]);

		const page1 = await executeSpecimenCommand(instance, 'specimen-list', {
			kind: 'gate',
			pattern: 'example/select',
			component: 'example-select',
			limit: 1,
		});
		expect(page1.success).toBe(true);
		expect(page1.data).toMatchObject({
			specimens: [{ id: 'select-setup--gate--named', kind: 'gate' }],
			next: 'select-setup--gate--named',
		});

		const page2 = await executeSpecimenCommand(instance, 'specimen-list', {
			kind: 'gate',
			pattern: 'example/select',
			limit: 1,
			after: 'select-setup--gate--named',
		});
		expect(page2.success).toBe(true);
		expect(page2.data).toMatchObject({
			specimens: [{ id: 'select-setup--gate--escape-closes', kind: 'gate' }],
		});
		expect((page2.data as { next?: string }).next).toBeUndefined();

		instance.run = vi.fn(async () => ({
			id: 'select-setup--gate--escape-closes',
			outcome: {
				status: 'out-of-context' as const,
				reason: 'Desktop only.',
				failures: [],
			},
			observation: null,
		}));
		const gateResult = await executeSpecimenCommand(instance, 'specimen-run', {
			id: 'select-setup--gate--escape-closes',
			capture: 'none',
		});
		expect(gateResult.success).toBe(true);
		expect(instance.run).toHaveBeenCalledWith({
			id: 'select-setup--gate--escape-closes',
			capture: 'none',
		});
		expect(gateResult.data).toEqual({
			id: 'select-setup--gate--escape-closes',
			outcome: { status: 'out-of-context', reason: 'Desktop only.', failures: [] },
			observation: null,
		});

		// Per-error recovery suggestions for all 10 Patterns typed error codes (spec §5.5).
		const patternErrorCodes: Array<[string, string]> = [
			['TARGET_NOT_FOUND', 'accessible element'],
			['TARGET_AMBIGUOUS', 'nameStartsWith'],
			['SPECIMEN_NOT_FOUND', 'specimen-list'],
			['ALREADY_EXISTS', 'replace: true'],
			['PATTERN_UNKNOWN', 'createPattern: true'],
			['COPY_NOT_FOUND', 'specimen-pattern-save'],
			['COPY_DOWNGRADE_REFUSED', 'allowDowngrade: true'],
			['COPY_REFRESH_UNSUPPORTED', 'origin.target'],
			['PATTERN_SETUP_MISSING', 'specimen-suggest'],
			['POINT_STALE', 'specimen-point'],
		];
		for (const [code, snippet] of patternErrorCodes) {
			vi.mocked(instance.pack).mockRejectedValueOnce(
				Object.assign(new Error(`Simulated ${code}`), { code })
			);
			const errRes = await executeSpecimenCommand(instance, 'specimen-pack', {});
			expect(errRes.success, code).toBe(false);
			expect(errRes.error?.code, code).toBe(code);
			expect(errRes.error?.suggestion, code).toContain(snippet);
		}
	});

	it('exposes the 6 specimen-note-* commands with mutation metadata, schema validation, and structured errors', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const mutation = (name: string) => commands.find((command) => command.name === name)?.mutation;
		expect(mutation('specimen-note-add')).toBe(true);
		expect(mutation('specimen-note-list')).toBe(false);
		expect(mutation('specimen-note-check')).toBe(true);
		expect(mutation('specimen-note-move')).toBe(true);
		expect(mutation('specimen-note-resolve')).toBe(true);
		expect(mutation('specimen-note-reopen')).toBe(true);

		const added = await executeSpecimenCommand(instance, 'specimen-note-add', {
			pointer:
				'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:2&pin=0.4,0.6',
			text: 'Export should offer CSV and PDF',
			assignee: 'agent',
		});
		expect(added.success).toBe(true);
		expect(instance.noteAdd).toHaveBeenCalledTimes(1);

		const listed = await executeSpecimenCommand(instance, 'specimen-note-list', {
			assignee: 'agent',
			limit: 20,
		});
		expect(listed.success).toBe(true);
		expect(instance.noteList).toHaveBeenCalledWith({ assignee: 'agent', limit: 20 });

		const checked = await executeSpecimenCommand(instance, 'specimen-note-check', {});
		expect(checked.success).toBe(true);
		expect(instance.noteCheck).toHaveBeenCalledWith({});

		const moved = await executeSpecimenCommand(instance, 'specimen-note-move', {
			id: 'note-9v4b7n2k5m1c',
			point: 'pt-5r8k2w9m4c1x',
			reason: 'Archive moved into overflow menu',
		});
		expect(moved.success).toBe(true);

		const resolved = await executeSpecimenCommand(instance, 'specimen-note-resolve', {
			id: 'note-9v4b7n2k5m1c',
			outcome: 'fixed',
			reason: 'Export offers CSV and PDF',
			evidence: { revision: '4f2c9a1' },
		});
		expect(resolved.success).toBe(true);

		const reopened = await executeSpecimenCommand(instance, 'specimen-note-reopen', {
			id: 'note-9v4b7n2k5m1c',
			reason: 'PDF fails for long reports',
		});
		expect(reopened.success).toBe(true);

		// Invalid mutual-exclusion / range shapes fail with VALIDATION_ERROR
		for (const [cmd, badInput] of [
			['specimen-note-add', { point: 'pt-1', pointer: 'specimen:a#ref=root/div:1', text: 'x' }],
			['specimen-note-list', { limit: 101 }],
			['specimen-note-move', { id: 'note-9v4b7n2k5m1c', reason: 'no target' }],
			[
				'specimen-note-resolve',
				{ id: 'note-1', ids: ['note-1'], outcome: 'fixed', reason: 'both' },
			],
		] as const) {
			const res = await executeSpecimenCommand(instance, cmd, badInput);
			expect(res.success, cmd).toBe(false);
			expect(res.error?.code, cmd).toBe('VALIDATION_ERROR');
		}

		// Structured Slice 2 error codes pass through cleanly (including empty text / omitted reason)
		for (const [cmd, input, method, code, suggestion] of [
			[
				'specimen-note-add',
				{ pointer: 'specimen:a#ref=root/div:1', text: '' },
				'noteAdd',
				'NOTE_EMPTY',
				'Say what you noticed.',
			],
			[
				'specimen-note-add',
				{ point: 'pt-2k7m9p4x8c1v', text: 'Stale' },
				'noteAdd',
				'POINT_STALE',
				'Run specimen-point to point again.',
			],
			[
				'specimen-note-move',
				{ id: 'note-9v4b7n2k5m1c', point: 'pt-5r8k2w9m4c1x' },
				'noteMove',
				'REASON_REQUIRED',
				'Give a reason: what was done and why.',
			],
			[
				'specimen-note-resolve',
				{ id: 'note-9v4b7n2k5m1c', outcome: 'fixed' },
				'noteResolve',
				'REASON_REQUIRED',
				'Give a reason: what was done and why.',
			],
			[
				'specimen-note-resolve',
				{ id: 'note-000000000000', outcome: 'fixed', reason: 'Done' },
				'noteResolve',
				'NOTE_NOT_FOUND',
				'Run specimen-note-list to see available notes.',
			],
			[
				'specimen-note-resolve',
				{ id: 'note-9v4b7n2k5m1c', outcome: 'fixed', reason: 'Done' },
				'noteResolve',
				'NOTE_ALREADY_RESOLVED',
				'Run specimen-note-reopen to reopen it.',
			],
			[
				'specimen-note-reopen',
				{ id: 'note-9v4b7n2k5m1c', reason: 'Again' },
				'noteReopen',
				'NOTE_NOT_RESOLVED',
				'Run specimen-note-resolve to close an open note.',
			],
		] as const) {
			vi.mocked(instance[method]).mockRejectedValueOnce(
				Object.assign(new Error(code), { code, suggestion })
			);
			const res = await executeSpecimenCommand(instance, cmd, input);
			expect(res.success, code).toBe(false);
			expect(res.error?.code, code).toBe(code);
			expect(res.error?.suggestion, code).toBe(suggestion);
		}
	});

	it('exposes decision-record/get/list/check with metadata and satisfies Scenario 03 end-to-end', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-decisions-'));
		try {
			await mkdir(join(root, 'src', 'toolbar'), { recursive: true });
			await writeFile(join(root, 'src', 'toolbar', 'toolbar.css'), '.toolbar {}');

			const entries: SpecimenEntry[] = [
				{ id: 'toolbar--dense', title: 'Toolbar/Dense', module: './t.ts', exportName: 'Dense' },
				{ id: 'toolbar--airy', title: 'Toolbar/Airy', module: './t.ts', exportName: 'Airy' },
				{
					id: 'toolbar--grouped',
					title: 'Toolbar/Grouped',
					module: './t.ts',
					exportName: 'Grouped',
				},
				{ id: 'list--empty', title: 'List/Empty', module: './l.ts', exportName: 'Empty' },
				{
					id: 'list--empty-plain',
					title: 'List/EmptyPlain',
					module: './l.ts',
					exportName: 'EmptyPlain',
				},
			];
			const instance = bench();
			instance.compare = (request) =>
				runCompare(
					{
						root,
						entries,
						workers: 2,
						prepare: async () => {},
						sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
						render: async ({ entry, context, screenshot }) => {
							await writeFile(screenshot, `png:${entry.id}`);
							const obs = observation();
							obs.manifest.specimenId = entry.id;
							obs.manifest.context.theme = context.theme;
							obs.manifest.context.viewport = context.viewport;
							obs.channels.visual.path = screenshot;
							obs.channels.a11y.axe =
								entry.id === 'toolbar--grouped'
									? {
											status: 'failed',
											policy: 'error',
											violations: [
												{
													id: 'color-contrast',
													impact: 'serious',
													help: 'contrast',
													targets: ['span.group-label'],
													details: [],
												},
											],
											incomplete: 0,
											incompleteChecks: [],
											exceptions: [],
										}
									: {
											status: 'passed',
											policy: 'error',
											violations: [],
											incomplete: 0,
											incompleteChecks: [],
											exceptions: [],
										};
							return obs;
						},
					},
					request
				);
			instance.recordDecision = (request, options) => recordDecision(root, request, options);
			instance.getDecision = (request) => getDecision(root, request);
			instance.listDecisions = () => listDecisions(root);
			instance.checkDecisions = (request) => checkDecisions(root, request);

			const commands = createSpecimenCommands(instance);
			const byName = (name: string) => commands.find((command) => command.name === name);
			expect(byName('decision-record')?.mutation).toBe(true);
			expect(byName('decision-record')?.confirmPrompt).toBeTruthy();
			expect(byName('decision-get')?.mutation).toBe(false);
			expect(byName('decision-list')?.mutation).toBe(false);
			expect(byName('decision-check')?.mutation).toBe(false);
			expect(byName('decision-check')?.description).toContain('before editing');
			expect(byName('decision-check')?.description).toContain('decision-list');

			// Scenario 03 step 1: compare three variants.
			const compared = await executeSpecimenCommand(instance, 'specimen-compare', {
				ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
			});
			expect(compared.success).toBe(true);
			const setId = (compared.data as { set: string }).set;
			expect(setId).toMatch(/^set-/);

			// Scenario 03 step 2: empty reason returns REASON_REQUIRED (not VALIDATION_ERROR).
			const noReason = await executeSpecimenCommand(instance, 'decision-record', {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: setId,
				chosen: 'toolbar--dense',
				reason: '',
			});
			expect(noReason.success).toBe(false);
			expect(noReason.error).toMatchObject({
				code: 'REASON_REQUIRED',
				suggestion: expect.stringContaining('reason'),
			});

			// Scenario 03 step 3: unknown variant returns VARIANT_NOT_FOUND.
			const badVariant = await executeSpecimenCommand(instance, 'decision-record', {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: setId,
				chosen: 'toolbar--compact',
				reason: 'Fits twelve commands.',
			});
			expect(badVariant.success).toBe(false);
			expect(badVariant.error).toMatchObject({
				code: 'VARIANT_NOT_FOUND',
				message: expect.stringContaining('toolbar--compact'),
				suggestion: expect.stringContaining('toolbar--dense'),
			});

			// Scenario 03 step 4: axe-failing variant returns CHOSEN_FAILS_GATE.
			const failedGate = await executeSpecimenCommand(instance, 'decision-record', {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: setId,
				chosen: 'toolbar--grouped',
				reason: 'Groups read better.',
			});
			expect(failedGate.success).toBe(false);
			expect(failedGate.error).toMatchObject({
				code: 'CHOSEN_FAILS_GATE',
				message: expect.stringContaining('color-contrast'),
				suggestion: expect.stringContaining('specimen-compare'),
			});

			// Scenario 03 step 5: record choice with reason, files, tokens; subjects.specimens defaults to [chosen].
			const recorded = await executeSpecimenCommand(instance, 'decision-record', {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: setId,
				chosen: 'toolbar--dense',
				reason: 'The editor shows twelve commands; at the airy gap the last three wrap at 1280 px.',
				subjects: {
					files: ['src/toolbar/**'],
					tokens: ['space.toolbar.gap'],
				},
			});
			expect(recorded.success).toBe(true);
			expect(recorded.data).toMatchObject({
				decision: expect.stringMatching(/^dec-[0-9a-hjkmnp-tv-z]{12}$/),
				kind: 'choice',
				chosen: 'toolbar--dense',
				kept: ['toolbar--airy', 'toolbar--grouped'],
				path: expect.stringMatching(/^specimens\/decisions\/dec-[0-9a-hjkmnp-tv-z]{12}\.json$/),
				evidenceDir: expect.stringMatching(/^specimens\/evidence\/set-[0-9a-f]{12}\/$/),
			});
			const decisionId = (recorded.data as { decision: string }).decision;

			// Scenario 03 step 6: read back via decision-get.
			const fetched = await executeSpecimenCommand(instance, 'decision-get', {
				decision: decisionId,
			});
			expect(fetched.success).toBe(true);
			expect(fetched.data).toMatchObject({
				reason: expect.stringContaining('twelve commands'),
				evidence: {
					set: expect.stringMatching(/^set-[0-9a-f]{12}$/),
					captures: expect.arrayContaining([
						expect.objectContaining({ id: 'toolbar--dense' }),
						expect.objectContaining({ id: 'toolbar--airy' }),
						expect.objectContaining({ id: 'toolbar--grouped' }),
					]),
				},
				subjects: { specimens: ['toolbar--dense'] },
			});
			expect(
				(fetched.data as { evidence: { captures: unknown[] } }).evidence.captures
			).toHaveLength(3);

			// decision-check matches files and tokens.
			const fileCheck = await executeSpecimenCommand(instance, 'decision-check', {
				files: ['src/toolbar/toolbar.css'],
			});
			expect(fileCheck.success).toBe(true);
			expect(fileCheck.data).toMatchObject({
				decisions: [
					{
						decision: decisionId,
						matched: { files: ['src/toolbar/toolbar.css'] },
					},
				],
			});

			// Undecided comparison + decision-list.
			const listCompared = await executeSpecimenCommand(instance, 'specimen-compare', {
				ids: ['list--empty', 'list--empty-plain'],
			});
			expect(listCompared.success).toBe(true);
			const undecidedSet = (listCompared.data as { set: string }).set;

			const listed = await executeSpecimenCommand(instance, 'decision-list', {});
			expect(listed.success).toBe(true);
			expect(listed.data).toEqual({
				decisions: [
					{
						decision: decisionId,
						question: 'How dense should the toolbar be?',
						chosen: 'toolbar--dense',
						stale: [],
					},
				],
				undecided: [{ set: undecidedSet, ids: ['list--empty', 'list--empty-plain'] }],
			});

			// DECISION_NOT_FOUND points to decision-list.
			const notFound = await executeSpecimenCommand(instance, 'decision-get', {
				decision: 'dec-q7k2m4xab3nb',
			});
			expect(notFound.success).toBe(false);
			expect(notFound.error).toMatchObject({
				code: 'DECISION_NOT_FOUND',
				suggestion: expect.stringContaining('decision-list'),
			});

			// decidedBy derives kind: 'person' exclusively from accepted humanConfirmed provenance, never actor.kind.
			const decisionRecordCmd = createSpecimenCommands(instance)[33];
			expect(decisionRecordCmd.name).toBe('decision-record');
			const humanActorRecorded = await decisionRecordCmd.handler(
				{
					slug: 'list-empty-state',
					question: 'Include hint in empty list?',
					set: undecidedSet,
					chosen: 'list--empty',
					reason: 'Hint explains how to create the first item.',
				},
				{ actor: { kind: 'human', id: 'alice' } }
			);
			expect(humanActorRecorded.success).toBe(true);
			const listDecisionId = (humanActorRecorded.data as { decision: string }).decision;
			const fetchedListDecision = await executeSpecimenCommand(instance, 'decision-get', {
				decision: listDecisionId,
			});
			expect(fetchedListDecision.success).toBe(true);
			expect(fetchedListDecision.data).toMatchObject({
				decidedBy: { kind: 'script' },
			});

			// executeSpecimenCommand distinguishes test actor, unconfirmed human/agent actor (-> script), and humanConfirmed (-> person).
			const testRecorded = await executeSpecimenCommand(
				instance,
				'decision-record',
				{
					slug: 'list-empty-test',
					question: 'Include hint in test?',
					set: undecidedSet,
					chosen: 'list--empty',
					reason: 'Scenario test actor.',
				},
				{ actor: { kind: 'test', id: 'scenario-runner' } }
			);
			expect(testRecorded.success).toBe(true);
			const fetchedTest = await executeSpecimenCommand(instance, 'decision-get', {
				decision: (testRecorded.data as { decision: string }).decision,
			});
			expect(fetchedTest.data).toMatchObject({
				decidedBy: { kind: 'test', id: 'scenario-runner' },
			});

			const unconfirmedHuman = await executeSpecimenCommand(
				instance,
				'decision-record',
				{
					slug: 'list-empty-unconfirmed',
					question: 'Unconfirmed human?',
					set: undecidedSet,
					chosen: 'list--empty',
					reason: 'No elicitation happened.',
				},
				{ actor: { kind: 'human', id: 'alice' }, confirmedBy: 'alice' }
			);
			expect(unconfirmedHuman.success).toBe(true);
			const fetchedUnconfirmed = await executeSpecimenCommand(instance, 'decision-get', {
				decision: (unconfirmedHuman.data as { decision: string }).decision,
			});
			expect(fetchedUnconfirmed.data).toMatchObject({
				decidedBy: { kind: 'script' },
			});
			expect(
				(fetchedUnconfirmed.data as { decidedBy: { id?: string } }).decidedBy.id
			).toBeUndefined();

			const confirmedAgent = await executeSpecimenCommand(
				instance,
				'decision-record',
				{
					slug: 'list-empty-confirmed',
					question: 'Confirmed via elicitation?',
					set: undecidedSet,
					chosen: 'list--empty',
					reason: 'Human accepted MCP elicitation.',
				},
				{ actor: { kind: 'agent' }, humanConfirmed: true, confirmedBy: '   ' }
			);
			expect(confirmedAgent.success).toBe(true);
			const fetchedConfirmed = await executeSpecimenCommand(instance, 'decision-get', {
				decision: (confirmedAgent.data as { decision: string }).decision,
			});
			expect(fetchedConfirmed.data).toMatchObject({
				decidedBy: { kind: 'person' },
			});
			expect(
				(fetchedConfirmed.data as { decidedBy: { id?: string } }).decidedBy.id
			).toBeUndefined();

			const confirmedWithId = await executeSpecimenCommand(
				instance,
				'decision-record',
				{
					slug: 'list-empty-confirmed-id',
					question: 'Confirmed with host-verified id?',
					set: undecidedSet,
					chosen: 'list--empty',
					reason: 'Host verified person id.',
				},
				{ actor: { kind: 'agent' }, humanConfirmed: true, confirmedBy: '  alice  ' }
			);
			expect(confirmedWithId.success).toBe(true);
			const fetchedConfirmedId = await executeSpecimenCommand(instance, 'decision-get', {
				decision: (confirmedWithId.data as { decision: string }).decision,
			});
			expect(fetchedConfirmedId.data).toMatchObject({
				decidedBy: { kind: 'person', id: 'alice' },
			});

			// Default review resolution through executeSpecimenCommand enforces REVIEW_ITEM_NOT_FOUND with zero injection.
			const badReview = await executeSpecimenCommand(instance, 'decision-record', {
				items: [`changed:deadbeef0000:deadbeef0000:${setId}..${undecidedSet}`],
				chosen: 'accept',
				reason: 'Fabricated item.',
			});
			expect(badReview.success).toBe(false);
			expect(badReview.error?.code).toBe('REVIEW_ITEM_NOT_FOUND');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes specimen-review as a read-only command with cause grouping, SUPERSEDE_REQUIRED, and reject blocking', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-review-'));
		try {
			const mkObs = (id: string, gap: string, theme: 'light' | 'dark' = 'light'): Observation => {
				const base = observation();
				return {
					...base,
					manifest: {
						...base.manifest,
						specimenId: id,
						context: { ...base.manifest.context, theme },
					},
					channels: {
						...base.channels,
						dom: { raw: `<div>${id}</div>`, normalized: `<div>${id}</div>` },
						a11y: {
							snapshot: `- region "${id}"`,
							axe: {
								status: 'passed',
								policy: 'error',
								violations: [],
								incomplete: 0,
								incompleteChecks: [],
								exceptions: [],
							},
						},
						elements: [
							{
								ref: 'root/toolbar:1',
								tag: 'div',
								attributes: {},
								box: { x: 0, y: 0, width: 200, height: 32 },
								scroll: { width: 200, height: 32, clientWidth: 200, clientHeight: 32 },
								styles: { gap },
								state: {},
							},
						],
					},
				};
			};
			const realInstance: SpecimenCommandBench = {
				...bench(),
				review: (req) => runReview(root, req),
				recordDecision: (req, opts) => recordDecision(root, req, opts),
			};
			const reviewCmd = createSpecimenCommands(realInstance)[5];
			expect(reviewCmd.name).toBe('specimen-review');
			expect(reviewCmd.mutation).toBe(false);
			expect(reviewCmd.description).toContain('specimen-capture');
			expect(reviewCmd.description).toContain('questions for the person');

			const { writeCaptureSet } = await import('@lushly-dev/specimen');
			const ctx = {
				viewport: { width: 800, height: 600 },
				theme: 'light' as const,
				locale: 'en-US',
				reducedMotion: 'no-preference' as const,
				motion: 'natural' as const,
			};
			const checkpoint = {
				name: 'mount',
				actionMode: 'none' as const,
				baseline: {
					clock: 'real' as const,
					random: { source: 'seeded' as const, seed: 1 },
					storage: 'empty' as const,
				},
			};
			await writeCaptureSet(root, {
				kind: 'capture',
				label: 'main',
				context: ctx,
				checkpoint,
				browser: { name: 'chromium', version: '1' },
				axe: true,
				revision: 'a1b2c3d',
				dirty: false,
				skipped: { jobs: 0, gates: 0 },
				entries: [
					{
						key: 'toolbar--dense',
						id: 'toolbar--dense',
						status: 'captured',
						observation: mkObs('toolbar--dense', '4px'),
					},
					{
						key: 'button--primary',
						id: 'button--primary',
						status: 'captured',
						observation: mkObs('button--primary', '4px'),
					},
				],
			});
			await writeCaptureSet(root, {
				kind: 'capture',
				label: 'branch',
				context: ctx,
				checkpoint,
				browser: { name: 'chromium', version: '1' },
				axe: true,
				revision: 'e4f5a6b',
				dirty: false,
				skipped: { jobs: 0, gates: 0 },
				entries: [
					{
						key: 'toolbar--dense',
						id: 'toolbar--dense',
						status: 'captured',
						observation: mkObs('toolbar--dense', '8px'),
					},
					{
						key: 'button--primary',
						id: 'button--primary',
						status: 'captured',
						observation: mkObs('button--primary', '4px'),
					},
				],
			});

			const rev = await executeSpecimenCommand(realInstance, 'specimen-review', {
				before: 'main',
				after: 'branch',
			});
			expect(rev.success).toBe(true);
			const data = rev.data as {
				open: { item: string; ids: string[] }[];
				blocking: unknown[];
				settled: { unchanged: number; kept: number; answered: number };
			};
			expect(data.open).toHaveLength(1);
			expect(data.open[0]?.ids).toEqual(['toolbar--dense']);
			expect(data.settled).toEqual({ unchanged: 1, kept: 0, answered: 0 });

			// Rejecting moves it to blocking without writing subjects.
			const openItemId = data.open[0]?.item ?? '';
			const rej = await executeSpecimenCommand(realInstance, 'decision-record', {
				items: [openItemId],
				chosen: 'reject',
				reason: 'Gap regresses compact density.',
			});
			expect(rej.success).toBe(true);
			const revAfter = await executeSpecimenCommand(realInstance, 'specimen-review', {
				before: 'main',
				after: 'branch',
			});
			expect(revAfter.success).toBe(true);
			expect(revAfter.data).toMatchObject({
				open: [],
				blocking: [
					{
						kind: 'rejected',
						ids: ['toolbar--dense'],
						reason: 'Gap regresses compact density.',
					},
				],
				settled: { unchanged: 1, kept: 0, answered: 0 },
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes design-states as a read-only command with outputBudget and satisfies Scenarios 01, 09 step 1, and 10 step 1', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-design-states-'));
		try {
			await writeFile(
				join(root, 'bookshop.commands.json'),
				JSON.stringify({
					app: 'bookshop',
					defaultsVersion: 'afd-defaults@1.0.0',
					commands: [
						{ name: 'order-create', undoable: true, errors: ['OUT_OF_STOCK'] },
						{ name: 'stock-list', returnsCollection: true },
						{ name: 'catalog-import', batch: true },
						{ name: 'member-delete', destructive: true },
					],
				})
			);
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify({
					defaults: 'afd-defaults@1.0.0',
					commandManifest: './bookshop.commands.json',
				})
			);
			const realBench = await createSpecimenBench({ root });
			try {
				const commands = createSpecimenCommands(realBench);
				const def = commands.find((command) => command.name === 'design-states');
				expect(def).toMatchObject({
					name: 'design-states',
					mutation: false,
					expose: { mcp: true, cli: true },
					outputBudget: { defaultBytes: 32768, maxBytes: 98304 },
				});

				const ok = await executeSpecimenCommand(realBench, 'design-states', {
					commands: ['order-create', 'stock-list', 'catalog-import', 'member-delete'],
				});
				expect(ok.success).toBe(true);
				expect(ok.data).toMatchObject({
					defaultsVersion: 'afd-defaults@1.0.0',
					nextSteps: [expect.stringContaining('components-brief'), expect.any(String)],
					unmeasured: expect.arrayContaining([
						expect.objectContaining({
							area: 'screen-gates',
							addToMeasure: expect.stringContaining('specimen-capture'),
						}),
					]),
				});

				const empty = await executeSpecimenCommand(realBench, 'design-states', {});
				expect(empty.success).toBe(false);
				expect(empty.error).toMatchObject({
					code: 'NO_COMMANDS',
					suggestion: expect.stringContaining('commands'),
				});

				const missing = await executeSpecimenCommand(realBench, 'design-states', {
					commands: ['book-teleport'],
				});
				expect(missing.success).toBe(false);
				expect(missing.error).toMatchObject({
					code: 'TARGET_COMMAND_NOT_FOUND',
					message: expect.stringContaining('book-teleport'),
					suggestion: expect.stringContaining('manifest'),
				});
			} finally {
				await realBench.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes panel-walk as a long-running optional-task mutation without approval, enforces modality tools, and checks outputBudget', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-panel-walk-'));
		try {
			await writeFile(
				join(root, 'walk-driver.mjs'),
				`export default async function driver(ctx) {
					const oversized = ctx.target.includes('oversized=1');
					return {
						transcript: 'Done.',
						actions: 1,
						journal: [],
						findings: oversized
							? Array.from({ length: 120 }, (_, i) => ({
									summary: 'Finding ' + i + ' ' + 'x'.repeat(250),
									evidence: 'observed',
									where: 'checkout-screen',
								}))
							: [],
					};
				}\n`
			);
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify({
					panel: {
						jobs: ['checkout-out-of-stock'],
						personas: [{ id: 'p-sr', modality: 'screen-reader' }],
						driver: './walk-driver.mjs',
					},
				})
			);
			const realBench = await createSpecimenBench({ root });
			try {
				const commands = createSpecimenCommands(realBench);
				const def = commands.find((command) => command.name === 'panel-walk');
				expect(def).toMatchObject({
					name: 'panel-walk',
					mutation: true,
					executionTime: 'long-running',
					task: 'optional',
					outputBudget: { defaultBytes: 24576, maxBytes: 65536 },
					errors: ['MODALITY_FORBIDDEN', 'JOB_NOT_FOUND', 'PERSONA_NOT_FOUND', 'WALK_NOT_FOUND'],
					expose: { mcp: true, cli: true },
				});
				expect(def?.confirmPrompt).toBeUndefined();

				const forbidden = await executeSpecimenCommand(realBench, 'panel-walk', {
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173/checkout',
					requestedTools: ['click', 'dom_query'],
				});
				expect(forbidden.success).toBe(false);
				expect(forbidden.error).toMatchObject({
					code: 'MODALITY_FORBIDDEN',
					suggestion: expect.stringContaining('modality'),
				});

				const ok = await executeSpecimenCommand(realBench, 'panel-walk', {
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173/checkout',
					appDate: '2030-05-12',
				});
				expect(ok.success).toBe(true);
				expect(ok.data).toMatchObject({
					walk: expect.stringMatching(/^walk-[0-9a-hjkmnp-tv-z]{12}$/),
					modality: 'screen-reader',
					ending: 'done',
					path: { done: true, deviations: 0 },
				});
				expect(ok.metadata?.['dev.afd/outputBudget']).toMatchObject({
					limitBytes: 24576,
					usedBytes: expect.any(Number),
				});

				// Oversized mutation result keeps data (no truncation) and appends caution warning
				const over = await executeSpecimenCommand(realBench, 'panel-walk', {
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173/checkout?oversized=1',
				});
				expect(over.success).toBe(true);
				expect(over.warnings).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							code: 'OUTPUT_BUDGET_EXCEEDED',
							severity: 'caution',
						}),
					])
				);
				expect(over.metadata?.['dev.afd/outputBudget']).toMatchObject({
					limitBytes: 24576,
				});
			} finally {
				await realBench.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes Phase C2 metadata, anti-spoofing HumanRelay tokens, design-card-list, design-release, and DirectRegistry provisional writes', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-c2-'));
		try {
			const realInstance = bench();
			realInstance.recordDecision = (request, options) => recordDecision(root, request, options);
			realInstance.getDecision = (request) => getDecision(root, request);
			realInstance.listDecisions = (request) => listDecisions(root, request);
			realInstance.checkDecisions = (request) => checkDecisions(root, request);
			realInstance.listDesignCards = (request) => listDesignCards(root, request);
			realInstance.recordDesignRelease = (request, options) =>
				recordDesignRelease(root, request, options);

			const commands = createSpecimenCommands(realInstance);
			const byName = (name: string) => commands.find((command) => command.name === name);
			expect(byName('decision-record')).toMatchObject({
				category: 'decision',
				mutation: true,
				confirmationMode: 'host-verified',
			});
			expect(byName('design-card-list')).toMatchObject({
				category: 'design',
				mutation: false,
				outputBudget: { defaultBytes: 32768, maxBytes: 98304 },
			});
			expect(byName('design-release')).toMatchObject({
				category: 'design',
				mutation: true,
				confirmationMode: 'host-verified',
				outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
			});

			await writeCardRecord(root, {
				card: 'card-c20000000001',
				what: 'Clarify retry message',
				owner: 'product',
				scope: 'release',
				touches: ['src/checkout.ts'],
				severity: 'major',
				visual: { kind: 'transcript', summary: 'Walk stopped on unclear retry message.' },
				why: {
					findings: [{ summary: 'Retry button lacks error context.', evidence: 'observed' }],
					reviewerCount: 5,
					split: '5-0',
					trigger: 'split-3-to-2',
				},
				effect: {
					gatesBefore: { passed: 5, failed: 1 },
					gatesAfter: { passed: 6, failed: 0 },
					regression: false,
				},
				risk: { affects: ['checkout'], undoable: true },
				status: 'open',
			});

			const listed = await executeSpecimenCommand(realInstance, 'design-card-list', {});
			expect(listed.success).toBe(true);
			expect((listed.data as { cards: { card: string }[] }).cards.map((c) => c.card)).toEqual([
				'card-c20000000001',
			]);

			// Plain JSON object under SPECIMEN_RELAY_CONTEXT_KEY is ignored (cannot forge person provenance).
			const registry = createSpecimenDirectRegistry(realInstance);
			const spoofed = await registry.execute(
				'decision-record',
				{ card: 'card-c20000000001', chosen: 'approve', reason: 'Spoof attempt.' },
				{
					actor: { kind: 'agent' },
					[SPECIMEN_RELAY_CONTEXT_KEY]: {
						decisionId: 'fake-1',
						confirmedBy: 'spoof',
						channel: 'mcp-relay',
					},
				}
			);
			expect(spoofed.success).toBe(false);
			expect(spoofed.error?.code).toBe('PERSON_REQUIRED');

			// A token minted for design-release cannot be replayed on decision-record.
			const wrongCmdToken = await registry.execute(
				'decision-record',
				{ card: 'card-c20000000001', chosen: 'approve', reason: 'Replay wrong command.' },
				{
					actor: { kind: 'agent' },
					[SPECIMEN_RELAY_CONTEXT_KEY]: markSpecimenRelayConfirmed({
						decisionId: 'relay-wrong',
						command: 'design-release',
						confirmedBy: 'alice',
						channel: 'mcp-relay',
					}),
				}
			);
			expect(wrongCmdToken.success).toBe(false);
			expect(wrongCmdToken.error?.code).toBe('PERSON_REQUIRED');

			// Minted relay confirmation token succeeds and records person provenance.
			const minted = await registry.execute(
				'decision-record',
				{ card: 'card-c20000000001', chosen: 'approve', reason: 'Verified via HumanRelay.' },
				{
					actor: { kind: 'agent' },
					[SPECIMEN_RELAY_CONTEXT_KEY]: markSpecimenRelayConfirmed({
						decisionId: 'relay-1',
						command: 'decision-record',
						confirmedBy: 'alice',
						channel: 'mcp-relay',
					}),
				}
			);
			expect(minted.success).toBe(true);
			const decisionId = (minted.data as { decision: string }).decision;

			// design-release succeeds with minted relay confirmation token.
			const released = await registry.execute(
				'design-release',
				{ release: '1.0.0', decisions: [decisionId] },
				{
					actor: { kind: 'agent' },
					[SPECIMEN_RELAY_CONTEXT_KEY]: markSpecimenRelayConfirmed({
						decisionId: 'relay-2',
						command: 'design-release',
						confirmedBy: 'alice',
						channel: 'mcp-relay',
					}),
				}
			);
			expect(released.success).toBe(true);
			expect((released.data as { release: string }).release).toBe('1.0.0');

			// DirectRegistry in-process Mode 3 provisional write requires host-minted server changeAuthor and enforces AUTHOR_CANNOT_DECIDE.
			realInstance.recordDecision = (request, options) =>
				recordDecision(root, request, {
					...options,
					resolveReviewItem: async (item) => ({
						entry: { item, fingerprint: 'fp-direct' },
						afterSet: 'set-0123456789ab',
						touchedChoices: [],
						question: 'Accept spacing tweak?',
					}),
				});
			const selfDecide = await registry.execute(
				'decision-record',
				{
					items: ['changed:a:b:set-111111111111..set-0123456789ab'],
					chosen: 'accept',
					reason: 'Author trying to settle own change.',
					provisional: true,
					panel: { reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'], split: '5-0' },
					changeAuthor: 'author-bot',
				},
				{
					actor: { kind: 'agent', id: 'author-bot' },
					[SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY]: markSpecimenChangeAuthor('author-bot'),
				}
			);
			expect(selfDecide.success).toBe(false);
			expect(selfDecide.error?.code).toBe('AUTHOR_CANNOT_DECIDE');

			// Plain JSON object under SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY is ignored (fails closed with AUTHOR_CANNOT_DECIDE).
			const spoofedAuthor = await registry.execute(
				'decision-record',
				{
					items: ['changed:a:b:set-111111111111..set-0123456789ab'],
					chosen: 'accept',
					reason: 'Spoofed author context.',
					provisional: true,
					panel: { reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'], split: '5-0' },
				},
				{
					actor: { kind: 'agent', id: 'panel-bot' },
					[SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY]: { author: 'author-bot' },
				}
			);
			expect(spoofedAuthor.success).toBe(false);
			expect(spoofedAuthor.error?.code).toBe('AUTHOR_CANNOT_DECIDE');

			const independent = await registry.execute(
				'decision-record',
				{
					items: ['changed:a:b:set-111111111111..set-0123456789ab'],
					chosen: 'accept',
					reason: 'Independent panel unanimous.',
					provisional: true,
					panel: { reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'], split: '5-0' },
					changeAuthor: 'author-bot',
				},
				{
					actor: { kind: 'agent', id: 'panel-bot' },
					[SPECIMEN_CHANGE_AUTHOR_CONTEXT_KEY]: markSpecimenChangeAuthor('author-bot'),
				}
			);
			expect(independent.success).toBe(true);
			expect((independent.data as { provisional?: boolean }).provisional).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('exposes Phase B2 copied-pattern commands with outputBudgets and validates inputs', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		const byName = (name: string) => commands.find((c) => c.name === name);

		expect(byName('specimen-pattern-fork')).toMatchObject({
			mutation: true,
			outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		});
		expect(byName('specimen-pattern-compare')).toMatchObject({
			mutation: false,
			outputBudget: { defaultBytes: 32768, maxBytes: 98304 },
		});
		expect(byName('specimen-pattern-merge')).toMatchObject({
			mutation: true,
			outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		});

		const forked = await executeSpecimenCommand(instance, 'specimen-pattern-fork', {
			source: 'afd-defaults/error-recovery',
			target: 'error-recovery',
			bind: true,
		});
		expect(forked.success).toBe(true);
		expect(forked.data).toMatchObject({
			pattern: 'error-recovery',
			approvalStatus: 'proposed',
			bindingStatus: 'pending-approval',
		});

		const compared = await executeSpecimenCommand(instance, 'specimen-pattern-compare', {
			pattern: 'error-recovery',
		});
		expect(compared.success).toBe(true);

		const badMerge = await executeSpecimenCommand(instance, 'specimen-pattern-merge', {
			pattern: 'error-recovery',
		});
		expect(badMerge.success).toBe(false);
		expect(badMerge.error?.code).toBe('VALIDATION_ERROR');

		const merged = await executeSpecimenCommand(instance, 'specimen-pattern-merge', {
			pattern: 'error-recovery',
			accept: ['error-recovery.keep.next'],
		});
		expect(merged.success).toBe(true);
		expect(merged.data).toMatchObject({
			stagedStatus: 'proposed',
			accepted: ['error-recovery.keep.next'],
		});

		expect(byName('panel-review')).toMatchObject({
			mutation: true,
			executionTime: 'long-running',
			task: 'optional',
			outputBudget: { defaultBytes: 32768, maxBytes: 98304 },
		});
		expect(byName('panel-review')?.approval).toBeUndefined();
		expect(byName('panel-calibrate')).toMatchObject({
			mutation: true,
			confirmationMode: 'host-verified',
			outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		});
		expect(byName('design-observe')).toMatchObject({
			mutation: false,
			outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
			errors: ['DECISION_NOT_FOUND', 'NOT_RELEASED', 'JOURNAL_NOT_FOUND'],
		});

		const observed = await executeSpecimenCommand(instance, 'design-observe', {
			decision: 'dec-000000000002',
			journal: 'journals/post-release.jsonl',
			beforeJournal: 'journals/pre-release.jsonl',
		});
		expect(observed.success).toBe(true);
		expect(observed.data).toMatchObject({
			decision: 'dec-000000000002',
			status: 'improved',
			metrics: { runs: 2, completionRate: 1, before: { runs: 2 } },
		});

		const badObserve = await executeSpecimenCommand(instance, 'design-observe', {
			decision: 'not-a-decision-id',
			journal: 'journals/post-release.jsonl',
		});
		expect(badObserve.success).toBe(false);
		expect(badObserve.error?.code).toBe('VALIDATION_ERROR');

		const reviewed = await executeSpecimenCommand(instance, 'panel-review', {
			change: 'checkout-fix',
			jobs: ['checkout-out-of-stock'],
			target: 'http://127.0.0.1:4181/?screen=checkout',
			appDate: '2030-05-12',
		});
		expect(reviewed.success).toBe(true);
		expect(reviewed.data).toMatchObject({ run: 'run-a1b2c3d4e5f6', panelSize: 5 });

		const sampled = await executeSpecimenCommand(instance, 'panel-calibrate', {
			action: 'sample',
			count: 2,
			seed: 7,
		});
		expect(sampled.success).toBe(true);
		expect(sampled.data).toMatchObject({ sample: 'cal-a1b2c3d4e5f6' });

		// Security: unverified actor.kind === 'human' MUST NOT pass invokingActorKind: 'person' to panelCalibrate
		await executeSpecimenCommand(
			instance,
			'panel-calibrate',
			{
				action: 'record',
				sample: 'cal-a1b2c3d4e5f6',
				judgements: [{ item: 'item-1', verdict: 'accept' }],
			},
			{ actor: { kind: 'human', id: 'spoofed' } }
		);
		expect(instance.panelCalibrate).toHaveBeenLastCalledWith(
			expect.objectContaining({ action: 'record' }),
			expect.objectContaining({ invokingActorKind: 'script', actorId: 'spoofed' })
		);

		// Verified actor kinds + host-verified humanConfirmed + server changeAuthor pass through cleanly
		await executeSpecimenCommand(
			instance,
			'panel-review',
			{
				change: 'checkout-fix',
				jobs: ['checkout-out-of-stock'],
				target: 'http://127.0.0.1:4181/?screen=checkout',
				appDate: '2030-05-12',
			},
			{ actor: { kind: 'agent', id: 'reviewer-1' }, changeAuthor: 'author-1' }
		);
		expect(instance.panelReview).toHaveBeenLastCalledWith(
			expect.objectContaining({ change: 'checkout-fix' }),
			expect.objectContaining({ actorId: 'reviewer-1', changeAuthor: 'author-1' })
		);

		await executeSpecimenCommand(
			instance,
			'panel-calibrate',
			{
				action: 'record',
				sample: 'cal-a1b2c3d4e5f6',
				judgements: [{ item: 'item-1', verdict: 'accept' }],
			},
			{ actor: { kind: 'agent', id: 'agent-1' } }
		);
		expect(instance.panelCalibrate).toHaveBeenLastCalledWith(
			expect.objectContaining({ action: 'record' }),
			expect.objectContaining({ invokingActorKind: 'agent', actorId: 'agent-1' })
		);

		await executeSpecimenCommand(
			instance,
			'panel-calibrate',
			{
				action: 'record',
				sample: 'cal-a1b2c3d4e5f6',
				judgements: [{ item: 'item-1', verdict: 'accept' }],
			},
			{ actor: { kind: 'test', id: 'test-1' } }
		);
		expect(instance.panelCalibrate).toHaveBeenLastCalledWith(
			expect.objectContaining({ action: 'record' }),
			expect.objectContaining({ invokingActorKind: 'test', actorId: 'test-1' })
		);

		await executeSpecimenCommand(
			instance,
			'panel-calibrate',
			{
				action: 'record',
				sample: 'cal-a1b2c3d4e5f6',
				judgements: [{ item: 'item-1', verdict: 'accept' }],
			},
			{ humanConfirmed: true, confirmedBy: 'owner-1', channel: 'mcp-relay' }
		);
		expect(instance.panelCalibrate).toHaveBeenLastCalledWith(
			expect.objectContaining({ action: 'record' }),
			expect.objectContaining({
				humanConfirmed: true,
				invokingActorKind: 'person',
				actorId: 'owner-1',
			})
		);
	});

	it('executes panel-review Mode 3 provisional decision-record via DirectRegistry without deadlocking and propagates errors', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-afd-panel-mode3-'));
		try {
			await mkdir(join(root, 'specimens/jobs'), { recursive: true });
			await writeFile(
				join(root, 'specimens/jobs/checkout-fix.scenario.yaml'),
				[
					'name: Checkout fix',
					'steps:',
					'  - description: Checkout step',
					'    command: cart-checkout',
					'    expect: { success: true }',
					'',
				].join('\n')
			);
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify({
					specimens: [
						{
							id: 'checkout-fix',
							title: 'Checkout/Fix',
							module: './noop.js',
							exportName: 'default',
							job: {
								scenario: './specimens/jobs/checkout-fix.scenario.yaml',
								target: 'app',
								captures: [{ after: 'Checkout step', name: 'checkout' }],
							},
						},
					],
					panel: {
						changeAuthors: { 'mode3-change': 'author-bot' },
					},
				})
			);
			await writeFile(join(root, 'noop.js'), 'export default {};\n');

			// Produce two real capture sets (`before` and `after`) with a real reviewable change
			const entries: SpecimenEntry[] = [
				{ id: 'checkout-btn', title: 'Checkout/Btn', module: './noop.js', exportName: 'default' },
			];
			const makeCapture = (label: string, text: string) =>
				runCaptureSet(
					{
						root,
						entries,
						workers: 1,
						prepare: async () => {},
						sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
						render: async ({ entry, context }) => {
							const obs = observation();
							obs.manifest.specimenId = entry.id;
							obs.manifest.context.theme = context.theme;
							obs.manifest.context.viewport = context.viewport;
							obs.channels.dom.raw = `<button>${text}</button>`;
							obs.channels.a11y.snapshot = `- button "${text}"`;
							return obs;
						},
					},
					{ label }
				);
			const before = await makeCapture('before-mode3', 'Checkout');
			const after = await makeCapture('after-mode3', 'Place order');

			const cleanDriver = async () => ({
				transcript: 'Completed checkout.\nDone.',
				actions: 1,
				journal: [{ command: 'cart-checkout', success: true }],
				findings: [],
			});
			const realBench = await createSpecimenBench({ root });
			const drivenBench: SpecimenCommandBench = Object.assign(Object.create(realBench), {
				panelReview: (
					req: Parameters<SpecimenCommandBench['panelReview']>[0],
					opts?: Parameters<SpecimenCommandBench['panelReview']>[1]
				) => realBench.panelReview(req, { ...opts, driver: cleanDriver }),
			});
			try {
				const res = await executeSpecimenCommand(
					drivenBench,
					'panel-review',
					{
						change: 'mode3-change',
						jobs: ['checkout-fix'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
						captures: { before: before.set, after: after.set },
					},
					{ actor: { kind: 'agent', id: 'independent-reviewer' } }
				);
				expect(res.error).toBeUndefined();
				expect(res.success).toBe(true);
				const listed = await listDecisions(root, { kind: 'answer' });
				expect(listed.decisions).toHaveLength(1);
				const recorded = await getDecision(root, {
					decision: listed.decisions[0]?.decision as string,
				});
				expect(recorded.kind).toBe('answer');
				if (recorded.kind === 'answer') {
					expect(recorded.provisional).toBe(true);
					expect(recorded.decidedBy).toMatchObject({ kind: 'panel', split: '5-0' });
				}
			} finally {
				await realBench.close();
			}

			// Verify Mode 3 error propagation (no swallowing) + cost-ledger preservation when recordDecision fails
			const after2 = await makeCapture('after-mode3-2', 'Submit order');
			const failingBench = await createSpecimenBench({ root });
			try {
				// Wrap bench so recordDecision fails deterministically during Mode 3 recording
				const wrapped: SpecimenCommandBench = Object.assign(Object.create(failingBench), {
					recordDecision: async () => {
						throw Object.assign(new Error('Simulated Mode 3 failure'), {
							code: 'AUTHOR_CANNOT_DECIDE',
						});
					},
					panelReview: (
						req: Parameters<SpecimenCommandBench['panelReview']>[0],
						opts?: Parameters<SpecimenCommandBench['panelReview']>[1]
					) => failingBench.panelReview(req, { ...opts, driver: cleanDriver }),
				});
				const failed = await executeSpecimenCommand(
					wrapped,
					'panel-review',
					{
						change: 'mode3-change',
						jobs: ['checkout-fix'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
						captures: { before: after.set, after: after2.set },
					},
					{ actor: { kind: 'agent', id: 'independent-reviewer' } }
				);
				expect(failed.success).toBe(false);
				expect(failed.error?.code).toBe('AUTHOR_CANNOT_DECIDE');
			} finally {
				await failingBench.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
