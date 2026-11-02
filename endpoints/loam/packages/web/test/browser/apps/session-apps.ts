/**
 * E9's scripted session (phase 1 specification, 9.1): hello and tally opened, commands called, overlays
 * opened and dismissed, and switches. The chrome's own reads join it in the journal, as a person's
 * session has them.
 */
import type { Page } from 'playwright';
import { agentCall, kernelCall, surfacesIdle } from '../harness';

export async function runAppsSession(page: Page): Promise<void> {
	const person = async (name: string, input: unknown = {}) => {
		await kernelCall(page, name, input);
		await surfacesIdle(page);
	};
	const agent = async (name: string, input: unknown = {}) => {
		await agentCall(page, name, input);
		await surfacesIdle(page);
	};
	await person('app-open', { instance: 'hello' });
	await person('hello-greet', { name: 'Ada' });
	await agent('hello-greet', { name: 'Bot' });
	await person('app-selection-set', { instance: 'hello', id: 'Ada' });
	await person('layout-set', { inspector: { open: true } });
	await person('toast-show', { message: 'Saved', tone: 'success' });
	await person('modal-open', { title: 'Sure?', body: 'Are you?' });
	await person('app-open', { instance: 'tally' });
	await person('overlay-list');
	await person('tally-add', { by: 3 });
	await agent('tally-get');
	await person('layout-set', { panel: { height: 300 } });
	await agent('app-open', { instance: 'hello' });
	await person('hello-forget', { name: 'Bot' });
	await person('hello-list');
	await person('app-close');
	await person('layout-get');
}
