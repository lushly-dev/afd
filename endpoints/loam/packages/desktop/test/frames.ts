/** Hello's view on the desktop, and its two frames: the `loam-sandbox` proxy and the opaque view inside it. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Desktop } from './harness';
import { desktopDeployment, LOAM, packApp } from './harness';

/** A deployment with hello as a view app (phase 1's E2 subject), and `more` tables after it. */
export async function viewDeployment(more: string[] = []): Promise<string> {
	const hello = await packApp(join(LOAM, 'apps/hello'), 'manifests/view.toml');
	return desktopDeployment([
		'[apps.hello]',
		'app = "hello"',
		`package = ${JSON.stringify(hello)}`,
		'',
		...more,
	]);
}

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

/** The `stdio` AFD fixture's table (`fixtures/notify-server.ts`), as instance `fixture`. */
export async function fixtureTable(): Promise<string[]> {
	const fixture = await packApp(fileURLToPath(new URL('./fixtures/apps/fixture', import.meta.url)));
	const server = fileURLToPath(new URL('./fixtures/notify-server.ts', import.meta.url));
	return [
		'[apps.fixture]',
		'app = "fixture"',
		`package = ${JSON.stringify(fixture)}`,
		'transport = "stdio"',
		`command = [${JSON.stringify(process.execPath)}, ${JSON.stringify(server)}]`,
		`cwd = ${JSON.stringify(PACKAGE)}`,
		'audience = "person"',
	];
}

/**
 * Script text that finds the view frame's `<iframe>` through every shadow root, `loam-view-frame`'s own
 * included. Text, since WebDriver sends a function's source alone, without what it closes over.
 */
const FIND_VIEW = `
	const find = (root) => {
		const frame = root.querySelector('loam-view-frame');
		const inside = frame?.shadowRoot?.querySelector('iframe') ?? frame?.querySelector('iframe');
		if (inside) return inside;
		for (const element of root.querySelectorAll('*'))
			if (element.shadowRoot) {
				const nested = find(element.shadowRoot);
				if (nested) return nested;
			}
		return null;
	};`;

/** Opens hello and waits for its view frame; answers the frame's `src`. */
export async function openView(desktop: Desktop): Promise<string> {
	const { browser } = desktop;
	await desktop.call('app-open', { instance: 'hello' });
	const src = () =>
		browser.execute(`${FIND_VIEW} return find(document)?.getAttribute('src') ?? null;`) as Promise<
			string | null
		>;
	await browser.waitUntil(async () => (await src()) !== null, { timeout: 20_000 });
	return (await src()) as string;
}

/** Switches WebDriver into the proxy frame, then, with `inner`, into the view's. Back with `leaveFrames`. */
export async function enterFrames(desktop: Desktop, inner: boolean): Promise<void> {
	const { browser } = desktop;
	const outer = await browser.execute(`${FIND_VIEW} return find(document);`);
	await browser.switchFrame(outer as never);
	if (!inner) return;
	await browser.waitUntil(() => browser.execute(() => document.querySelector('iframe') !== null), {
		timeout: 10_000,
	});
	await browser.switchFrame(await browser.$('iframe'));
}

export async function leaveFrames(desktop: Desktop): Promise<void> {
	await desktop.browser.switchFrame(null);
}
