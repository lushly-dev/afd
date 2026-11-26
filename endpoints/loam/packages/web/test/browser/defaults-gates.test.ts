/**
 * Verifies Agent-First Design Phase B1 (`afd-defaults@1.0.0`, #2558) portable gates against
 * Loam's real custom elements (`loam-list`, `loam-modal`, `loam-notice`, `loam-toast`, and
 * `loam-view-frame`) in Chromium via Specimen.
 */
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpecimenBench } from '@lushly-dev/specimen';
import { gateRunSchema } from '@lushly-dev/specimen/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME_APPS = JSON.stringify(
	fileURLToPath(new URL('../../../chrome/dist/apps/index.js', import.meta.url))
);
const CHROME_MODAL = JSON.stringify(
	fileURLToPath(new URL('../../../chrome/dist/elements/modal.js', import.meta.url))
);
const CHROME_VIEW = JSON.stringify(
	fileURLToPath(new URL('../../../chrome/dist/view/view.js', import.meta.url))
);
const CHROME_SUPPORT = JSON.stringify(
	fileURLToPath(new URL('../../../chrome/specimens/support.ts', import.meta.url))
);
const CHROME_APPS_SPECIMENS = JSON.stringify(
	fileURLToPath(new URL('../../../chrome/specimens/apps.specimens.ts', import.meta.url))
);

const LOAM_DEFAULTS_MODULE = `
import { defineAppElements } from ${CHROME_APPS};
import { bindAnswer } from ${CHROME_MODAL};
import { defineViewFrame } from ${CHROME_VIEW};
import { themePart } from ${CHROME_SUPPORT};
import { List, ListEmpty, ListFailed } from ${CHROME_APPS_SPECIMENS};

export { List as LoamListPopulated, ListEmpty as LoamListEmpty, ListFailed as LoamListFailed };

export const LoamViewFrameLoading = {
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.style.setProperty('inline-size', '100%');
		wrapper.style.setProperty('max-inline-size', '100%');
		wrapper.style.setProperty('block-size', '240px');
		return {
			element: wrapper,
			ready: (async () => {
				await themePart('comfortable');
				await defineAppElements();
				await defineViewFrame();
				const frame = document.createElement('loam-view-frame');
				frame.heading = 'Hello';
				wrapper.append(frame);
				await new Promise((r) => requestAnimationFrame(() => r()));
				await new Promise((r) => requestAnimationFrame(() => r()));
			})(),
		};
	},
};

export const LoamToastWarning = {
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.style.setProperty('inline-size', '360px');
		return {
			element: wrapper,
			ready: (async () => {
				await themePart('comfortable');
				await defineAppElements();
				const region = document.createElement('loam-toast-region');
				const item = document.createElement('loam-toast');
				item.setAttribute('tone', 'warning');
				item.setAttribute('message', 'Legacy format will be removed soon.');
				item.setAttribute('overlay-id', 'ovl-warn-1');
				region.append(item);
				wrapper.append(region);
				await new Promise((r) => requestAnimationFrame(() => r()));
				await new Promise((r) => requestAnimationFrame(() => r()));
			})(),
		};
	},
};

export const LoamNoticeErrorRecovery = {
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.style.setProperty('max-inline-size', '100%');
		wrapper.style.setProperty('box-sizing', 'border-box');
		return {
			element: wrapper,
			ready: (async () => {
				await themePart('comfortable');
				await defineAppElements();
				const notice = document.createElement('loam-notice');
				notice.toggleAttribute('embedded', true);
				notice.setAttribute('heading', 'Could not save order');
				notice.setAttribute('message', 'Validation failed on required fields.');
				notice.setAttribute('suggestion', 'Check the required fields and retry.');
				const retry = document.createElement('button');
				retry.type = 'button';
				retry.textContent = 'Retry';
				wrapper.append(notice, retry);
				await new Promise((r) => requestAnimationFrame(() => r()));
				await new Promise((r) => requestAnimationFrame(() => r()));
			})(),
		};
	},
};

export const LoamModalDestructive = {
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.style.setProperty('inline-size', '640px');
		wrapper.style.setProperty('block-size', '360px');
		return {
			element: wrapper,
			ready: (async () => {
				await themePart('comfortable');
				await defineAppElements();
				const opener = document.createElement('button');
				opener.type = 'button';
				opener.textContent = 'Remove member';
				const modal = document.createElement('loam-modal');
				wrapper.append(opener, modal);
				opener.focus();
				await modal.show(
					'ovl-del-1',
					{
						title: 'Delete member permanently?',
						body: 'This permanently deletes the member record.',
						confirmLabel: 'Delete permanently',
						danger: true,
					},
					{ kind: 'dialog' }
				);
				bindAnswer(modal, (_id, result) => {
					if (result === 'cancel') modal.hide();
				});
				modal.buttons.querySelector('[data-answer="cancel"]')?.focus();
				await new Promise((r) => requestAnimationFrame(() => r()));
				await new Promise((r) => requestAnimationFrame(() => r()));
			})(),
		};
	},
};

export const LoamModalApproval = {
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.style.setProperty('inline-size', '640px');
		wrapper.style.setProperty('block-size', '360px');
		return {
			element: wrapper,
			ready: (async () => {
				await themePart('comfortable');
				await defineAppElements();
				const modal = document.createElement('loam-modal');
				wrapper.append(modal);
				await modal.show(
					'ovl-app-1',
					{
						title: 'Approval required',
						body: 'Allow this agent to deploy to production?',
						cancelLabel: 'Decline',
						confirmLabel: 'Approve',
					},
					{ kind: 'dialog', asks: 'confirmation' }
				);
				modal.buttons.querySelector('[data-answer="cancel"]')?.focus();
				await new Promise((r) => requestAnimationFrame(() => r()));
				await new Promise((r) => requestAnimationFrame(() => r()));
			})(),
		};
	},
};
`;

