import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type ContextReport,
	contextMatrix,
	contextParameters,
	emulatedFields,
	expectedReport,
	FIXED_NOW,
} from '../fixtures/context-matrix.js';
import { serveStatic } from '../fixtures/serve-static.js';
import { createInProcessBench } from './bench-runtime.js';
import { defaultContext } from './config.js';
import { diffObservations } from './diff.js';
import type { ElementObservation, Observation } from './types.js';

const root = resolve(import.meta.dirname, '../fixtures');
// The viewer's own browser: the static index cannot change these for its iframe.
const viewer = { colorScheme: 'light', reducedMotion: 'no-preference', locale: 'en-US' } as const;
const viewerReport = {
	prefersDark: false,
	prefersReducedMotion: false,
	language: viewer.locale,
	intlLocale: viewer.locale,
} satisfies Partial<ContextReport>;
const mismatchLabel = {
	prefersDark: 'prefers-color-scheme',
	prefersReducedMotion: 'prefers-reduced-motion',
	language: 'navigator.language',
	intlLocale: 'navigator.language',
} as const;
const clean = {
	localStorage: null,
	sessionStorage: null,
	registered: false,
	global: false,
	clockShifted: false,
	randomFixed: false,
	portal: false,
};

function element(capture: Observation, test: (entry: ElementObservation) => boolean) {
	const found = capture.channels.elements.find(test);
	if (!found) throw new Error(`No matching observation in ${capture.manifest.specimenId}`);
	return found;
}
function reportOf(capture: Observation): unknown {
	return JSON.parse(
		element(capture, (entry) => entry.attributes['data-report'] !== undefined).attributes[
			'data-report'
		] ?? ''
	);
}

