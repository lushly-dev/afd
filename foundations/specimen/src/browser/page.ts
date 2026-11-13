import type { SpecimenContext, SpecimenEntry } from '../types.js';
import { colorSchemeOf, contrastOf, observedContrast, sameLocale } from './capture.js';
import styles from './page.css?url';

/**
 * An element with properties and children. The index and preview are built from these, so their
 * markup costs the shell as little as it can.
 */
function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	properties: Partial<HTMLElementTagNameMap[K]> = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const element = Object.assign(document.createElement(tag), properties);
	element.append(...children);
	return element;
}

/** The index and preview pages' stylesheet, never a story's frame or an automated render. */
function loadStyles(): Promise<unknown> {
	// Rendering waits for it, so the page does not flash unstyled; a failed load leaves it plain.
	return new Promise((resolve) =>
		document.head.append(
			h('link', { rel: 'stylesheet', href: styles, onload: resolve, onerror: resolve })
		)
	);
}

/** A label above its control, with optional help text. */
function field(label: string, control: HTMLInputElement | HTMLSelectElement, help?: HTMLElement) {
	return h(
		'div',
		{ className: 'specimen-field' },
		h('label', { htmlFor: control.id }, label),
		control,
		...(help ? [help] : [])
	);
}

/** Where an entry is listed, and what it is called there. */
function placeOf(entry: SpecimenEntry): { group: string; name: string } {
	const cut = entry.title.lastIndexOf('/');
	return entry.story
		? { group: entry.title, name: entry.story.name }
		: {
				group: cut < 0 ? entry.title : entry.title.slice(0, cut),
				name: entry.title.slice(cut + 1),
			};
}

const path = (group: string) => group.replaceAll('/', ' / ');
const tag = (text: string, title = '') => h('span', { className: 'specimen-tag', title }, text);
/** `light only`: the themes an entry declares. */
const only = (themes: NonNullable<SpecimenEntry['themes']>) =>
	`${themes.supported.join(', ')} only`;
/** The play and declared-themes tags an entry shows wherever it is listed. */
const tags = ({ story, themes }: SpecimenEntry) => [
	...(story?.play === 'present' ? [tag('play')] : []),
	...(themes ? [tag(only(themes), themes.reason)] : []),
];

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
	// Mounting a retained story replaces the root, so the one the page first found may be gone.
	const current = document.querySelector<HTMLElement>('#specimen-root') ?? root;
	let alert = current.querySelector<HTMLElement>('#specimen-page-error');
	if (!alert) {
		alert = document.createElement('p');
		alert.id = 'specimen-page-error';
		alert.setAttribute('role', 'alert');
		current.prepend(alert);
	}
	alert.textContent = error instanceof Error ? error.message : String(error);
}

/** A preview has no host: a play waiting on input only the host gives would never finish. */
const PREVIEW_PLAY_MS = 15_000;