describe('afd-defaults@1.0.0 portable gates on Loam elements', () => {
	let root: string;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'loam-defaults-gates-')));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('passes portable afd-defaults@1.0.0 gates on real loam-list, loam-modal, loam-notice, loam-toast, and loam-view-frame elements', async () => {
		await writeFile(join(root, 'loam-defaults.specimens.ts'), LOAM_DEFAULTS_MODULE);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				defaults: 'afd-defaults@1.0.0',
				specimens: [
					{
						id: 'loam-list-populated',
						title: 'Loam / List populated',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamListPopulated',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'collection-states',
							setup: 'populated',
						},
					},
					{
						id: 'loam-list-empty',
						title: 'Loam / List empty',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamListEmpty',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'collection-states',
							setup: 'empty',
						},
					},
					{
						id: 'loam-list-failed',
						title: 'Loam / List failed',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamListFailed',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'collection-states',
							setup: 'failed',
						},
					},
					{
						id: 'loam-view-frame-loading',
						title: 'Loam / ViewFrame loading',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamViewFrameLoading',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'progress-and-plan',
							setup: 'default',
						},
					},
					{
						id: 'loam-toast-warning',
						title: 'Loam / Toast warning',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamToastWarning',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'warnings-banner',
							setup: 'default',
						},
					},
					{
						id: 'loam-notice-error',
						title: 'Loam / Notice error recovery',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamNoticeErrorRecovery',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'error-recovery',
							setup: 'default',
						},
					},
					{
						id: 'loam-modal-destructive',
						title: 'Loam / Modal destructive confirm',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamModalDestructive',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'destructive-confirm',
							setup: 'default',
						},
					},
					{
						id: 'loam-modal-approval',
						title: 'Loam / Modal approval request',
						module: './loam-defaults.specimens.ts',
						exportName: 'LoamModalApproval',
						patternSetup: {
							library: 'afd-defaults',
							pattern: 'approval-request',
							setup: 'default',
						},
					},
				],
			})
		);

		const bench = await createSpecimenBench({ root });
		try {
			const validation = bench.validate();
			expect(validation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);

			const gates = bench.list({ kind: 'gate', limit: 100 });
			expect(gates.length).toBeGreaterThanOrEqual(14);

			const verifiedPatterns = new Set<string>();
			for (const entry of gates) {
				const run = gateRunSchema.parse(await bench.run({ id: entry.id, capture: 'none' }));
				if (entry.pattern?.pattern) verifiedPatterns.add(entry.pattern.pattern);
				expect(
					run.outcome.status,
					`Loam gate ${entry.id} failed: ${JSON.stringify(run.outcome.failures)}`
				).toBe('passed');
			}
			expect([...verifiedPatterns].sort()).toEqual([
				'approval-request',
				'collection-states',
				'destructive-confirm',
				'error-recovery',
				'progress-and-plan',
				'warnings-banner',
			]);
		} finally {
			await bench.close();
		}
	}, 90_000);
});
