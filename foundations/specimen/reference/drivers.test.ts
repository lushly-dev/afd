import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { contextMatrix, expectedReport, FIXED_NOW } from '../fixtures/context-matrix.js';
import { installRuntime } from '../src/browser/index.js';
import type { BrowserObservation, SpecimenContext, SpecimenEntry } from '../src/types.js';
import { type MediaEmulation, providerMedia } from './provider.js';

declare module 'vitest/browser' {
	interface BrowserCommands {
		emulateMedia(media: MediaEmulation): Promise<void>;
	}
}

const defaults: SpecimenContext = {
	viewport: { width: 1200, height: 900 },
	theme: 'light',
	locale: 'en-US',
	reducedMotion: 'no-preference',
	motion: 'natural',
};
const entries: Record<string, SpecimenEntry> = Object.fromEntries(
	[
		['context-probe', 'ContextProbe', 'context'],
		['isolation-leak', 'IsolationLeak', 'context'],
		['isolation-probe', 'IsolationProbe', 'context'],
		['fixed-clock', 'FixedClock', 'context'],
		['trusted-declarative-closed', 'TrustedDeclarativeClosed', 'context'],
		['readiness-failure', 'ReadinessFailure', 'probe'],
		['disposal-failure', 'DisposalFailure', 'probe'],
	].map(([id = '', exportName = '', module = '']) => [
		id,
		{ id, title: `Reference/${exportName}`, module, exportName },
	])
);

function report(observation: BrowserObservation): unknown {
	const found = observation.elements.find((entry) => entry.attributes['data-report']);
	return JSON.parse(found?.attributes['data-report'] ?? '');
}
function mismatches(observation: BrowserObservation): string[] {
	return observation.limitations.filter((value) => value.startsWith('Context mismatch'));
}

/** What a Vitest driver does around the common runtime: size the frame and set media. */
async function render(
	id: string,
	context: SpecimenContext,
	media: 'emulated' | 'provider' = 'emulated'
): Promise<BrowserObservation> {
	const entry = entries[id];
	if (!entry) throw new Error(`No reference entry for ${id}`);
	await page.viewport(context.viewport.width, context.viewport.height);
	await commands.emulateMedia(
		media === 'emulated'
			? { colorScheme: context.theme, reducedMotion: context.reducedMotion }
			: providerMedia
	);
	await window.__specimen.mount(entry, context);
	try {
		return window.__specimen.capture();
	} finally {
		await window.__specimen.dispose();
	}
}

describe('the reference driver: the common runtime in Vitest browser mode', () => {
	const now = Date.now;
	const random = Math.random;

	beforeAll(() => {
		// The page is part of the context: Vitest's tester body has no margin, while the bench
		// page keeps the default 8px. Without this, unconstrained layout is 16px wider.
		document.body.style.margin = '8px';
		const root = document.createElement('main');
		root.id = 'specimen-root';
		document.body.append(root);
		installRuntime({
			'context-probe': () => import('../fixtures/context.stories.js'),
			'isolation-leak': () => import('../fixtures/context.stories.js'),
			'isolation-probe': () => import('../fixtures/context.stories.js'),
			'fixed-clock': () => import('../fixtures/context.stories.js'),
			'trusted-declarative-closed': () => import('../fixtures/context.stories.js'),
			'readiness-failure': () => import('../fixtures/probe.stories.js'),
			'disposal-failure': () => import('../fixtures/probe.stories.js'),
		});
	});

	afterAll(async () => {
		Date.now = now;
		Math.random = random;
		localStorage.removeItem('specimen-leak');
		sessionStorage.removeItem('specimen-leak');
		globalThis.__specimenLeak = undefined;
		await commands.emulateMedia(providerMedia);
	});

	describe.each(contextMatrix)('the $name context', ({ context }) => {
		it('reaches the specimen, except a locale the browser context does not have', async () => {
			const observation = await render('context-probe', context);
			const locale = context.locale === 'en-US' ? {} : { language: 'en-US', intlLocale: 'en-US' };
			expect(report(observation)).toEqual({ ...expectedReport(context), ...locale });
			expect(mismatches(observation)).toHaveLength(context.locale === 'en-US' ? 0 : 1);
		});

		it('leaves media to the provider without a driver switch, as the Storybook addon does', async () => {
			const observation = await render('context-probe', context, 'provider');
			const values = report(observation) as Record<string, unknown>;
			expect(values.prefersDark).toBe(providerMedia.colorScheme === 'dark');
			expect(values.prefersReducedMotion).toBe(providerMedia.reducedMotion === 'reduce');
			expect(values.colorScheme).toBe(context.theme);
			const expected =
				(context.theme === providerMedia.colorScheme ? 0 : 1) +
				(context.reducedMotion === providerMedia.reducedMotion ? 0 : 1);
			expect(
				mismatches(observation).filter((value) => !value.includes('navigator.language'))
			).toHaveLength(expected);
		});
	});

	it('restores the document after disposal', async () => {
		const html = document.documentElement;
		const before = {
			lang: html.lang,
			style: html.style.cssText,
			theme: html.dataset.specimenTheme,
		};
		await render('context-probe', { ...defaults, theme: 'dark', locale: 'fr-FR' });
		expect({
			lang: html.lang,
			style: html.style.cssText,
			theme: html.dataset.specimenTheme,
		}).toEqual(before);
		expect(document.querySelector('#specimen-root')?.childElementCount).toBe(0);
	});

	it('restores a case-owned clock on disposal', async () => {
		const observation = await render('fixed-clock', defaults);
		const time = observation.elements.find((entry) => entry.tag === 'time');
		expect(time?.attributes.datetime).toBe(new Date(FIXED_NOW).toISOString());
		expect(Date.now()).not.toBe(FIXED_NOW);
		expect(Math.random).toBe(random);
	});

	it('shares one document between cases, so only runtime-owned state is reset', async () => {
		await render('isolation-leak', defaults);
		expect(report(await render('isolation-probe', defaults))).toEqual({
			localStorage: 'local',
			sessionStorage: 'session',
			registered: true,
			global: true,
			clockShifted: true,
			randomFixed: true,
			portal: false,
		});
	});

	it('owns readiness and disposal failures and stays usable', async () => {
		await expect(render('readiness-failure', defaults)).rejects.toThrow('readiness-marker');
		await expect(render('disposal-failure', defaults)).rejects.toThrow('disposal-marker');
		expect(report(await render('context-probe', defaults))).toEqual(expectedReport(defaults));
	});

	// Last: it leaves a limitation on the shared document for every later case.
	it('keeps HTML-construction limitations for the life of a shared document', async () => {
		const shadowRoot = (observation: BrowserObservation) =>
			observation.limitations.filter((value) => value.includes('shadowrootmode'));
		expect(shadowRoot(await render('context-probe', defaults))).toEqual([]);
		expect(shadowRoot(await render('trusted-declarative-closed', defaults))).toHaveLength(1);
		// Conservative by design: a detached closed root could be adopted by a later case.
		expect(shadowRoot(await render('context-probe', defaults))).toHaveLength(1);
	});
});
