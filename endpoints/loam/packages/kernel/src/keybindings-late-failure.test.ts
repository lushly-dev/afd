/**
 * Phase 4's step 7, the coordinator's R9: with the `late-settings` chunk failing to load, no person's overrides can be
 * read, and the shell is never left without its chords (D66): the reserved chords dispatch, with no overrides.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { SHELL_KEYBINDINGS_V0 } from './keybindings.js';
import { createFixedEnvironment } from './testing.js';

vi.mock('./late/settings.js', () => {
	throw new Error('The settings chunk did not load');
});

describe('the keybindings with the late load failed (R9)', () => {
	const reported = vi.fn();
	beforeEach(() => vi.stubGlobal('reportError', reported));
	afterEach(() => {
		vi.unstubAllGlobals();
		reported.mockClear();
	});

	it('dispatches the reserved chords with no overrides, never only the focus chords', async () => {
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		expect(await kernel.call('project-list', {})).toMatchObject({
			error: { code: 'LATE_COMMANDS_UNAVAILABLE' },
		});
		expect(kernel.listKeybindings().map(({ chord }) => chord)).toEqual(
			SHELL_KEYBINDINGS_V0.map(({ chord }) => chord)
		);
		await kernel.dispose();
	});
});
