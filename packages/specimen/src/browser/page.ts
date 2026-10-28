import type { SpecimenContext, SpecimenEntry } from '../types.js';

function viewport(value: string): SpecimenContext['viewport'] {
	const dimensions = /^(\d+)x(\d+)$/.exec(value.trim());
	const width = Number(dimensions?.[1]);
	const height = Number(dimensions?.[2]);
	if (!dimensions || width < 1 || height < 1 || width > 8192 || height > 8192) {
		throw new Error('Viewport must be WIDTHxHEIGHT with each dimension between 1 and 8192.');
	}
	return { width, height };
}

function readContext(params: URLSearchParams, defaults: SpecimenContext): SpecimenContext {
	const theme = params.get('theme') ?? defaults.theme;
	if (theme !== 'light' && theme !== 'dark') throw new Error('Theme must be light or dark.');
	return {
		...defaults,
		theme,
		viewport: params.has('viewport')
			? viewport(params.get('viewport') ?? '')
			: { ...defaults.viewport },
	};
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
	for (const value of ['light', 'dark']) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = value === 'light' ? 'Light' : 'Dark';
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
			await window.__specimen.mount(entry, {
				...context,
				viewport: { width: innerWidth, height: innerHeight },
			});
			return;
		}
		root.replaceChildren();
		document.documentElement.style.colorScheme = context.theme;
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
			frame.style.cssText = `display:block;border:0;width:${context.viewport.width}px;height:${context.viewport.height}px;color-scheme:${context.theme};`;
			root.append(back, title, frame);
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
