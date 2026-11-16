/**
 * P6-D1 (phase 6 specification, section 19): the same `web` build on the desktop, served by the `loam`
 * protocol from the data directory, with `--host desktop`'s policy; the layout scenario journaled and replayed;
 * a reload restored from IndexedDB; axe; the menu's palette; single instance; D52's measurement; cold start.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayKernel } from '@lushly-dev/loam-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePage } from './bundle';
import {
	binary,
	type Desktop,
	desktopDeployment,
	LOAM,
	ORIGINS,
	openDesktop,
	PHASE_0_POLICY,
	packApp,
	violations,
	watchViolations,
} from './harness';

/** The statement the Rust host's "Command palette" item evaluates (`palette_script` in `src/lib.rs`). */
const PALETTE_SCRIPT =
	process.platform === 'darwin'
		? "window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:true,bubbles:true,cancelable:true}))"
		: "window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true,cancelable:true}))";

const RESULTS = fileURLToPath(new URL('../test-results/', import.meta.url));

let desktop: Desktop;
beforeAll(async () => {
	const checklist = await packApp(join(LOAM, 'apps/checklist'));
	desktop = await openDesktop({
		deployment: desktopDeployment([
			'[apps.checklist]',
			'app = "checklist"',
			`package = ${JSON.stringify(checklist)}`,
		]),
	});
	await watchViolations(desktop.browser);
});
afterAll(async () => {
	await desktop?.close();
});

const axeSource = readFileSync(
	createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
	'utf8'
);

async function axe(): Promise<{ id: string; nodes: number }[]> {
	await desktop.browser.execute(axeSource);
	return desktop.browser.execute(async () => {
		const runner = (
			window as unknown as {
				axe: {
					run(
						context: Document,
						options: object
					): Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
				};
			}
		).axe;
		const result = await runner.run(document, {
			runOnly: {
				type: 'tag',
				values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
			},
		});
		return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.length }));
	});
}

