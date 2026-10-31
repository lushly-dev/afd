/**
 * `@lushly-dev/afd-server/direct` in Chromium (#527): a command runs through the validating
 * registry with the journal and the WebCrypto approval middleware, a human approves it through
 * DirectClient's private exchange, and the journal replays against a fresh registry.
 *
 * Needs a built `dist` (`pnpm test:hosted:local` builds first) and Playwright's Chromium.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const browserDirectory = fileURLToPath(new URL('.', import.meta.url));
const ORIGIN = 'https://afd-direct.test';

// The page: everything AFD runs comes from `/direct` (and DirectClient), bundled for the browser.
const scenario = `
import { createDirectClient } from '@lushly-dev/afd-client';
import { z } from 'zod';
import {
	createApprovalMiddleware,
	createDirectRegistry,
	createJournalMiddleware,
	defineCommand,
	MemoryJournalSink,
	replayJournal,
	success,
} from '@lushly-dev/afd-server/direct';

const sum = defineCommand({
	name: 'sum-compute',
	description: 'Add two whole numbers',
	approval: 'required',
	input: z.object({ a: z.number().int(), b: z.number().int() }),
	async handler({ a, b }) {
		return success({ sum: a + b });
	},
});

window.runScenario = async () => {
	const journal = new MemoryJournalSink();
	const approval = createApprovalMiddleware({
		commands: [sum],
		secret: 'afd-direct-chromium-test-secret-0123456789',
	});
	const registry = createDirectRegistry([sum], {
		middleware: [createJournalMiddleware(journal), approval],
	});
	const asked = [];
	const approving = createDirectClient(registry, {
		onApprovalNeeded: async (request) => {
			asked.push(request.command);
			return true;
		},
	});
	const declining = createDirectClient(registry, {
		onApprovalNeeded: async (request) => {
			asked.push(request.command);
			return false;
		},
	});

	const approved = await approving.call('sum-compute', { a: 2, b: 3 });
	const declined = await declining.call('sum-compute', { a: 4, b: 5 });
	const invalid = await approving.call('sum-compute', { a: 'two', b: 3 });
	const entries = await journal.read();
	const report = await replayJournal(createDirectRegistry([sum]), entries);
	return {
		secureContext: window.isSecureContext,
		subtle: typeof crypto.subtle?.sign === 'function',
		approved: { success: approved.success, data: approved.data },
		declined: { success: declined.success, code: declined.error?.code },
		invalid: { success: invalid.success, code: invalid.error?.code },
		asked,
		journaled: entries.map((entry) => entry.command),
		replay: { same: report.same, different: report.different, errors: report.errors },
	};
};
`;

test('the /direct registry runs, approves, journals and replays a command in Chromium', {
	timeout: 90_000,
}, async () => {
	const bundled = await build({
		stdin: { contents: scenario, resolveDir: browserDirectory, sourcefile: 'scenario.js' },
		bundle: true,
		platform: 'browser',
		format: 'iife',
		write: false,
		logLevel: 'silent',
	});
	const script = bundled.outputFiles[0].text;
	assert.doesNotMatch(script, /require\(["']node:/);

	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		// An https origin, so the page is a secure context and WebCrypto is available.
		await page.route(`${ORIGIN}/**`, (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: `<!doctype html><meta charset="utf-8"><script>${script.replaceAll('</script', '<\\/script')}</script>`,
			})
		);
		await page.goto(`${ORIGIN}/`);
		const result = await page.evaluate(() => window.runScenario());

		assert.deepEqual(errors, []);
		assert.equal(result.secureContext, true);
		assert.equal(result.subtle, true);
		assert.deepEqual(result.approved, { success: true, data: { sum: 5 } });
		assert.deepEqual(result.declined, { success: false, code: 'APPROVAL_REQUIRED' });
		assert.deepEqual(result.invalid, { success: false, code: 'VALIDATION_ERROR' });
		assert.deepEqual(result.asked, ['sum-compute', 'sum-compute']);
		assert.deepEqual(result.journaled, ['sum-compute']);
		assert.deepEqual(result.replay, { same: 1, different: 0, errors: 0 });
	} finally {
		await browser.close();
	}
});
