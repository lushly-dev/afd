import type { SpecimenContext, SpecimenEntry } from '../types.js';
import { colorSchemeOf, contrastOf, observedContrast, sameLocale } from './capture.js';

function viewport(value: string): SpecimenContext['viewport'] {
	const dimensions = /^(\d+)x(\d+)$/.exec(value.trim());
	const width = Number(dimensions?.[1]);
	const height = Number(dimensions?.[2]);
	if (!dimensions || width < 1 || height < 1 || width > 8192 || height > 8192) {
		throw new Error('Viewport must be WIDTHxHEIGHT with each dimension between 1 and 8192.');
	}
	return { width, height };
}

function container(value: string): NonNullable<SpecimenContext['container']> {
	const dimensions = /^(\d+)(?:x(\d+))?$/.exec(value.trim());
	const width = Number(dimensions?.[1]);
	const height = dimensions?.[2] === undefined ? undefined : Number(dimensions[2]);
	if (
		!dimensions ||
		width < 1 ||
		width > 8192 ||
		(height !== undefined && (height < 1 || height > 8192))
	)
		throw new Error(
			'Container must be WIDTH or WIDTHxHEIGHT with each dimension between 1 and 8192.'
		);
	return height === undefined ? { width } : { width, height };
}

function choice<T extends string>(
	params: URLSearchParams,
	name: string,
	values: T[],
	fallback: T
): T {
	const value = params.get(name) ?? fallback;
	if (!values.includes(value as T)) throw new Error(`${name} must be ${values.join(' or ')}.`);
	return value as T;
}

function readContext(params: URLSearchParams, defaults: SpecimenContext): SpecimenContext {
	const locale = params.get('locale') ?? defaults.locale;
	try {
		Intl.getCanonicalLocales(locale);
	} catch {
		throw new Error(`Locale must be a BCP 47 language tag, not ${locale}.`);
	}
	const context: SpecimenContext = {
		...defaults,
		theme: choice(params, 'theme', ['light', 'dark', 'high-contrast'], defaults.theme),
		locale,
		reducedMotion: choice(
			params,
			'reducedMotion',
			['reduce', 'no-preference'],
			defaults.reducedMotion
		),
		motion: choice(params, 'motion', ['natural', 'settled'], defaults.motion),
		viewport: params.has('viewport')
			? viewport(params.get('viewport') ?? '')
			: { ...defaults.viewport },
	};
	if (params.has('container')) context.container = container(params.get('container') ?? '');
	return context;
}

/** An iframe cannot emulate media or navigator values; say which ones the preview shows. */
function hostDifferences(context: SpecimenContext): string[] {
	const differences: string[] = [];
	const dark = matchMedia('(prefers-color-scheme: dark)').matches;
	const colorScheme = colorSchemeOf(context.theme);
	if (dark !== (colorScheme === 'dark'))
		differences.push(
			`prefers-color-scheme is ${dark ? 'dark' : 'light'} from this browser, not ${colorScheme}`
		);
	const observed = observedContrast();
	const contrast = contrastOf(context.theme);
	if (observed !== contrast)
		differences.push(`prefers-contrast is ${observed} from this browser, not ${contrast}`);
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (reduce !== (context.reducedMotion === 'reduce'))
		differences.push(
			`prefers-reduced-motion is ${reduce ? 'reduce' : 'no-preference'} from this browser, not ${context.reducedMotion}`
		);
	if (!sameLocale(navigator.language, context.locale))
		differences.push(
			`navigator.language is ${navigator.language} from this browser, not ${context.locale}`
		);
	return differences;
}

function showError(root: HTMLElement, error: unknown): void {
	let alert = root.querySelector<HTMLElement>('#specimen-page-error');
	if (!alert) {
		alert = document.createElement('p');
		alert.id = 'specimen-page-error';
		alert.setAttribute('role', 'alert');
		root.prepend(alert);
	}
	alert.textContent = error instanceof Error ? error.message : String(error);
}

function specimenUrl(id: string, context: SpecimenContext): URL {
	const url = new URL('./specimen.html', location.href);
	url.searchParams.set('id', id);
	url.searchParams.set('theme', context.theme);
	url.searchParams.set('viewport', `${context.viewport.width}x${context.viewport.height}`);
	url.searchParams.set('locale', context.locale);
	url.searchParams.set('reducedMotion', context.reducedMotion);
	url.searchParams.set('motion', context.motion);
	if (context.container)
		url.searchParams.set(
			'container',
			context.container.height === undefined
				? String(context.container.width)
				: `${context.container.width}x${context.container.height}`
		);
	return url;
}