describe('P6-D1: the same build on the desktop', () => {
	it('P6-D1: boots in the webview through the loam protocol, with the IPC sources and the sandbox frame-src in its policy and nothing else', async () => {
		const { browser } = desktop;
		expect(await browser.execute(() => location.origin)).toBe(ORIGINS.shell);
		expect(await browser.execute(() => document.documentElement.dataset.loamHost)).toBe('web');
		const policy = await browser.execute(
			() =>
				document
					.querySelector('meta[http-equiv="Content-Security-Policy"]')
					?.getAttribute('content') ?? null
		);
		expect(policy).toBe(
			PHASE_0_POLICY.replace(
				"connect-src 'self'",
				"connect-src 'self' ipc: http://ipc.localhost"
			).replace("frame-src 'none'", `frame-src ${ORIGINS.sandbox}`)
		);
		const info = await desktop.call('shell-info-get');
		expect(info.data).toMatchObject({
			host: 'desktop',
			store: 'indexeddb',
			identity: { mode: 'local' },
		});
	});

	it('P6-D1: the layout scenario is journaled and replays with no difference, and a reload restores it from IndexedDB', async () => {
		const { browser } = desktop;
		expect((await desktop.call('layout-set', { sidebar: { open: false } })).success).toBe(true);
		expect((await desktop.call('layout-set', { panel: { open: true } })).success).toBe(true);
		const before = (await desktop.call('layout-get')).data;
		const entries = await browser.execute(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return shell.journal.read();
		});
		const commands = (entries as { command: string }[]).map((entry) => entry.command);
		expect(commands).toEqual(expect.arrayContaining(['layout-set']));
		const replayed = await replayKernel(entries as never);
		expect(replayed.report.diverged).toBe(false);
		expect(replayed.layout).toMatchObject({ sidebar: { open: false }, panel: { open: true } });

		// The layout's write is debounced by 300 ms (phase 0); a reload inside it can cut the write off.
		await new Promise((resolve) => setTimeout(resolve, 800));
		await browser.refresh();
		await desktop.ready();
		expect((await desktop.call('layout-get')).data).toEqual(before);
	});

	it('P6-D1: axe finds nothing in light and dark', async () => {
		await watchViolations(desktop.browser);
		for (const theme of ['light', 'dark'] as const) {
			expect((await desktop.agentCall('appearance-set', { theme })).success).toBe(true);
			expect(await desktop.browser.execute(() => document.documentElement.dataset.loamTheme)).toBe(
				theme
			);
			// The theme's colours transition; axe reads them once every transition has ended.
			await desktop.browser.execute(() =>
				Promise.all(document.getAnimations().map((animation) => animation.finished))
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(await axe()).toEqual([]);
		}
	});

	it('P6-D1: the menu\'s "Command palette" opens the palette', async () => {
		const lib = readFileSync(
			fileURLToPath(new URL('../src-tauri/src/lib.rs', import.meta.url)),
			'utf8'
		);
		expect(lib).toContain(`"${PALETTE_SCRIPT}"`);
		await desktop.browser.execute(PALETTE_SCRIPT);
		await desktop.browser.waitUntil(
			() =>
				desktop.browser.execute(() => {
					const shell = document.querySelector('loam-shell') as unknown as {
						palette?: { isOpen?: boolean } | null;
					};
					return shell.palette?.isOpen === true;
				}),
			{ timeout: 5_000 }
		);
		await desktop.call('palette-close');
	});

	it('P6-D1: a second launch focuses the first and exits', async () => {
		const second = spawn(binary(), [], {
			env: { ...process.env, LOAM_DESKTOP_DATA_DIR: desktop.data },
			stdio: 'ignore',
		});
		const code = await new Promise<number | null>((resolve) => {
			const timer = setTimeout(() => {
				second.kill();
				resolve(-1);
			}, 20_000);
			second.once('exit', (exit) => {
				clearTimeout(timer);
				resolve(exit);
			});
		});
		expect(code).toBe(0);
		expect(await desktop.browser.getWindowHandles()).toHaveLength(1);
		expect(await desktop.browser.execute(() => document.documentElement.dataset.loamHost)).toBe(
			'web'
		);
	});

	it('P6-D1: no CSP violation in any scenario', async () => {
		expect(await violations(desktop.browser)).toEqual([]);
	});

	it("P6-D1: D52's S1 and S2 are measured and recorded, and the cold start row", async () => {
		const source = await bundlePage('d52');
		await desktop.browser.execute(source);
		const result = (await desktop.browser.execute(async () =>
			(window as unknown as { loamD52(): Promise<unknown> }).loamD52()
		)) as {
			documents: number;
			links: number;
			s1: { runs: number; listed: number; expected: number; p95Ms: number };
			s2: { writes: number; totalMs: number };
			userAgent: string;
		};
		mkdirSync(RESULTS, { recursive: true });
		const record = { platform: process.platform, coldStartMs: desktop.coldStartMs, ...result };
		writeFileSync(
			join(RESULTS, `d52-${process.platform}.json`),
			`${JSON.stringify(record, null, '\t')}\n`
		);
		process.stderr.write(
			`D52 on ${process.platform}: S1 p95 ${result.s1.p95Ms.toFixed(2)} ms over ${result.s1.runs} lists of ${result.s1.listed} records (ceiling 50); S2 ${result.s2.totalMs.toFixed(0)} ms for ${result.s2.writes} writes (ceiling 2,000); cold start ${desktop.coldStartMs.toFixed(0)} ms (ceiling 2,500); ${result.userAgent}\n`
		);
		expect(result).toMatchObject({ documents: 2_000, links: 20_000 });
		expect(result.s1.listed).toBe(result.s1.expected);
		expect(result.s1.p95Ms).toBeLessThanOrEqual(50);
		expect(result.s2.totalMs).toBeLessThanOrEqual(2_000);
		// Section 14's row is measured on the job that runs it; elsewhere it is logged.
		if (process.env.CI === 'true') expect(desktop.coldStartMs).toBeLessThanOrEqual(2_500);
	});
});
