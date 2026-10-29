import assert from 'node:assert/strict';

// Exploratory source-copy probe, using the consumer's existing installed dependencies.
// It deliberately imports no stories, Storybook runtime, app entrypoint or hosted services.
const source = `
import './apps/web/node_modules/@webcomponents/scoped-custom-element-registry/scoped-custom-element-registry.min.js';
import { Updates } from './apps/web/node_modules/@lushly-dev/fast-element/dist/esm/index.debug.js';
import './apps/web/src/components/foundations/lushly-storybook.css';
import { withLushlyStorybookFrame } from './apps/web/src/components/foundations/lushly-storybook-frame.ts';
import { LushlyTierBadge } from './apps/web/src/components/shared/lushly-tier-badge/lushly-tier-badge.ts';
import { LushlyViewTabs, LUSHLY_VIEW_TABS_CHANGE_EVENT } from './apps/web/src/components/shared/lushly-view-tabs/lushly-view-tabs.ts';
import { LushlyEmptyState } from './apps/web/src/components/shared/lushly-empty-state/lushly-empty-state.ts';
import { LushlySectionFrame } from './apps/web/src/components/shell/lushly-section-frame/lushly-section-frame.ts';

function preset(): 'light' | 'dark' {
  const value = document.documentElement.dataset.specimenTheme;
  if (value !== 'light' && value !== 'dark') throw new Error('Native specimen theme context required');
  return value;
}

function mount(content: HTMLElement, expected: () => boolean, cleanup = () => {}) {
  const element = withLushlyStorybookFrame(content, { preset: preset(), padding: '1.5rem' });
  // Container units in the real section-frame follow a real sized ancestor.
  const frame = element.querySelector<HTMLElement>('.lushly-storybook-frame')!;
  frame.style.containerType = 'inline-size';
  const ready = (async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      await Updates.next();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (element.isConnected && expected()) {
        await Updates.next();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return;
      }
    }
    throw new Error('Lushly component did not connect and render its expected shadow content');
  })();
  return { element, ready, dispose: cleanup };
}

export const GardenTier = {
  render() {
    const badge = new LushlyTierBadge();
    badge.tier = 'garden';
    return mount(badge, () => Boolean(badge.shadowRoot?.querySelector('violet-badge')?.shadowRoot?.querySelector('[part="badge"]')));
  }
};

export const ControlledViews = {
  render() {
    const content = document.createElement('div');
    const tabs = new LushlyViewTabs();
    tabs.items = [{ id: 'weather', label: 'Weather' }, { id: 'zone', label: 'Zone' }];
    tabs.activeId = 'weather';
    const weather = document.createElement('section');
    weather.setAttribute('role', 'tabpanel');
    weather.setAttribute('aria-label', 'Weather');
    weather.textContent = 'Weather conditions';
    const zone = document.createElement('section');
    zone.setAttribute('role', 'tabpanel');
    zone.setAttribute('aria-label', 'Zone');
    zone.textContent = 'Plant hardiness zone';
    zone.hidden = true;
    tabs.panelsById = { weather, zone };
    // This is the native controlled consumer contract: the real component emits intent.
    const change = (event: Event) => {
      tabs.activeId = (event as CustomEvent<{ id: string }>).detail.id;
      weather.hidden = tabs.activeId !== 'weather';
      zone.hidden = tabs.activeId !== 'zone';
    };
    tabs.addEventListener(LUSHLY_VIEW_TABS_CHANGE_EVENT, change);
    content.append(tabs, weather, zone);
    return mount(content, () => tabs.shadowRoot?.querySelectorAll('[role="tab"]').length === 2,
      () => tabs.removeEventListener(LUSHLY_VIEW_TABS_CHANGE_EVENT, change));
  },
  targets: { zone: { role: 'tab', name: 'Zone' } },
  scenario: [{ action: { click: 'zone' } }, { capture: 'zone-selected' }]
};

export const ThemedEmpty = {
  render() {
    const empty = new LushlyEmptyState();
    empty.title = 'No crops yet';
    empty.message = 'Add your first crop to start planning.';
    return mount(empty, () => Boolean(empty.shadowRoot?.querySelector('.title')));
  }
};

export const ResponsiveSection = {
  render() {
    const section = new LushlySectionFrame();
    const content = document.createElement('p');
    content.textContent = 'Your growing workspace';
    section.append(content);
    return mount(section, () => Boolean(section.shadowRoot?.querySelector('slot')));
  }
};
`;

function observation(captures, key) {
	const result = captures instanceof Map ? captures.get(key) : captures[key];
	assert.ok(result, `Missing Lushly capture ${key}`);
	return result;
}

function element(capture, predicate, description) {
	const result = capture.channels.elements.find(predicate);
	assert.ok(result, `Missing observed ${description}`);
	return result;
}

