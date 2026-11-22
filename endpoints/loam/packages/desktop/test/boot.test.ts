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
const PALETTE_SCRIPT = "document.querySelector('loam-shell')?.openPalette()";

const RESULTS = fileURLToPath(new URL('../test-results/', import.meta.url));
/** Cold starts per run, each with its own empty data directory and fresh webview profile (#1396). */
const COLD_STARTS = 3;

let desktop: Desktop;
/** The start in flight, which `afterAll` closes if `beforeAll` throws mid-loop. */
let starting: Desktop | undefined;
let coldStartMs = 0;
const coldStarts: number[] = [];

beforeAll(async () => {
	const checklist = await packApp(join(LOAM, 'apps/checklist'));
	const deployment = desktopDeployment([
		'[apps.checklist]',
		'app = "checklist"',
		`package = ${JSON.stringify(checklist)}`,
	]);
	// Section 14's cold-start row (#1396): the median of `COLD_STARTS` cold starts, each from its own
	// empty data directory and fresh webview profile, so the first-launch OS/antivirus PE scan of a
	// newly linked binary (2.7–3.4 s before `main()` on Windows) does not fail a single-sample run,
	// as P6-H1 does for `loam-host dev` (#1062). Every sample is logged; the last instance is kept.
	for (let run = 1; run <= COLD_STARTS; run += 1) {
		starting = await openDesktop({ deployment });
		coldStarts.push(starting.coldStartMs);
		if (run < COLD_STARTS) await starting.close();
		else desktop = starting;
		starting = undefined;
	}
	coldStartMs = [...coldStarts].sort((a, b) => a - b)[Math.floor(COLD_STARTS / 2)] as number;
	// Match Vitest's `testTimeout` (120 s) so `loamD52()` (22k records + 200 S1 lists + 1,000 S2
	// commits) does not hit WebDriver's 30 s default `script` timeout on slow hosted Linux runners.
	await desktop.browser.setTimeout({ script: 120_000 });
	await watchViolations(desktop.browser);
});
afterAll(async () => {
	if (starting && starting !== desktop) await starting.close();
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
			// The person's: an agent's write of the appearance asks first (phase 5's 6.1), and this is about axe in a theme.
			expect((await desktop.call('appearance-set', { theme })).success).toBe(true);
			// The shell applies the theme in its next frame.
			await desktop.browser.waitUntil(
				async () =>
					(await desktop.browser.execute(() => document.documentElement.dataset.loamTheme)) ===
					theme,
				{ timeout: 5_000 }
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
		// S2 is 1,000 separate commits, so it measures the disk's flushes: on GitHub's hosted Linux
		// runner it ran 550 to 7,555 ms on unrelated changes (#1408), so there it is recorded only.
		const s2Enforced = !(process.platform === 'linux' && process.env.CI === 'true');
		mkdirSync(RESULTS, { recursive: true });
		const record = {
			platform: process.platform,
			coldStartMs,
			coldStarts,
			...result,
		};
		writeFileSync(
			join(RESULTS, `d52-${process.platform}.json`),
			`${JSON.stringify(record, null, '\t')}\n`
		);
		process.stderr.write(
			`D52 on ${process.platform}: S1 p95 ${result.s1.p95Ms.toFixed(2)} ms over ${result.s1.runs} lists of ${result.s1.listed} records (ceiling 50, ${process.platform === 'win32' ? 'enforced' : 'recorded only'}); S2 ${result.s2.totalMs.toFixed(0)} ms for ${result.s2.writes} writes (ceiling 2,000, ${s2Enforced ? 'enforced' : 'recorded only'}); cold start ${coldStartMs.toFixed(0)} ms (median of ${coldStarts.map((ms) => ms.toFixed(0)).join(', ')}, ceiling 2,500, ${process.platform === 'win32' ? 'enforced' : 'recorded only'}); ${result.userAgent}\n`
		);
		expect(result).toMatchObject({ documents: 2_000, links: 20_000 });
		expect(result.s1.listed).toBe(result.s1.expected);
		// S1's ceiling is enforced on Windows alone until a real Linux desktop measures it (the
		// coordinator, 2026-11-17). S2's holds everywhere but a hosted Linux runner (#1408), until
		// #1125 sets ceilings from about 20 main runs; a real Linux desktop still enforces it.
		if (process.platform === 'win32') expect(result.s1.p95Ms).toBeLessThanOrEqual(50);
		if (s2Enforced) expect(result.s2.totalMs).toBeLessThanOrEqual(2_000);
		// Section 14's cold-start row is enforced on Windows alone until step 12 measures
		// each platform (the coordinator, 2026-11-16); elsewhere the line above records it.
		if (process.platform === 'win32') expect(coldStartMs).toBeLessThanOrEqual(2_500);
	});
});