function specimenUrl(id: string, context: SpecimenContext, checkpoint?: string | null): URL {
	const url = new URL('./specimen.html', location.href);
	url.searchParams.set('id', id);
	if (checkpoint) url.searchParams.set('checkpoint', checkpoint);
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

/** Common device sizes; any other size is Custom. */
const PRESETS = [
	['375x812', 'Phone'],
	['430x932', 'Large phone'],
	['768x1024', 'Tablet'],
	['1280x720', 'Laptop'],
	['1440x900', 'Desktop'],
	['1920x1080', 'Wide'],
] as const;

/**
 * The context form: theme, and viewport as a preset or a custom size. It applies on submit, not
 * on change, so choosing an option never reloads the page by itself. `show` reflects a size set
 * elsewhere, such as by dragging the frame.
 */
function controls(root: HTMLElement, context: SpecimenContext) {
	const theme = h('select', { id: 'specimen-page-theme' });
	theme.append(
		...(
			[
				['light', 'Light'],
				['dark', 'Dark'],
				['high-contrast', 'High contrast'],
			] as const
		).map(([value, label]) => h('option', { value }, label))
	);
	theme.value = context.theme;
	const size = h('select', { id: 'specimen-page-viewport' });
	size.append(
		...PRESETS.map(([value, label]) =>
			h('option', { value }, `${label}, ${value.replace('x', ' × ')}`)
		),
		h('option', { value: 'custom' }, 'Custom')
	);
	const dimension = (name: string) =>
		h('input', {
			id: `specimen-page-${name}`,
			type: 'number',
			min: '1',
			max: '8192',
			required: true,
		});
	const width = dimension('width');
	const height = dimension('height');
	const custom = h(
		'div',
		{ className: 'specimen-custom' },
		field('Width', width),
		h('span', { ariaHidden: 'true' }, '×'),
		field('Height', height)
	);
	const show = (w: number, hgt: number) => {
		const value = `${w}x${hgt}`;
		size.value = PRESETS.some(([preset]) => preset === value) ? value : 'custom';
		width.value = String(w);
		height.value = String(hgt);
		custom.hidden = size.value !== 'custom';
		apply.hidden = custom.hidden;
	};
	// A theme or a preset size applies when it is picked; only typed custom dimensions wait for Apply.
	const apply = h('button', { type: 'submit' }, 'Apply');
	const form = h(
		'form',
		{ ariaLabel: 'Specimen context' },
		field('Theme', theme),
		field('Viewport', size),
		custom,
		apply
	);
	show(context.viewport.width, context.viewport.height);
	theme.addEventListener('change', () => form.requestSubmit());
	size.addEventListener('change', () => {
		custom.hidden = size.value !== 'custom';
		apply.hidden = custom.hidden;
		if (size.value === 'custom') return;
		const [w, hgt] = size.value.split('x').map(Number);
		width.value = String(w);
		height.value = String(hgt);
		form.requestSubmit();
	});
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		try {
			const nextViewport = viewport(`${width.value}x${height.value}`);
			const url = new URL(location.href);
			url.searchParams.set('theme', theme.value);
			url.searchParams.set('viewport', `${nextViewport.width}x${nextViewport.height}`);
			location.assign(url);
		} catch (error) {
			showError(root, error);
			throw error;
		}
	});
	return { form, show };
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
		const checkpoint = params.get('checkpoint');
		// A retained story's play can run here. A scenario step needs the host's real input.
		const runs = checkpoint === 'after-run' && entry?.story !== undefined;
		if (entry && params.get('frame') === '1') {
			const frameContext = { ...context, viewport: { width: innerWidth, height: innerHeight } };
			// A retained story settles its own context; the frame's size stays the preview's.
			const resolved = await window.__specimen.resolve(entry, frameContext, defaults);
			const mountContext = resolved
				? { ...resolved.context, viewport: frameContext.viewport }
				: frameContext;
			if (runs) {
				const outcome = await Promise.race([
					window.__specimen.mountAndRun(entry, mountContext),
					new Promise<never>((_, reject) =>
						setTimeout(
							() =>
								reject(
									new Error(
										`The play did not finish in ${PREVIEW_PLAY_MS / 1000} s here. It may need the host's real input: run specimen run ${entry.id}.`
									)
								),
							PREVIEW_PLAY_MS
						)
					),
				]);
				if (outcome.status === 'failed') throw new Error(outcome.failures[0]?.message);
			} else await window.__specimen.mount(entry, mountContext);
			document.documentElement.dataset.specimenPreview = 'ready';
			return;
		}
		await loadStyles();
		root.replaceChildren();
		const html = document.documentElement;
		html.style.colorScheme = colorSchemeOf(context.theme);
		html.dataset.specimenPageTheme = context.theme;
		if (entry) {
			const { group, name } = placeOf(entry);
			document.title = `${name} · ${group} — Specimens`;
			const indexUrl = new URL(location.href);
			for (const key of ['id', 'frame', 'checkpoint']) indexUrl.searchParams.delete(key);
			root.append(
				h(
					'nav',
					{ className: 'specimen-crumbs', ariaLabel: 'Breadcrumb' },
					h('a', { href: indexUrl.href }, 'All specimens'),
					// Each segment opens the index filtered to the specimens under it.
					...group.split('/').flatMap((segment, index, segments) => {
						const groupUrl = new URL(indexUrl);
						groupUrl.searchParams.set('q', segments.slice(0, index + 1).join('/'));
						return [' / ', h('a', { href: groupUrl.href }, segment)];
					})
				),
				h('h1', {}, name),
				h('p', { className: 'specimen-meta' }, h('code', {}, entry.id), ...tags(entry))
			);
			const settings = controls(root, context);
			root.append(h('div', { className: 'specimen-bar' }, settings.form));
			const differences = hostDifferences(context);
			if (differences.length)
				root.append(
					h(
						'p',
						{ id: 'specimen-page-context-notice', role: 'note' },
						`This preview cannot emulate part of the requested context: ${differences.join('; ')}. Components that read these values show this browser's settings; the CLI render applies them.`
					)
				);
			const { themes } = entry;
			// A frame that keeps its look under another theme is the author's choice, not a broken switch.
			if (themes && !themes.supported.includes(context.theme))
				root.append(
					h(
						'p',
						{ id: 'specimen-page-theme-notice', role: 'note' },
						`Declared ${only(themes)}${themes.reason ? `: ${themes.reason.replace(/\.$/, '')}` : ''}. Under ${context.theme} it keeps that look by design.`
					)
				);
			if (checkpoint && checkpoint !== 'mount' && !runs)
				root.append(
					h(
						'p',
						{ id: 'specimen-page-checkpoint-notice', role: 'note' },
						`This preview stops at mount. Checkpoint '${checkpoint}' needs the host's real input: run specimen render ${entry.id} --checkpoint ${checkpoint}.`
					)
				);
			const url = specimenUrl(entry.id, context, checkpoint);
			url.searchParams.set('frame', '1');
			const { width, height } = context.viewport;
			const frame = h('iframe', {
				src: url.href,
				title: `${entry.title} specimen preview`,
				width: String(width),
				height: String(height),
			});
			frame.style.cssText = `display:block;border:0;width:100%;height:100%;color-scheme:${colorSchemeOf(context.theme)};`;
			// Drag its corner to resize: the story sees a resized window, as on a real device.
			const resizable = h('div', { className: 'specimen-viewport' }, frame);
			resizable.style.cssText = `width:${width}px;height:${height}px`;
			const caption = h('figcaption');
			const describe = (w: number, hgt: number) => {
				caption.textContent = `${w} × ${hgt}, ${context.theme}${checkpoint ? `, at ${checkpoint}` : ''}. Drag the corner to resize.`;
			};
			describe(width, height);
			new ResizeObserver(() => {
				const w = resizable.clientWidth;
				const hgt = resizable.clientHeight;
				if (w === width && hgt === height && !caption.dataset.resized) return;
				caption.dataset.resized = '1';
				describe(w, hgt);
				settings.show(w, hgt);
				// A reload or a shared link opens at the dragged size.
				const current = new URL(location.href);
				current.searchParams.set('viewport', `${w}x${hgt}`);
				history.replaceState(null, '', current);
			}).observe(resizable);
			root.append(
				h(
					'figure',
					// A wide viewport scrolls the stage, so the keyboard can reach and scroll it.
					{ className: 'specimen-stage', tabIndex: 0 },
					resizable,
					caption
				)
			);
			return;
		}
		document.title = 'Specimens';
		const groups = new Map<string, { name: string; entry: SpecimenEntry }[]>();
		for (const item of entries) {
			const { group, name } = placeOf(item);
			groups.set(group, [...(groups.get(group) ?? []), { name, entry: item }]);
		}
		const summary = h('p', { className: 'specimen-meta', role: 'status' });
		root.append(h('h1', {}, 'Specimens'), summary);
		const filter = h('input', {
			id: 'specimen-page-filter',
			type: 'search',
			placeholder: 'Name, group, id or tag',
			value: params.get('q') ?? '',
		});
		const rows: [HTMLElement, string][] = [];
		const card = (group: string, members: { name: string; entry: SpecimenEntry }[]) =>
			h(
				'section',
				{ className: 'specimen-group', ariaLabel: path(group) },
				h('h3', {}, h('strong', {}, group.slice(group.lastIndexOf('/') + 1)), h('span')),
				h(
					'ul',
					{},
					...members.map(({ name, entry: item }) => {
						const row = h(
							'li',
							{},
							h('a', { href: specimenUrl(item.id, context).href }, name),
							...tags(item)
						);
						rows.push([
							row,
							`${name} ${group} ${item.id} ${item.story?.tags.join(' ') ?? ''}`.toLowerCase(),
						]);
						return row;
					})
				)
			);
		// Groups under a shared prefix, such as Components, share a heading.
		const sections = new Map<string, HTMLElement[]>();
		for (const [group, members] of groups) {
			const prefix = group.slice(0, Math.max(group.lastIndexOf('/'), 0));
			sections.set(prefix, [...(sections.get(prefix) ?? []), card(group, members)]);
		}
		const list = h(
			'div',
			{},
			...[...sections].map(([prefix, cards]) => {
				return h(
					'section',
					{ className: 'specimen-section' },
					...(prefix ? [h('h2', {}, path(prefix), ' ', h('span'))] : []),
					h('div', { className: 'specimen-groups' }, ...cards)
				);
			})
		);
		const apply = () => {
			const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
			let shown = 0;
			for (const [row, text] of rows) {
				row.hidden = !words.every((word) => text.includes(word));
				if (!row.hidden) shown++;
			}
			// Every count is of what the filter leaves: rows per card, cards per section and in all.
			const visible = (parent: Element, selector: string, label: string) => {
				const count = parent.querySelectorAll(`${selector}:not([hidden])`).length;
				(parent as HTMLElement).hidden = !count;
				const counter = parent.querySelector(label);
				if (counter) counter.textContent = String(count);
				return count;
			};
			let cards = 0;
			for (const card of list.querySelectorAll('.specimen-group')) visible(card, 'li', 'h3 span');
			for (const section of list.querySelectorAll('.specimen-section'))
				cards += visible(section, '.specimen-group', 'h2 span');
			summary.textContent = `${shown === entries.length ? '' : `${shown} of `}${entries.length} specimens in ${cards} groups`;
			const url = new URL(location.href);
			if (filter.value) url.searchParams.set('q', filter.value);
			else url.searchParams.delete('q');
			history.replaceState(null, '', url);
		};
		filter.addEventListener('input', apply);
		apply();
		root.append(
			h(
				'div',
				{ className: 'specimen-bar' },
				h('search', {}, field('Filter', filter)),
				controls(root, context).form
			),
			list
		);
	} catch (error) {
		showError(root, error);
		throw error;
	}
}
