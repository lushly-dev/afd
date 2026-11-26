import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { CANONICAL_DEFAULT_PATTERNS } from './design-types.js';
import { gateRunSchema } from './schema.js';

const CLEAN_SPECIMENS_MODULE = `
const mount = (html, afterMount) => ({
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html.trim();
		const el = wrapper.firstElementChild;
		if (afterMount) {
			requestAnimationFrame(() => afterMount(el));
		}
		return el;
	},
});

export const AlternativesAndConfidence = mount(\`
	<section role="region" aria-label="Alternatives and confidence" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<p>Primary suggestion: Create task (92% confidence)</p>
		<button type="button">Use Completed status</button>
	</section>
\`);

export const ApprovalRequest = mount(
	\`<div role="alertdialog" aria-label="Approval required" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<p>Approve production deploy?</p>
		<button type="button" data-decline>Decline</button>
		<button type="button" data-approve>Approve</button>
	</div>\`,
	(el) => el.querySelector('[data-decline]')?.focus()
);

export const BatchPartialFailure = mount(\`
	<div style="max-width:100%;box-sizing:border-box;padding:8px;">
		<div role="status" aria-label="Batch import: 1 succeeded, 1 failed">1 succeeded, 1 failed</div>
		<button type="button">Retry failed item</button>
	</div>
\`);

export const CollectionPopulated = mount(\`
	<ul role="listbox" aria-label="Greetings" style="max-width:100%;box-sizing:border-box;padding:8px;list-style:none;">
		<li role="option" aria-selected="true" tabindex="0">Ada Lovelace</li>
		<li role="option" aria-selected="false" tabindex="-1">Grace Hopper</li>
	</ul>
\`);

export const CollectionEmpty = mount(\`
	<p style="max-width:100%;box-sizing:border-box;padding:8px;">Nothing here yet.</p>
\`);

export const CollectionFailed = mount(\`
	<div role="alert" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<p>Could not load greetings. Check connection and try again.</p>
	</div>
\`);

export const DestructiveConfirm = mount(
	\`<div>
		<button type="button" data-opener>Remove member</button>
		<div role="alertdialog" aria-label="Delete member permanently" style="max-width:100%;box-sizing:border-box;padding:8px;">
			<p>This permanently deletes the member record.</p>
			<button type="button" data-cancel>Cancel</button>
			<button type="button" data-confirm>Delete permanently</button>
		</div>
	</div>\`,
	(el) => {
		const opener = el.querySelector('[data-opener]');
		const dialog = el.querySelector('[role="alertdialog"]');
		const cancel = el.querySelector('[data-cancel]');
		cancel?.focus();
		el.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				dialog?.setAttribute('hidden', '');
				opener?.focus();
			}
		});
	}
);

export const ErrorRecovery = mount(\`
	<div role="alert" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<p>Validation failed. Check required fields and retry.</p>
		<button type="button">Retry</button>
	</div>
\`);

export const EvidenceAndSources = mount(\`
	<section role="region" aria-label="Sources and reasoning" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<p>Matched against team coding conventions.</p>
		<a href="#guidelines">Team guidelines</a>
	</section>
\`);

export const ProgressAndPlan = mount(\`
	<div role="status" aria-label="Import progress: step 2 of 3" style="max-width:100%;box-sizing:border-box;padding:8px;">
		Step 2 of 3: Importing books...
	</div>
\`);

export const UndoOffer = mount(\`
	<div role="status" aria-label="Order created" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<span>Order created.</span>
		<button type="button">Undo</button>
	</div>
\`);

export const WarningsBanner = mount(\`
	<div role="status" aria-label="Deprecation warning" style="max-width:100%;box-sizing:border-box;padding:8px;">
		<span>Legacy import format will be removed soon.</span>
		<button type="button">Dismiss</button>
	</div>
\`);
`;

