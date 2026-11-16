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
	it('P6-D3: records the origins this webview reports for the two schemes (diagnostic, not asserted)', async () => {
		const shell = await desktop.browser.execute(() => ({
			location: location.origin,
			self: self.origin,
			parsedShell: new URL(location.href).origin,
			parsedSandbox: new URL('loam-sandbox://localhost/sandbox/proxy.html').origin,
			parsedHttpSandbox: new URL('http://loam-sandbox.localhost/').origin,
		}));
		await desktop.call('app-open', { instance: 'hello' });
		await new Promise((resolve) => setTimeout(resolve, 3_000));
		const instances = await desktop.call('app-instance-list');
		const frame = await desktop.browser.execute(() => {
			const find = (root: Document | ShadowRoot): Element | null => {
				const view = root.querySelector('loam-view-frame');
				if (view) return view;
				for (const element of root.querySelectorAll('*'))
					if (element.shadowRoot) {
						const nested = find(element.shadowRoot);
						if (nested) return nested;
					}
				return null;
			};
			const view = find(document);
			const iframe = view?.shadowRoot?.querySelector('iframe') ?? view?.querySelector('iframe');
			return {
				state: view?.getAttribute('state') ?? null,
				error: view?.shadowRoot?.textContent?.slice(0, 300) ?? null,
				src: iframe?.getAttribute('src') ?? null,
			};
		});
		process.stderr.write(
			`P6-D3 origins on ${process.platform}: ${JSON.stringify({ shell, frame, instances: instances.data })}\n`
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
