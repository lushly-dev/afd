/**
 * A Mini schema with no locale says what classic's English would, for every schema of a command that
 * takes input, so nothing on the page changes when classic loads (phase 2 specification, 2.3).
 * `auth-sign-in`'s email is the one exception 2.3 names: a format keeps its own name until a locale loads.
 */
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { createDirectRegistry } from '@lushly-dev/afd-server/direct';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from 'zod/v4/core';
import en from 'zod/v4/locales/en.js';
import { EMPTY_APPS } from '../apps-runtime.js';
import { createBootCommands } from '../boot-commands.js';
import { createScopeRuntime } from '../scope/runtime.js';
import { registerShellState } from '../shell-state.js';
import { createLateParts, createOverlayStore } from './index.js';

const FORMAT_EXCEPTIONS = [
	{ name: 'auth-sign-in', input: { method: 'credentials', email: 'nope' } },
];

const INPUTS: Array<{ name: string; input: unknown }> = [
	{ name: 'layout-get', input: { extra: 1 } },
	{ name: 'layout-set', input: { sidebar: { width: 'wide' } } },
	{ name: 'layout-set', input: { sidebar: { open: 1 } } },
	{ name: 'layout-set', input: { panel: { maximized: 'yes' } } },
	{ name: 'layout-set', input: { compact: { drawer: 'panel' } } },
	{ name: 'layout-set', input: { rail: {} } },
	{ name: 'appearance-set', input: { theme: 'neon' } },
	{ name: 'appearance-set', input: { density: 1 } },
	{ name: 'palette-open', input: { query: 1 } },
	{ name: 'palette-search', input: {} },
	{ name: 'palette-search', input: { query: 'a', limit: 1.5 } },
	{ name: 'palette-search', input: { query: 'a', limit: 0 } },
	{ name: 'palette-search', input: { query: 'a', limit: 99 } },
	{ name: 'palette-search', input: { query: 'a', limit: 'many' } },
	{ name: 'app-get', input: {} },
	{ name: 'app-get', input: { instance: '' } },
	{ name: 'app-get', input: { instance: 'x'.repeat(65) } },
	{ name: 'app-get', input: { instance: 'a', extra: true } },
	{ name: 'app-selection-set', input: { instance: 'a' } },
	{ name: 'app-selection-set', input: { instance: 'a', id: 'x'.repeat(257) } },
	{ name: 'status-item-set', input: { id: '', value: 'x'.repeat(41) } },
	{ name: 'toast-show', input: { message: '' } },
	{ name: 'toast-show', input: { message: 'x'.repeat(201) } },
	{ name: 'toast-show', input: { message: 'a', tone: 'loud' } },
	{ name: 'toast-show', input: { message: 'a', durationMs: 1.5 } },
	{ name: 'toast-show', input: { message: 'a', durationMs: 10 } },
	{ name: 'toast-show', input: { message: 'a', durationMs: 60000 } },
	{ name: 'modal-open', input: {} },
	{ name: 'modal-open', input: { title: '', body: 'a', danger: 'yes' } },
	{ name: 'overlay-dismiss', input: { overlayId: 'a', result: 'maybe' } },
	{ name: 'overlay-dismiss', input: { overlayId: 'a', reason: 'gone' } },
	{ name: 'view-state-get', input: {} },
	{ name: 'view-state-set', input: { id: 'a', state: 1 } },
	{ name: 'view-state-set', input: { id: 'a', state: {}, replace: 'yes' } },
	{ name: 'auth-sign-in', input: { method: 'magic' } },
	{ name: 'auth-sign-in', input: { method: 'credentials' } },
	{ name: 'auth-sign-in', input: { method: 'oauth', provider: 1 } },
	{ name: 'auth-sign-in', input: { method: 'oauth', provider: 'a', scopes: 'all' } },
];

function registry() {
	const viewState = new ViewStateRegistry();
	const state = registerShellState(viewState);
	const auth = new MockAuthAdapter();
	const environment = { matches: () => false, onChange: () => () => {} };
	const apps = () => EMPTY_APPS;
	const scope = createScopeRuntime({ id: 'personal', name: 'Personal' });
	return createDirectRegistry(
		createLateParts(
			createBootCommands({ state, environment, auth, apps, scope, summaries: () => [] }),
			{
				viewState,
				state,
				environment,
				auth,
				host: 'test',
				storeKind: 'memory',
				overlays: createOverlayStore(),
				apps,
				paletteRows: () => [],
				commandSet: () => 0,
				scope,
				store: new MemoryAdapter(),
				generation: () => 'test',
				isMutation: () => false,
			}
		).shell
	);
}

async function refusals(cases: Array<{ name: string; input: unknown }>) {
	const commands = registry();
	return Promise.all(
		cases.map(async ({ name, input }) => {
			const result = await commands.execute(name, input);
			expect(result.success, `${name} ${JSON.stringify(input)}`).toBe(false);
			return { name, input, error: result.error };
		})
	);
}

describe('the shell commands with no Zod locale', () => {
	afterAll(() => {
		config({ localeError: undefined });
	});

	it('refuse in the words of Zod English, but for the one format 2.3 names', async () => {
		// Under Node the whole `/direct` entry loads, with no tree-shaking, and classic registers English.
		config({ localeError: undefined });
		const bare = await refusals(INPUTS);
		const formats = await refusals(FORMAT_EXCEPTIONS);
		config(en());
		expect(bare).toEqual(await refusals(INPUTS));
		const english = await refusals(FORMAT_EXCEPTIONS);
		expect(formats[0]?.error).toBeDefined();
		const texts = [JSON.stringify(formats[0]?.error), JSON.stringify(english[0]?.error)];
		expect(texts[0]).toContain('Invalid email');
		expect(texts[0]).not.toContain('Invalid email address');
		expect(texts[1]).toContain('Invalid email address');
	});
});
