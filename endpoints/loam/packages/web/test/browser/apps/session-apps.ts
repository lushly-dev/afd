/**
 * E9's scripted session (phase 1 specification, 9.1): hello and tally opened, commands called, overlays
 * opened and dismissed, and switches. The chrome's own reads join it in the journal, as a person's
 * session has them.
 */
import type { Page } from 'playwright';
import { agentCall, kernelCall, surfacesIdle } from '../harness';

/**
 * The chrome's own calls join the scripted ones here: a list click, a chord, a status button, a toast's
 * timer and press, and each read they cause. The second write is an agent's (#1936): with `agents: 'ask'` it asks and
 * the person confirms it in the inbox, so the shell runs it (phase 4's 7.2); under the person's `act` row it runs.
 */
export async function runAppsSession(page: Page, agents: 'ask' | 'act' = 'ask'): Promise<void> {
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
	const greeted = (await agentCall(page, 'hello-greet', { name: 'Bot' })) as {
		error?: { code: string; details?: { notification?: string } };
	};
	await surfacesIdle(page);
	if (agents === 'ask') {
		const notification = greeted.error?.details?.notification;
		if (greeted.error?.code !== 'CONFIRMATION_PENDING' || notification === undefined)
			throw new Error(`The agent's greeting did not ask: ${JSON.stringify(greeted)}`);
		await person('notification-act', { notification, answer: 'confirm' });
	}
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