export default {
	name: 'lushly',
	tsconfig: {
		compilerOptions: {
			target: 'ES2022',
			module: 'ESNext',
			moduleResolution: 'bundler',
			experimentalDecorators: true,
		},
	},
	paths: [
		'tsconfig.base.json',
		'apps/web/tsconfig.json',
		'apps/web/src/app/theme.ts',
		'apps/web/src/app/shell/shell-types.ts',
		'apps/web/src/components/foundations/lushly-storybook-frame.ts',
		'apps/web/src/components/foundations/lushly-storybook.css',
		'apps/web/src/components/shared/lushly-tier-badge/lushly-tier-badge.ts',
		'apps/web/src/components/shared/lushly-view-tabs/lushly-view-tabs.ts',
		'apps/web/src/components/shared/lushly-empty-state/lushly-empty-state.ts',
		'apps/web/src/components/shell/lushly-section-frame/lushly-section-frame.ts',
	],
	dependencyLinks: [{ from: 'apps/web/node_modules', to: 'apps/web/node_modules' }],
	specimens: [
		{
			id: 'garden-tier',
			title: 'Lushly / Garden tier',
			module: './probe.ts',
			exportName: 'GardenTier',
		},
		{
			id: 'controlled-views',
			title: 'Lushly / Controlled views',
			module: './probe.ts',
			exportName: 'ControlledViews',
		},
		{
			id: 'themed-empty',
			title: 'Lushly / Empty state',
			module: './probe.ts',
			exportName: 'ThemedEmpty',
		},
		{
			id: 'responsive-section',
			title: 'Lushly / Section frame',
			module: './probe.ts',
			exportName: 'ResponsiveSection',
		},
	],
	source,
	captures: [
		{ key: 'tier', request: { id: 'garden-tier' } },
		{ key: 'tabs-before', request: { id: 'controlled-views' } },
		{ key: 'tabs-after', request: { id: 'controlled-views', checkpoint: 'zone-selected' } },
		{ key: 'empty-light', request: { id: 'themed-empty', context: { theme: 'light' } } },
		{ key: 'empty-dark', request: { id: 'themed-empty', context: { theme: 'dark' } } },
		{
			key: 'section-narrow',
			request: { id: 'responsive-section', context: { viewport: { width: 375, height: 812 } } },
		},
		{
			key: 'section-wide',
			request: { id: 'responsive-section', context: { viewport: { width: 1440, height: 900 } } },
		},
	],
	verify(captures) {
		const tier = observation(captures, 'tier');
		assert.match(tier.channels.dom.raw, /Garden/);
		assert.ok(
			tier.channels.elements.some((item) => item.ref.includes('/lushly-tier-badge:1/shadow/'))
		);
		const badge = element(tier, (item) => item.tag === 'violet-badge', 'Violet badge');
		assert.equal(badge.attributes.color, 'success');
		assert.equal(badge.attributes.label, 'Current plan: Garden');
		assert.ok(tier.channels.elements.some((item) => item.ref.includes('/violet-badge:1/shadow/')));
		const before = observation(captures, 'tabs-before');
		const after = observation(captures, 'tabs-after');
		const tabs = (capture) =>
			capture.channels.elements.filter((item) => item.attributes.role === 'tab');
		assert.deepEqual(
			tabs(before).map((item) => item.attributes['aria-selected']),
			['true', 'false']
		);
		assert.deepEqual(
			tabs(after).map((item) => item.attributes['aria-selected']),
			['false', 'true']
		);
		assert.equal(
			element(after, (item) => item.attributes['aria-label'] === 'Zone', 'Zone panel').styles
				.display,
			'block'
		);
		assert.equal(
			element(after, (item) => item.attributes['aria-label'] === 'Weather', 'Weather panel').styles
				.display,
			'none'
		);
		const light = observation(captures, 'empty-light');
		const dark = observation(captures, 'empty-dark');
		const base = (capture) =>
			element(
				capture,
				(item) => item.tag === 'section' && item.attributes.part === 'base',
				'empty-state shadow base'
			);
		assert.match(light.channels.dom.raw, /No crops yet/);
		assert.match(dark.channels.dom.raw, /Add your first crop/);
		assert.notEqual(base(light).styles['background-color'], 'rgba(0, 0, 0, 0)');
		assert.notEqual(base(light).styles['background-color'], base(dark).styles['background-color']);
		assert.notEqual(base(light).styles.color, base(dark).styles.color);
		const narrow = observation(captures, 'section-narrow');
		const wide = observation(captures, 'section-wide');
		const frame = (capture) =>
			element(capture, (item) => item.tag === 'lushly-section-frame', 'section frame');
		assert.equal(narrow.manifest.context.viewport.width, 375);
		assert.equal(wide.manifest.context.viewport.width, 1440);
		assert.ok(frame(wide).box.width > frame(narrow).box.width);
		assert.ok(
			Number.parseFloat(frame(wide).styles['padding-left']) >
				Number.parseFloat(frame(narrow).styles['padding-left'])
		);
		assert.ok(
			narrow.channels.elements.some(
				(item) => item.tag === 'slot' && item.ref.includes('/lushly-section-frame:1/shadow/')
			)
		);
		return [
			'Garden tier and nested Violet badge rendered real open shadow content.',
			'Native click changed controlled Weather/Zone selection and visible panel.',
			'Explicit light/dark frame presets changed real computed empty-state colors.',
			'Real narrow/wide viewports changed section-frame width and container-based padding.',
			'Exploratory only: existing installed consumer dependencies may differ from manifests; external fonts are unavailable and use fallbacks. No Storybook runtime/play execution or pixel-equivalence claim.',
		];
	},
};
