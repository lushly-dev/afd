/**
 * Phase 4's I8 (#706) on the desktop (#2314): the project switcher's chord, `Mod+Alt+P` (phase 4 specification, 8.4,
 * #857), pressed through WebDriver, reaches the desktop webview's page and opens the switcher. Loam's Linux desktop
 * runs on WebKitGTK, whose Playwright build is below the browser support floor and out of `loam.yml` (D174), so this is
 * where the GTK port's chord is tested. On Windows it runs in WebView2. What the page received is logged, so a failure
 * says whether the key reached it and as what.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Key } from 'webdriverio';
import { type Desktop, openDesktop } from './harness';

// `Key.Control`, not `Key.Ctrl`, which webdriverio sends as Command on macOS; `Mod` is Control where this suite runs.
const { Control: CONTROL, Alt: ALT, Escape: ESCAPE } = Key;

let desktop: Desktop;
beforeAll(async () => {
	desktop = await openDesktop();
});
afterAll(async () => {
	await desktop?.close();
});

describe("I8: the project switcher's chord on the desktop", () => {
	it('I8: Mod+Alt+P reaches the desktop page and opens the project switcher (8.4, #857, #2314)', async () => {
		const { browser } = desktop;
		const state = async () =>
			JSON.parse(
				await browser.execute(() => {
					// The rail's switcher, or the tab bar's in a narrow window: whichever is shown, as the chord picks.
					const shell = document.querySelector('loam-shell');
					const button = ['rail', 'tabbar']
						.map((variant) => shell?.shadowRoot?.querySelector<HTMLElement>(`loam-${variant}`))
						.filter((nav) => nav && !nav.closest('[hidden]'))
						.map((nav) => nav?.shadowRoot?.querySelector('loam-project-switcher'))
						.find((switcher) => switcher?.checkVisibility())
						?.shadowRoot?.querySelector('button');
					const held = window as unknown as { loamKeys?: unknown[]; loamErrors?: string[] };
					return JSON.stringify({
						expanded: button?.getAttribute('aria-expanded') ?? null,
						keys: held.loamKeys ?? [],
						errors: held.loamErrors ?? [],
					});
				})
			) as { expanded: string | null; keys: unknown[]; errors: string[] };
		// The shell's keybindings resolved, as the browser case waits for (#2323), and every key the page receives
		// recorded.
		const settled = () =>
			browser.execute(() => {
				// No app is deployed, so there are no app surfaces to wait for.
				const shell = document.querySelector('loam-shell') as unknown as {
					urlBooted?: boolean;
					kernel?: { listKeybindings(): Array<{ chord: string }> };
				} | null;
				return JSON.stringify({
					urlBooted: shell?.urlBooted === true,
					chord:
						shell?.kernel?.listKeybindings().some((binding) => binding.chord === 'Mod+Alt+P') ===
						true,
				});
			});
		let ready = JSON.parse(await settled()) as Record<string, boolean>;
		const settledBy = Date.now() + 30_000;
		while (!Object.values(ready).every(Boolean) && Date.now() < settledBy) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			ready = JSON.parse(await settled());
		}
		expect(ready, 'the shell settled before the press').toEqual({
			urlBooted: true,
			chord: true,
		});
		await browser.execute(() => {
			const held = window as unknown as { loamKeys: unknown[]; loamErrors: string[] };
			held.loamKeys = [];
			held.loamErrors = [];
			window.addEventListener(
				'keydown',
				(event) =>
					held.loamKeys.push({
						key: event.key,
						code: event.code,
						ctrl: event.ctrlKey,
						alt: event.altKey,
						shift: event.shiftKey,
						meta: event.metaKey,
						trusted: event.isTrusted,
						altGraph: event.getModifierState('AltGraph'),
					}),
				true
			);
			window.addEventListener('error', (event) => held.loamErrors.push(`error ${event.message}`));
			window.addEventListener('unhandledrejection', (event) =>
				held.loamErrors.push(`rejection ${String(event.reason)}`)
			);
		});
		expect((await state()).expanded).toBe('false');

		await browser
			.action('key')
			.down(CONTROL)
			.down(ALT)
			.down('p')
			.up('p')
			.up(ALT)
			.up(CONTROL)
			.perform();
		// The first press loads the switcher's chunk and Violet's listbox and popover.
		let seen = await state();
		const deadline = Date.now() + 10_000;
		while (seen.expanded !== 'true' && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			seen = await state();
		}
		process.stderr.write(`I8 on ${process.platform}: ${JSON.stringify(seen)}\n`);
		expect(seen.expanded, `the page received ${JSON.stringify(seen.keys)}`).toBe('true');

		await browser.action('key').down(ESCAPE).up(ESCAPE).perform();
		let closed = await state();
		const closedBy = Date.now() + 10_000;
		while (closed.expanded !== 'false' && Date.now() < closedBy) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			closed = await state();
		}
		expect(
			closed.expanded,
			`Escape left it open; the page received ${JSON.stringify(closed.keys)}`
		).toBe('false');
		expect(closed.errors).toEqual([]);
	});
});
