import type { MountHandle, SpecimenDefinition } from '../src/types.js';
import { type ContextReport, FIXED_NOW } from './context-matrix.js';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function measure(style: string, parent: Element): DOMRect {
	const box = document.createElement('div');
	box.style.cssText = `position:absolute;visibility:hidden;${style}`;
	parent.append(box);
	const rect = box.getBoundingClientRect();
	box.remove();
	return rect;
}

function report(wrapper: HTMLElement, marker: HTMLElement): ContextReport {
	const html = document.documentElement;
	return {
		innerWidth,
		innerHeight,
		narrow: matchMedia('(max-width: 600px)').matches,
		vw: measure('width:100vw;height:1px', document.body).width,
		vh: measure('width:1px;height:100vh', document.body).height,
		rem: Number.parseFloat(getComputedStyle(html).fontSize),
		container: measure('width:100cqw;height:1px', wrapper).width,
		containerNarrow: getComputedStyle(marker).getPropertyValue('--narrow').trim() === '1',
		colorScheme: getComputedStyle(html).colorScheme,
		theme: html.dataset.specimenTheme ?? null,
		prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
		prefersContrast: matchMedia('(prefers-contrast: more)').matches,
		prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
		lang: html.lang,
		language: navigator.language,
		intlLocale: new Intl.DateTimeFormat().resolvedOptions().locale,
		devicePixelRatio,
	};
}

/** Reports its context into `data-report` once mounted, so every driver reads one value. */
export const ContextProbe = {
	render: (): MountHandle => {
		const wrapper = document.createElement('div');
		wrapper.dataset.probe = 'context';
		wrapper.style.cssText = 'container-type:inline-size;position:relative;width:100%;';
		const style = document.createElement('style');
		style.textContent =
			'.context-marker { --narrow: 0; } @container (max-width: 400px) { .context-marker { --narrow: 1; } }';
		const marker = document.createElement('span');
		marker.className = 'context-marker';
		marker.textContent = 'Context probe';
		wrapper.append(style, marker);
		return {
			element: wrapper,
			ready: nextFrame().then(() => {
				wrapper.dataset.report = JSON.stringify(report(wrapper, marker));
			}),
		};
	},
} satisfies SpecimenDefinition;

/** A shortcut that overrides the context a driver applied, as `navigator.webdriver` checks do. */
export const MisreportedLanguage = {
	render: () => {
		Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'de-DE' });
		const element = document.createElement('p');
		element.textContent = 'Misreported language';
		return element;
	},
} satisfies SpecimenDefinition;

declare global {
	// Deliberately leaked by IsolationLeak; a fresh document has none.
	var __specimenLeak: boolean | undefined;
}

/** Leaves every kind of state a case can leak; only the portal is undone by the runtime. */
export const IsolationLeak = {
	render: () => {
		localStorage.setItem('specimen-leak', 'local');
		sessionStorage.setItem('specimen-leak', 'session');
		if (!customElements.get('specimen-leak'))
			customElements.define('specimen-leak', class extends HTMLElement {});
		globalThis.__specimenLeak = true;
		const now = Date.now;
		Date.now = () => now() + 86_400_000;
		Math.random = () => 0.5;
		const portal = document.createElement('div');
		portal.id = 'specimen-leak-portal';
		document.body.append(portal);
		return document.createElement('specimen-leak');
	},
} satisfies SpecimenDefinition;

/** Reports the state IsolationLeak leaves, as observed by the next case. */
export const IsolationProbe = {
	render: () => {
		const element = document.createElement('p');
		element.textContent = 'Isolation probe';
		element.dataset.report = JSON.stringify({
			localStorage: localStorage.getItem('specimen-leak'),
			sessionStorage: sessionStorage.getItem('specimen-leak'),
			registered: customElements.get('specimen-leak') !== undefined,
			global: globalThis.__specimenLeak === true,
			clockShifted: Math.abs(Date.now() - (performance.timeOrigin + performance.now())) > 60_000,
			randomFixed: Math.random() === 0.5 && Math.random() === 0.5,
			portal: document.getElementById('specimen-leak-portal') !== null,
		});
		return element;
	},
} satisfies SpecimenDefinition;

/** Installs a fixed clock and random source for its own lifetime only. */
export const FixedClock = {
	render: (): MountHandle => {
		const now = Date.now;
		const random = Math.random;
		Date.now = () => FIXED_NOW;
		Math.random = () => 0.25;
		const element = document.createElement('time');
		element.dateTime = new Date(Date.now()).toISOString();
		element.dataset.random = String(Math.random());
		element.textContent = 'Fixed clock';
		return {
			element,
			dispose: () => {
				Date.now = now;
				Math.random = random;
			},
		};
	},
} satisfies SpecimenDefinition;

/** Never ready; its disposer must still run when the deadline expires. */
export const TimeoutDisposal = {
	render: (): MountHandle => ({
		element: document.createElement('p'),
		ready: new Promise<void>(() => {}),
		dispose: () => {
			throw new Error('timeout-disposal-marker');
		},
	}),
} satisfies SpecimenDefinition;

interface TrustedPolicy {
	createHTML(value: string): unknown;
}
function trustedPolicy(): TrustedPolicy {
	const factory = (
		globalThis as {
			trustedTypes?: {
				createPolicy(name: string, rules: { createHTML(value: string): string }): TrustedPolicy;
			};
		}
	).trustedTypes;
	if (!factory) throw new Error('Trusted Types are unavailable in this browser');
	return factory.createPolicy('specimen-probe', { createHTML: (value) => value });
}

/** FAST-style markup: a genuine TrustedHTML value assigned through innerHTML. */
export const TrustedMarkup = {
	render: () => {
		const element = document.createElement('div');
		Reflect.set(element, 'innerHTML', trustedPolicy().createHTML('<button>Trusted</button>'));
		return element;
	},
} satisfies SpecimenDefinition;

/** TrustedHTML carrying a closed declarative root stays partial. */
export const TrustedDeclarativeClosed = {
	render: () => {
		const element = document.createElement('section');
		Reflect.apply(Reflect.get(element, 'setHTMLUnsafe'), element, [
			trustedPolicy().createHTML(
				'<div><template shadowrootmode="closed"><button>Trusted internals</button></template></div>'
			),
		]);
		return element;
	},
} satisfies SpecimenDefinition;

/** An ordinary object with toString: inspecting it would call user code a second time. */
export const SpoofedMarkup = {
	render: () => {
		let conversions = 0;
		const markup = {
			toString() {
				conversions++;
				return '<button>Spoofed</button>';
			},
		};
		const element = document.createElement('div');
		Reflect.set(element, 'innerHTML', markup);
		element.dataset.conversions = String(conversions);
		return element;
	},
} satisfies SpecimenDefinition;