const FAULT_SPECIMENS_MODULE = `
const mount = (html, afterMount) => ({
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html.trim();
		const el = wrapper.firstElementChild;
		if (afterMount) {
			requestAnimationFrame(() => afterMount(el));
		}
		return el;
	},
});

// Seeded fault: alternative button is disabled.
export const FaultAlternatives = mount(\`
	<section role="region" aria-label="Alternatives and confidence">
		<button type="button" disabled>Use Completed status</button>
	</section>
\`);

// Seeded fault: focuses Approve instead of Decline.
export const FaultApproval = mount(
	\`<div role="alertdialog" aria-label="Approval required">
		<button type="button" data-decline>Decline</button>
		<button type="button" data-approve>Approve</button>
	</div>\`,
	(el) => el.querySelector('[data-approve]')?.focus()
);

// Seeded fault: retry button is disabled.
export const FaultBatch = mount(\`
	<div>
		<div role="status" aria-label="Batch import: 1 succeeded, 1 failed">1 succeeded, 1 failed</div>
		<button type="button" disabled>Retry failed item</button>
	</div>
\`);

// Seeded fault: empty state misuses role="alert" instead of a non-alert role.
export const FaultCollectionEmpty = mount(\`
	<div role="alert" aria-label="Nothing here yet">Nothing here yet.</div>
\`);

// Seeded fault: focuses destructive Delete button instead of Cancel.
export const FaultDestructive = mount(
	\`<div>
		<button type="button" data-opener>Remove member</button>
		<div role="alertdialog" aria-label="Delete member permanently">
			<button type="button" data-cancel>Cancel</button>
			<button type="button" data-confirm>Delete permanently</button>
		</div>
	</div>\`,
	(el) => el.querySelector('[data-confirm]')?.focus()
);

// Seeded fault: recovery button is disabled.
export const FaultErrorRecovery = mount(\`
	<div role="alert">
		<p>Validation failed.</p>
		<button type="button" disabled>Retry</button>
	</div>
\`);

// Seeded fault: source link is disabled button.
export const FaultEvidence = mount(\`
	<section role="region" aria-label="Sources and reasoning">
		<button type="button" disabled>Team guidelines</button>
	</section>
\`);

// Seeded fault: pending progress uses plain div with no status/progressbar role.
export const FaultProgress = mount(\`
	<div>Step 2 of 3: Importing books...</div>
\`);

// Seeded fault: undo button is disabled.
export const FaultUndo = mount(\`
	<div role="status" aria-label="Order created">
		<button type="button" disabled>Undo</button>
	</div>
\`);

// Seeded fault: dismiss button is disabled.
export const FaultWarnings = mount(\`
	<div role="status" aria-label="Deprecation warning">
		<button type="button" disabled>Dismiss</button>
	</div>
\`);
`;

