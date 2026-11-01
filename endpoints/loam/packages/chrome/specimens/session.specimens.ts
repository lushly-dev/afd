/**
 * E2's two modules (phase 0 specification, section 11): the chrome at a fixed viewport over a
 * kernel that ran `SESSION_50` live, and over a kernel that replayed the committed journal
 * fixture. Their observations must be equal under `diffObservations`.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import { replayKernel, SESSION_50 } from '@lushly-dev/loam-kernel/testing';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import journalText from './fixtures/session-50.journal.json?raw';
import { fixedKernel, shellFixture } from './support.js';

export const SessionLive = {
	render: () =>
		shellFixture(async () => {
			const { kernel } = await fixedKernel();
			// recordSession and replayKernel both end with these two reads, which are journaled.
			return {
				kernel,
				calls: [
					...SESSION_50,
					{ interface: 'palette', name: 'layout-get' },
					{ interface: 'palette', name: 'appearance-get' },
				],
			};
		}),
} satisfies SpecimenDefinition;

export const SessionReplay = {
	render: () =>
		shellFixture(async () => {
			const { kernel } = await replayKernel(JSON.parse(journalText) as JournalEntry[], {
				keep: true,
			});
			if (!kernel) throw new Error('replayKernel kept no kernel');
			return { kernel };
		}),
} satisfies SpecimenDefinition;
