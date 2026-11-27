/**
 * D174, amended 2026-11-26 (#2254): the desktop app's webview keeps D34's scoped-registry polyfill where the engine has
 * no scoped registries, as WebKitGTK 2.52 on Linux does not, and the host runs it before the page's first script
 * (#2793). This fails if it stops working there: it must be in place before the page runs, and the native hello app
 * must mount in its own registry, upgraded, with nothing defined globally and no page error. On Windows (WebView2) and
 * macOS (WKWebView) the platform's registries answer, and the polyfill must not load.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Desktop, desktopDeployment, LOAM, openDesktop, packApp } from './harness';

let desktop: Desktop;
beforeAll(async () => {
	const hello = await packApp(join(LOAM, 'apps/hello'), 'manifests/native.toml');
	desktop = await openDesktop({
		deployment: desktopDeployment([
			'[apps.hello]',
			'app = "hello"',
			`package = ${JSON.stringify(hello)}`,
			'config = { default_name = "friend" }',
		]),
	});
});
afterAll(async () => {
	await desktop?.close();
});

describe('D174: scoped registries in the desktop webview', () => {
	it('D174: mounts the native hello app in its own registry, through the polyfill on Linux and natively elsewhere', async () => {
		const { browser } = desktop;
		// Before any native app activates.
		const probe = await browser.execute(() => {
			const held = window as unknown as { loamErrors: string[]; loamStacks: string[] };
			held.loamErrors = [];
			held.loamStacks = [];
			window.addEventListener('error', (event) => {
				held.loamErrors.push(`error ${event.message}`);
				// Which element threw, should one: logged, never compared.
				held.loamStacks.push(
					String((event.error as Error | undefined)?.stack ?? `${event.filename}:${event.lineno}`)
				);
			});
			window.addEventListener('unhandledrejection', (event) =>
				held.loamErrors.push(`rejection ${String(event.reason)}`)
			);
			// The host runs the polyfill before the page's scripts where it is needed (#2793): its flag tells it apart
			// from the platform's registries.
			const atBoot =
				(globalThis as { __scopedRegistryPolyfillApplied?: boolean })
					.__scopedRegistryPolyfillApplied === true;
			let scoped = false;
			try {
				const registry = new CustomElementRegistry();
				const root = document
					.createElement('div')
					.attachShadow({ mode: 'open', customElementRegistry: registry } as ShadowRootInit);
				scoped =
					(root as ShadowRoot & { customElementRegistry?: unknown }).customElementRegistry ===
					registry;
			} catch {}
			return JSON.stringify({ native: scoped && !atBoot, atBoot });
		});
		const { native, atBoot } = JSON.parse(probe) as { native: boolean; atBoot: boolean };
		const opened = await desktop.call('app-open', { instance: 'hello' });
		expect(opened.success).toBe(true);
		const read = () =>
			browser.execute(() => {
				const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
				const mount =
					main?.shadowRoot?.querySelector('loam-mount') ?? main?.querySelector('loam-mount');
				const element = mount?.shadowRoot?.querySelector('hello-main') ?? null;
				const held = window as unknown as { loamErrors: string[]; loamStacks: string[] };
				return JSON.stringify({
					upgraded: element ? element.matches(':defined') : null,
					polyfill:
						(globalThis as { __scopedRegistryPolyfillApplied?: boolean })
							.__scopedRegistryPolyfillApplied === true,
					global: customElements.get('hello-main') !== undefined,
					notice: (
						(main?.querySelector('loam-notice') ?? main?.shadowRoot?.querySelector('loam-notice'))
							?.shadowRoot?.textContent ?? ''
					).trim(),
					errors: held.loamErrors,
					stacks: held.loamStacks,
				});
			});
		const deadline = Date.now() + 20_000;
		let seen = JSON.parse(await read());
		while (seen.upgraded !== true && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 200));
			seen = JSON.parse(await read());
		}
		// The surfaces read the app's status items and selection just after the mount, where #2254's errors fired:
		// a moment longer, so they are read too.
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		seen = JSON.parse(await read());
		// Which path ran, by platform, is in the log: D174 and phase 1's 9.7 read it.
		process.stderr.write(
			`D174 on ${process.platform}: scoped registries ${native ? 'native' : 'by the polyfill'}; ${JSON.stringify(seen)}\n`
		);
		expect(
			native,
			native
				? 'WebKitGTK now has scoped registries: retire the desktop polyfill (D174) and update this test'
				: 'this webview has no scoped registries'
		).toBe(process.platform !== 'linux');
		// Where the polyfill runs it was in place before the page's first script, so nothing the chrome or Violet
		// defined throws #2254's error when it is created later (#2793).
		expect(atBoot).toBe(!native);
		const {
			errors,
			stacks: _stacks,
			...mounted
		} = seen as {
			errors: string[];
			stacks: string[];
		} & Record<string, unknown>;
		expect(mounted).toEqual({ upgraded: true, polyfill: !native, global: false, notice: '' });
		expect(errors).toEqual([]);
	});
});
