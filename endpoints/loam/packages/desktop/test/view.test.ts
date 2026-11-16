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
