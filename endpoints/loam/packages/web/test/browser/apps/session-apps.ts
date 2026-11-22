/**
 * E9's scripted session (phase 1 specification, 9.1): hello and tally opened, commands called, overlays
 * opened and dismissed, and switches. The chrome's own reads join it in the journal, as a person's
 * session has them.
 */
import type { Page } from 'playwright';
import { agentCall, kernelCall, surfacesIdle } from '../harness';

/**
 * The chrome's own calls join the scripted ones here: a list click, a chord, a status button, a toast's
 * timer and press, and each read they cause.
 */
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
	// The person's, since phase 5's step 3: an agent's change now asks (its 6.1), and a replay of an agent's write diverges
	// (a follow-up in the phase 5 specification), so the session's second write is the person's, checked to land.
	await person('hello-greet', { name: 'Bot' });
	const listed = (await kernelCall(page, 'hello-list')) as {
		data?: { items: Array<{ id: string }> };
	};
	if (!listed.data?.items.some((item) => item.id === 'Bot'))
		throw new Error('The second greeting did not land');
	await page.locator('loam-list violet-option').first().click();
	await surfacesIdle(page);
	await page.keyboard.press('ControlOrMeta+Shift+H');
	await surfacesIdle(page);
	await person('app-selection-set', { instance: 'hello', id: 'Ada' });
	await person('layout-set', { inspector: { open: true } });
	await person('toast-show', { message: 'Saved', tone: 'success' });
	await person('toast-show', { message: 'Quick', durationMs: 1000 });
	await page.waitForTimeout(1200);
	await surfacesIdle(page);
	await page.locator('loam-toast button.dismiss').first().click();
	await surfacesIdle(page);
	await person('toast-show', { message: 'Held', durationMs: 30000 });
	// A person's modal would refuse the switch (section 8), so hello opens this one, and the switch cancels it.
	await page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: {
				appPort(instance: string): { call(name: string, input: unknown): Promise<unknown> };
			};
		};
		await shell.kernel.appPort('hello').call('modal-open', { title: 'Sure?', body: 'Are you?' });
	});
	await surfacesIdle(page);
	await person('app-open', { instance: 'tally' });
	await person('overlay-list');
	await person('tally-add', { by: 3 });
	await page.locator('loam-status-action button').click();
	await surfacesIdle(page);
	await agent('tally-get');
	await person('layout-set', { panel: { height: 300 } });
	await agent('app-open', { instance: 'hello' });
	await person('hello-forget', { name: 'Bot' });
	await person('hello-list');
	await person('app-close');
	await person('layout-get');
}
