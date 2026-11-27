/**
 * P6-D3 (phase 6 specification, section 19): Hello's view renders through `loam-sandbox`, an origin other than
 * the shell's, with phase 1's E2 frames; the WebRTC probe of phase 1's 9.7 is run and recorded for #711.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enterFrames, leaveFrames, openView, viewDeployment } from './frames';
import { type Desktop, ORIGINS, openDesktop, violations, watchViolations } from './harness';

const RESULTS = fileURLToPath(new URL('../test-results/', import.meta.url));

let desktop: Desktop;
beforeAll(async () => {
	desktop = await openDesktop({ deployment: await viewDeployment() });
	await watchViolations(desktop.browser);
});
afterAll(async () => {
	await desktop?.close();
});

describe('P6-D3: a view on the desktop', () => {
	it('P6-D3: records what this webview reports of the two schemes and the view (diagnostic, not asserted)', async () => {
		const { browser } = desktop;
		await browser.execute(() => {
			const held = window as unknown as { loamErrors: string[] };
			held.loamErrors = [];
			window.addEventListener('error', (event) => held.loamErrors.push(`error ${event.message}`));
			window.addEventListener('unhandledrejection', (event) =>
				held.loamErrors.push(`rejection ${String(event.reason)}`)
			);
		});
		const shell = await browser.execute(() =>
			JSON.stringify({
				location: location.origin,
				parsedSandbox: new URL('loam-sandbox://localhost/sandbox/proxy.html').origin,
				// D174's support floor: whether this webview has scoped custom element registries (#2254).
				scopedRegistries: (() => {
					try {
						const registry = new CustomElementRegistry();
						const root = document
							.createElement('div')
							.attachShadow({ mode: 'open', customElementRegistry: registry } as ShadowRootInit);
						return (
							(root as ShadowRoot & { customElementRegistry?: unknown }).customElementRegistry ===
							registry
						);
					} catch (cause) {
						return `no: ${String(cause)}`;
					}
				})(),
			})
		);
		const opened = await desktop.call('app-open', { instance: 'hello' });
		await new Promise((resolve) => setTimeout(resolve, 8_000));
		const app = await desktop.call('app-get', { instance: 'hello' });
		const view = await browser.execute(() => {
			const find = (root: Document | ShadowRoot, tag: string): Element | null => {
				const found = root.querySelector(tag);
				if (found) return found;
				for (const element of root.querySelectorAll('*'))
					if (element.shadowRoot) {
						const nested = find(element.shadowRoot, tag);
						if (nested) return nested;
					}
				return null;
			};
			const frame = find(document, 'loam-view-frame') as
				| (Element & { state?: unknown; failure?: unknown })
				| null;
			const main = find(document, 'loam-main') as HTMLElement | null;
			return JSON.stringify({
				frame: frame
					? {
							state: frame.state ?? null,
							failure: frame.failure ?? null,
							src:
								(
									frame.shadowRoot?.querySelector('iframe') ?? frame.querySelector('iframe')
								)?.getAttribute('src') ?? null,
						}
					: null,
				main: main
					? {
							app: main.dataset.app ?? null,
							text: (main.shadowRoot?.textContent ?? '').trim().slice(0, 300),
						}
					: null,
				errors: (window as unknown as { loamErrors: string[] }).loamErrors,
			});
		});
		process.stderr.write(
			`P6-D3 diagnostic on ${process.platform}: shell ${shell}; open ${JSON.stringify(opened).slice(0, 300)}; app ${JSON.stringify(app.data ?? app.error).slice(0, 600)}; view ${view}\n`
		);
	});

	it("P6-D3: Hello's view renders through loam-sandbox, a different origin from the shell's, opaque inside", async () => {
		const src = new URL(await openView(desktop));
		expect(src.origin === 'null' ? `${src.protocol}//${src.host}` : src.origin).toBe(
			ORIGINS.sandbox
		);
		expect(ORIGINS.sandbox).not.toBe(ORIGINS.shell);
		expect(src.searchParams.get('host')).toBe(ORIGINS.shell);

		await enterFrames(desktop, false);
		expect(await desktop.browser.execute(() => self.origin)).toBe(ORIGINS.sandbox);
		expect(
			await desktop.browser.execute(() => document.querySelector('iframe')?.getAttribute('sandbox'))
		).toBe('allow-scripts allow-forms');
		await leaveFrames(desktop);

		await enterFrames(desktop, true);
		expect(await desktop.browser.execute(() => self.origin)).toBe('null');
		const inside = await desktop.browser.execute(() => ({
			policy: document.head.firstElementChild?.getAttribute('content') ?? '',
			text: document.body.textContent ?? '',
		}));
		expect(inside.policy).toContain("connect-src 'none'");
		expect(inside.text.length).toBeGreaterThan(0);
		await leaveFrames(desktop);
		expect(await violations(desktop.browser)).toEqual([]);
	});

	it('P6-D3: the WebRTC probe of 9.7 is run and its result recorded for #711, not asserted', async () => {
		await enterFrames(desktop, true);
		const probe = await desktop.browser.execute(async () => {
			try {
				const connection = new RTCPeerConnection();
				connection.createDataChannel('x');
				const made = await connection.createOffer();
				connection.close();
				return made.type;
			} catch (error) {
				return `refused: ${String(error)}`;
			}
		});
		await leaveFrames(desktop);
		mkdirSync(RESULTS, { recursive: true });
		writeFileSync(
			join(RESULTS, `webrtc-${process.platform}.json`),
			`${JSON.stringify({ platform: process.platform, probe }, null, '\t')}\n`
		);
		process.stderr.write(
			`WebRTC probe in a desktop view on ${process.platform}: ${probe} (#711)\n`
		);
	});
});
