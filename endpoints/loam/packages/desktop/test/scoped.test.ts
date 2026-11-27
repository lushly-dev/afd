/**
 * D174, amended 2026-11-26 (#2254): the desktop app's webview keeps D34's scoped-registry polyfill where the engine has
 * no scoped registries, as WebKitGTK 2.52 on Linux does not. This fails if the polyfill stops working there: the native
 * hello app must mount in its own registry, upgraded, with nothing defined globally and no page error but #2254's
 * own, which the polyfill still raises for an element defined before it loads (#2793). On Windows
 * (WebView2) and macOS (WKWebView) the platform's registries answer, and the polyfill must not load.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Desktop, desktopDeployment, LOAM, openDesktop, packApp } from './harness';

/** #2254's error, which the polyfill still raises on the desktop until it loads before any definition (#2793). */
const KNOWN_2254 =
	/^error TypeError: Illegal constructor \(custom element class must be registered with global customElements registry to be newable\)$/;

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
		// Before any native app activates, so the polyfill cannot answer for the platform.
		const native = await browser.execute(() => {
			const held = window as unknown as { loamErrors: string[] };
			held.loamErrors = [];
			window.addEventListener('error', (event) => {
				held.loamErrors.push(`error ${event.message}`);
				// Which element threw, for #2793: logged, never compared.
				const stack = (window as unknown as { loamStacks?: string[] }).loamStacks ?? [];
				stack.push(
					String((event.error as Error | undefined)?.stack ?? `${event.filename}:${event.lineno}`)
				);
				(window as unknown as { loamStacks: string[] }).loamStacks = stack;
			});
			window.addEventListener('unhandledrejection', (event) =>
				held.loamErrors.push(`rejection ${String(event.reason)}`)
			);
			try {
				const registry = new CustomElementRegistry();
				const root = document
					.createElement('div')
					.attachShadow({ mode: 'open', customElementRegistry: registry } as ShadowRootInit);
				return (
					(root as ShadowRoot & { customElementRegistry?: unknown }).customElementRegistry ===
					registry
				);
			} catch {
				return false;
			}
		});
		const opened = await desktop.call('app-open', { instance: 'hello' });
		expect(opened.success).toBe(true);
		const read = () =>
			browser.execute(() => {
				const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main');
				const mount =
					main?.shadowRoot?.querySelector('loam-mount') ?? main?.querySelector('loam-mount');
				const element = mount?.shadowRoot?.querySelector('hello-main') ?? null;
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
					errors: (window as unknown as { loamErrors: string[] }).loamErrors,
					stacks: (window as unknown as { loamStacks?: string[] }).loamStacks ?? [],
				});
			});
		const deadline = Date.now() + 20_000;
		let seen = JSON.parse(await read());
		while (seen.upgraded !== true && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 200));
			seen = JSON.parse(await read());
		}
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
		const {
			errors,
			stacks: _stacks,
			...mounted
		} = seen as {
			errors: string[];
			stacks: string[];
		} & Record<string, unknown>;
		expect(mounted).toEqual({ upgraded: true, polyfill: !native, global: false, notice: '' });
		// Where the polyfill runs, it loads after the chrome and Violet defined their elements, so #2254's error still
		// fires for one created later (#2793). That error alone is allowed, and only there; any other fails.
		expect(errors.filter((error) => native || !KNOWN_2254.test(error))).toEqual([]);
		// As many as run 45926261829 measured, so the breakage cannot spread unseen.
		expect(errors.filter((error) => KNOWN_2254.test(error)).length).toBeLessThanOrEqual(2);
	});
});
