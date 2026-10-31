import { describe, expect, it } from 'vitest';
import { foreignWork, parseProcesses, quietDefaults, quietPolicy, quietVerdict } from './quiet.mjs';

const policy = { ...quietDefaults, windowSeconds: 60, intervalSeconds: 30 };
const calm = { usedCores: 0.6, freeMemoryPercent: 70, foreign: [] };

describe('quiet-window gate', () => {
	it('requires a full window in which every sample is quiet', () => {
		expect(quietVerdict([calm, calm], policy)).toMatchObject({
			quiet: false,
			reasons: ['WINDOW_INCOMPLETE'],
		});
		expect(quietVerdict([calm, calm, calm], policy).quiet).toBe(true);
		const spike = { ...calm, usedCores: 3.2 };
		expect(quietVerdict([calm, spike, calm], policy).reasons).toEqual(['CPU_BUSY']);
		// Only the latest window counts: an old spike ages out.
		expect(quietVerdict([spike, calm, calm, calm], policy).quiet).toBe(true);
	});

	it('rounds the window up and rejects options that would pass vacuously', () => {
		const odd = { ...policy, windowSeconds: 60, intervalSeconds: 45 };
		expect(quietVerdict([calm, calm], odd).quiet).toBe(false);
		expect(quietVerdict([calm, calm, calm], odd).quiet).toBe(true);
		expect(() => quietPolicy({ windowSeconds: Number('10m') })).toThrow(/windowSeconds/);
		expect(() => quietPolicy({ maxBusyCores: Number.NaN })).toThrow(/maxBusyCores/);
		expect(() => quietPolicy({ intervalSeconds: 0 })).toThrow(/intervalSeconds/);
		expect(() => quietPolicy({ intervalSeconds: 2 })).toThrow(/CPU window/);
	});

	it('holds for low memory, missing measurements and other sessions', () => {
		const verdict = quietVerdict(
			[
				{ ...calm, freeMemoryPercent: 12 },
				{ ...calm, usedCores: null, freeMemoryPercent: null },
				{ ...calm, foreign: [{ pid: 9, command: 'vitest' }] },
			],
			policy
		);
		expect(verdict.reasons.sort()).toEqual([
			'CPU_UNAVAILABLE',
			'FOREIGN_WORK',
			'MEMORY_LOW',
			'MEMORY_UNAVAILABLE',
		]);
	});

	it('names test, browser and busy processes outside its own family', () => {
		const processes = parseProcesses(
			[
				'  101     1   0.0 /Applications/T3 Code (Beta).app/Contents/MacOS/T3 Code (Beta)',
				'  102     1   1.8 node scripts/run-browser-iteration.mjs e2e tests/e2e/a.spec.ts',
				'  103   102   0.2 /Users/x/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Chromium',
				'  104     1  54.0 /System/Library/Frameworks/CoreServices.framework/fseventsd',
				'  105     1   0.4 codex app-server',
				'  200     1   2.0 node node_modules/.bin/vitest run',
				'  106     1   0.1 npm exec @playwright/mcp@latest',
				'  107   106   0.3 node /Users/x/.npm/_npx/1/node_modules/.bin/playwright-mcp',
				'  108     1   0.5 /Users/x/.cargo/bin/rust-analyzer',
				'  109     1   0.1 vim src/vite.config.ts',
				'  110     1   1.0 node node_modules/.bin/vitest run src/mcp-server.test.ts',
				'  111     1   2.0 cargo test --all-targets',
			].join('\n')
		);
		expect(processes).toHaveLength(12);
		expect(foreignWork(processes, new Set([200])).map((entry) => entry.pid)).toEqual([
			102, 103, 104, 110, 111,
		]);
	});
});