describe('afd-defaults@1.0.0 portable gates in Chromium', () => {
	let root: string;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-defaults-gates-')));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('passes every portable gate across all 10 afd-defaults@1.0.0 patterns on clean implementations', async () => {
		const dir = join(root, 'clean');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'specimens.js'), CLEAN_SPECIMENS_MODULE);
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				defaults: 'afd-defaults@1.0.0',
				specimens: [
					{
						id: 'ref-alternatives',
						title: 'Defaults / Alternatives and confidence',
						module: './specimens.js',
						exportName: 'AlternativesAndConfidence',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'alternatives-and-confidence',
							setup: 'default',
						},
					},
					{
						id: 'ref-approval',
						title: 'Defaults / Approval request',
						module: './specimens.js',
						exportName: 'ApprovalRequest',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'approval-request',
							setup: 'default',
						},
					},
					{
						id: 'ref-batch',
						title: 'Defaults / Batch partial failure',
						module: './specimens.js',
						exportName: 'BatchPartialFailure',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'batch-partial-failure',
							setup: 'default',
						},
					},
					{
						id: 'ref-collection-populated',
						title: 'Defaults / Collection populated',
						module: './specimens.js',
						exportName: 'CollectionPopulated',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'collection-states',
							setup: 'populated',
						},
					},
					{
						id: 'ref-collection-empty',
						title: 'Defaults / Collection empty',
						module: './specimens.js',
						exportName: 'CollectionEmpty',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'collection-states',
							setup: 'empty',
						},
					},
					{
						id: 'ref-collection-failed',
						title: 'Defaults / Collection failed',
						module: './specimens.js',
						exportName: 'CollectionFailed',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'collection-states',
							setup: 'failed',
						},
					},
					{
						id: 'ref-destructive',
						title: 'Defaults / Destructive confirm',
						module: './specimens.js',
						exportName: 'DestructiveConfirm',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'destructive-confirm',
							setup: 'default',
						},
					},
					{
						id: 'ref-error-recovery',
						title: 'Defaults / Error recovery',
						module: './specimens.js',
						exportName: 'ErrorRecovery',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'error-recovery',
							setup: 'default',
						},
					},
					{
						id: 'ref-evidence',
						title: 'Defaults / Evidence and sources',
						module: './specimens.js',
						exportName: 'EvidenceAndSources',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'evidence-and-sources',
							setup: 'default',
						},
					},
					{
						id: 'ref-progress',
						title: 'Defaults / Progress and plan',
						module: './specimens.js',
						exportName: 'ProgressAndPlan',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'progress-and-plan',
							setup: 'default',
						},
					},
					{
						id: 'ref-undo',
						title: 'Defaults / Undo offer',
						module: './specimens.js',
						exportName: 'UndoOffer',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'undo-offer',
							setup: 'default',
						},
					},
					{
						id: 'ref-warnings',
						title: 'Defaults / Warnings banner',
						module: './specimens.js',
						exportName: 'WarningsBanner',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'warnings-banner',
							setup: 'default',
						},
					},
				],
			})
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			const validation = bench.validate();
			expect(validation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);

			const gateEntries = bench.list({ kind: 'gate', limit: 100 });
			expect(gateEntries).toHaveLength(29);

			const coveredPatterns = new Set<string>();
			for (const entry of gateEntries) {
				const result = gateRunSchema.parse(await bench.run({ id: entry.id, capture: 'none' }));
				if (entry.pattern?.pattern) coveredPatterns.add(entry.pattern.pattern);
				expect(
					result.outcome.status,
					`clean gate ${entry.id} failed: ${JSON.stringify(result.outcome.failures)}`
				).toBe('passed');
			}
			expect([...coveredPatterns].sort()).toEqual([...CANONICAL_DEFAULT_PATTERNS]);
		} finally {
			await bench.close();
		}
	}, 90_000);

	it('catches a seeded fault on every one of the 10 afd-defaults@1.0.0 patterns', async () => {
		const dir = join(root, 'faults');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'specimens.js'), FAULT_SPECIMENS_MODULE);
		const faultBindings: Array<{
			pattern: (typeof CANONICAL_DEFAULT_PATTERNS)[number];
			setup: string;
			exportName: string;
			expectedFailingGate: string;
		}> = [
			{
				pattern: 'alternatives-and-confidence',
				setup: 'default',
				exportName: 'FaultAlternatives',
				expectedFailingGate: 'alternative-operable',
			},
			{
				pattern: 'approval-request',
				setup: 'default',
				exportName: 'FaultApproval',
				expectedFailingGate: 'safe-initial-focus',
			},
			{
				pattern: 'batch-partial-failure',
				setup: 'default',
				exportName: 'FaultBatch',
				expectedFailingGate: 'failed-item-operable',
			},
			{
				pattern: 'collection-states',
				setup: 'empty',
				exportName: 'FaultCollectionEmpty',
				expectedFailingGate: 'empty-not-alert',
			},
			{
				pattern: 'destructive-confirm',
				setup: 'default',
				exportName: 'FaultDestructive',
				expectedFailingGate: 'focuses-cancel',
			},
			{
				pattern: 'error-recovery',
				setup: 'default',
				exportName: 'FaultErrorRecovery',
				expectedFailingGate: 'recovery-operable',
			},
			{
				pattern: 'evidence-and-sources',
				setup: 'default',
				exportName: 'FaultEvidence',
				expectedFailingGate: 'source-operable',
			},
			{
				pattern: 'progress-and-plan',
				setup: 'default',
				exportName: 'FaultProgress',
				expectedFailingGate: 'status-exposed',
			},
			{
				pattern: 'undo-offer',
				setup: 'default',
				exportName: 'FaultUndo',
				expectedFailingGate: 'undo-operable',
			},
			{
				pattern: 'warnings-banner',
				setup: 'default',
				exportName: 'FaultWarnings',
				expectedFailingGate: 'dismiss-operable',
			},
		];

		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				defaults: 'afd-defaults@1.0.0',
				specimens: faultBindings.map((item) => ({
					id: `fault-${item.pattern}`,
					title: `Fault / ${item.pattern}`,
					module: './specimens.js',
					exportName: item.exportName,
					patternSetup: {
						library: 'afd-defaults',
						pattern: item.pattern,
						setup: item.setup,
					},
				})),
			})
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			for (const item of faultBindings) {
				const gateId = `fault-${item.pattern}--gate--${item.expectedFailingGate}`;
				const result = gateRunSchema.parse(await bench.run({ id: gateId, capture: 'none' }));
				expect(
					result.outcome.status,
					`seeded fault for ${item.pattern} (${gateId}) unexpectedly passed`
				).toBe('failed');
				expect(result.outcome.failures.length).toBeGreaterThan(0);
				expect(
					result.outcome.failures.every((failure) => failure.kind !== 'render'),
					`seeded fault for ${item.pattern} failed during render instead of gate check: ${JSON.stringify(result.outcome.failures)}`
				).toBe(true);
			}
		} finally {
			await bench.close();
		}
	}, 90_000);
});
