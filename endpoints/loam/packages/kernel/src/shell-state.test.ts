import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { describe, expect, it } from 'vitest';
import { LoamKernelError } from './errors.js';
import { createDefaultLayout } from './layout.js';
import { registerShellState } from './shell-state.js';

describe('the loam.layout and loam.appearance handlers', () => {
	it('refuse an invalid set or replace through the registry itself', () => {
		const viewState = new ViewStateRegistry();
		const state = registerShellState(viewState);
		expect(() => viewState.set('loam.layout', { sidebar: { width: 1 } })).toThrow(LoamKernelError);
		expect(() => viewState.replace('loam.layout', { version: 0 })).toThrow(
			/A complete layout state needs sidebar\.open/
		);
		expect(() => viewState.set('loam.appearance', { theme: 'sepia' })).toThrow(LoamKernelError);
		expect(() => viewState.replace('loam.appearance', { theme: 'dark' })).toThrow(
			/A complete appearance needs density/
		);
		expect(state.layout()).toEqual(createDefaultLayout());
		expect(state.appearance()).toEqual({ theme: 'system', density: 'comfortable' });
	});

	it('apply a valid replace', () => {
		const viewState = new ViewStateRegistry();
		const state = registerShellState(viewState);
		viewState.replace('loam.appearance', { theme: 'dark', density: 'compact' });
		expect(state.appearance()).toEqual({ theme: 'dark', density: 'compact' });
		const thrown = (() => {
			try {
				viewState.set('loam.layout', { panel: { height: 2 } });
			} catch (error) {
				return error as LoamKernelError;
			}
		})();
		expect(thrown).toMatchObject({
			code: 'VALIDATION_ERROR',
			retryable: false,
			details: { field: 'panel.height' },
		});
	});

	it('hydrate without a store adapter', async () => {
		const viewState = new ViewStateRegistry();
		const state = registerShellState(viewState);
		await state.hydrate();
		expect(state.layout()).toEqual(createDefaultLayout());
	});
});