function controls(root: HTMLElement, context: SpecimenContext): void {
	const form = document.createElement('form');
	form.setAttribute('aria-label', 'Specimen context');
	const themeLabel = document.createElement('label');
	themeLabel.htmlFor = 'specimen-page-theme';
	themeLabel.textContent = 'Theme';
	const theme = document.createElement('select');
	theme.id = themeLabel.htmlFor;
	for (const [value, label] of [
		['light', 'Light'],
		['dark', 'Dark'],
		['high-contrast', 'High contrast'],
	] as const) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = label;
		theme.append(option);
	}
	theme.value = context.theme;
	const viewportLabel = document.createElement('label');
	viewportLabel.htmlFor = 'specimen-page-viewport';
	viewportLabel.textContent = 'Viewport';
	const dimensions = document.createElement('input');
	dimensions.id = viewportLabel.htmlFor;
	dimensions.type = 'text';
	dimensions.value = `${context.viewport.width}x${context.viewport.height}`;
	dimensions.setAttribute('aria-describedby', 'specimen-page-viewport-help');
	const help = document.createElement('span');
	help.id = 'specimen-page-viewport-help';
	help.textContent = 'Width x height in pixels, for example 375x812.';
	const apply = document.createElement('button');
	apply.type = 'submit';
	apply.textContent = 'Apply context';
	form.append(themeLabel, theme, viewportLabel, dimensions, help, apply);
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		try {
			const nextViewport = viewport(dimensions.value);
			const url = new URL(location.href);
			url.searchParams.set('theme', theme.value);
			url.searchParams.set('viewport', `${nextViewport.width}x${nextViewport.height}`);
			location.assign(url);
		} catch (error) {
			showError(root, error);
			throw error;
		}
	});
	root.append(form);
}

/** Human index and sized preview; automation retains exclusive control of the runtime. */
export async function installPage(
	entries: SpecimenEntry[],
	defaults: SpecimenContext
): Promise<void> {
	const params = new URLSearchParams(location.search);
	if (params.has('automation')) return;
	const root = document.querySelector<HTMLElement>('#specimen-root');
	if (!root) throw new Error('The bench page must contain #specimen-root.');
	try {
		const context = readContext(params, defaults);
		const id = params.get('id');
		const entry = id ? entries.find((item) => item.id === id) : undefined;
		if (id && !entry) throw new Error(`Unknown specimen: ${id}.`);
		if (entry && params.get('frame') === '1') {
			const frameContext = { ...context, viewport: { width: innerWidth, height: innerHeight } };
			// A retained story settles its own context; the frame's size stays the preview's.
			const resolved = await window.__specimen.resolve(entry, frameContext, defaults);
			await window.__specimen.mount(
				entry,
				resolved ? { ...resolved.context, viewport: frameContext.viewport } : frameContext
			);
			return;
		}
		root.replaceChildren();
		document.documentElement.style.colorScheme = colorSchemeOf(context.theme);
		const heading = document.createElement('h1');
		heading.textContent = 'Specimens';
		root.append(heading);
		controls(root, context);
		if (entry) {
			document.title = `${entry.title} — Specimens`;
			const title = document.createElement('h2');
			title.textContent = `${entry.title} / ${entry.id}`;
			const back = document.createElement('a');
			const indexUrl = new URL(location.href);
			indexUrl.searchParams.delete('id');
			indexUrl.searchParams.delete('frame');
			back.href = indexUrl.href;
			back.textContent = 'All specimens';
			const frame = document.createElement('iframe');
			const url = specimenUrl(entry.id, context);
			url.searchParams.set('frame', '1');
			frame.src = url.href;
			frame.title = `${entry.title} specimen preview`;
			frame.width = String(context.viewport.width);
			frame.height = String(context.viewport.height);
			frame.style.cssText = `display:block;border:0;width:${context.viewport.width}px;height:${context.viewport.height}px;color-scheme:${colorSchemeOf(context.theme)};`;
			root.append(back, title);
			const differences = hostDifferences(context);
			if (differences.length) {
				const notice = document.createElement('p');
				notice.id = 'specimen-page-context-notice';
				notice.textContent = `This preview cannot emulate part of the requested context: ${differences.join('; ')}. Components that read these values show this browser's settings; the CLI render applies them.`;
				root.append(notice);
			}
			root.append(frame);
			return;
		}
		document.title = 'Specimens';
		const list = document.createElement('ul');
		for (const item of entries) {
			const row = document.createElement('li');
			const link = document.createElement('a');
			link.href = specimenUrl(item.id, context).href;
			link.textContent = `${item.title} / ${item.id}`;
			row.append(link);
			list.append(row);
		}
		root.append(list);
	} catch (error) {
		showError(root, error);
		throw error;
	}
}