describe('one context and lifecycle contract across drivers', () => {
	let bench: Awaited<ReturnType<typeof createInProcessBench>>;
	let artifacts: string;
	let server: Awaited<ReturnType<typeof serveStatic>>;
	let browser: Browser;

	async function openStatic(id: string, query = ''): Promise<Page> {
		const page = await browser.newPage(viewer);
		await page.goto(`${server.url}/specimen.html?id=${id}${query ? `&${query}` : ''}`);
		await page
			.frameLocator('iframe')
			.locator('#specimen-root > *')
			.first()
			.waitFor({ state: 'attached' });
		return page;
	}
	async function staticReport(page: Page): Promise<unknown> {
		const attribute = await page
			.frameLocator('iframe')
			.locator('[data-report]')
			.getAttribute('data-report');
		return JSON.parse(attribute ?? '');
	}

	beforeAll(async () => {
		artifacts = await mkdtemp(join(tmpdir(), 'specimen-drivers-'));
		bench = await createInProcessBench({ root });
		await bench.build(join(artifacts, 'static'));
		server = await serveStatic(join(artifacts, 'static'));
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		try {
			await browser?.close();
			await server?.close();
			await bench?.close();
		} finally {
			if (artifacts) await rm(artifacts, { recursive: true, force: true });
		}
	});

	describe.each(contextMatrix)('the $name context', ({ context }) => {
		it('reaches the specimen unchanged through the bench', async () => {
			const capture = await bench.render({ id: 'context-probe', context });
			expect(reportOf(capture)).toEqual(expectedReport(context));
			expect(capture.manifest.context).toEqual(context);
			expect(capture.completeness.layout).toMatchObject({ status: 'complete', reasons: [] });
		});

		it('reaches the static preview except for the media it cannot emulate, which it labels', async () => {
			const page = await openStatic('context-probe', contextParameters(context).toString());
			try {
				const expected = expectedReport(context);
				expect(await staticReport(page)).toEqual({ ...expected, ...viewerReport });
				const unemulated = emulatedFields.filter(
					(field) => expected[field] !== viewerReport[field]
				);
				const frame = page.frames().find((candidate) => candidate.parentFrame());
				if (!frame) throw new Error('No specimen iframe');
				const captured = await frame.evaluate(() => window.__specimen.capture());
				const mismatches = captured.limitations.filter((value) =>
					value.startsWith('Context mismatch')
				);
				// Locale and Intl fail together, as one navigator.language mismatch.
				const labels = [...new Set(unemulated.map((field) => mismatchLabel[field]))].sort();
				expect(
					mismatches
						.map((value) => Object.values(mismatchLabel).find((label) => value.includes(label)))
						.sort()
				).toEqual(labels);
				const notice = page.locator('#specimen-page-context-notice');
				expect(await notice.count()).toBe(labels.length ? 1 : 0);
				for (const label of labels) expect(await notice.textContent()).toContain(label);
			} finally {
				await page.close();
			}
		});
	});

	it('makes a bench capture partial when the document contradicts its context', async () => {
		const capture = await bench.render({ id: 'misreported-language' });
		for (const channel of ['layout', 'styles'] as const) {
			expect(capture.completeness[channel].status).toBe('partial');
			expect(capture.completeness[channel].reasons).toEqual([
				'Context mismatch: navigator.language is de-DE, not the requested en-US; only the lang attribute applies.',
			]);
		}
		expect(diffObservations(capture, capture).status).toBe('insufficient-evidence');
	});

	it('starts every bench render from a fresh document, storage, registry and clock', async () => {
		await bench.render({ id: 'isolation-leak' });
		expect(reportOf(await bench.render({ id: 'isolation-probe' }))).toEqual(clean);
	});

	it('keeps storage across static navigations while the document itself is fresh', async () => {
		const page = await openStatic('isolation-leak');
		try {
			await page.goto(`${server.url}/specimen.html?id=isolation-probe`);
			await page.frameLocator('iframe').locator('[data-report]').waitFor({ state: 'attached' });
			expect(await staticReport(page)).toEqual({
				...clean,
				localStorage: 'local',
				sessionStorage: 'session',
			});
		} finally {
			await page.close();
		}
	});

	it('applies a case-owned clock and random source only for that case', async () => {
		const fixed = await bench.render({ id: 'fixed-clock' });
		const time = element(fixed, (entry) => entry.tag === 'time');
		expect(time.attributes.datetime).toBe(new Date(FIXED_NOW).toISOString());
		expect(time.attributes['data-random']).toBe('0.25');
		expect(reportOf(await bench.render({ id: 'isolation-probe' }))).toEqual(clean);
	});

	it('runs a case disposer when readiness times out and reports the render failure first', async () => {
		const failure = await bench.render({ id: 'timeout-disposal', timeoutMs: 300 }).then(
			() => {
				throw new Error('Unexpected successful render');
			},
			(error: unknown) => error
		);
		expect(failure).toBeInstanceOf(AggregateError);
		if (!(failure instanceof AggregateError)) throw new Error('Expected an AggregateError');
		expect(String(failure.errors[0])).toMatch(/deadline exceeded/);
		expect(String(failure.errors[1])).toContain('timeout-disposal-marker');
		expect(reportOf(await bench.render({ id: 'context-probe' }))).toEqual(
			expectedReport(defaultContext)
		);
	});

	it('reads genuine TrustedHTML and keeps look-alike objects opaque', async () => {
		const trusted = await bench.render({ id: 'trusted-markup' });
		expect(trusted.channels.dom.raw).toContain('<button>Trusted</button>');
		expect(trusted.completeness.dom).toMatchObject({ status: 'complete', reasons: [] });
		const declarative = await bench.render({ id: 'trusted-declarative-closed' });
		expect(declarative.completeness.dom.status).toBe('partial');
		expect(declarative.completeness.dom.reasons.join(' ')).toMatch(/shadowrootmode/);
		const spoofed = await bench.render({ id: 'spoofed-markup' });
		expect(spoofed.completeness.dom.status).toBe('partial');
		expect(spoofed.completeness.dom.reasons.join(' ')).toMatch(/non-string/);
		// Native conversion ran once; the observation did not call toString again.
		expect(
			element(spoofed, (entry) => entry.attributes['data-conversions'] !== undefined).attributes[
				'data-conversions'
			]
		).toBe('1');
	});
});
