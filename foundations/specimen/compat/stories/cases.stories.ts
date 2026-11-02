import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import '../elements/fixture-field.js';
import '../elements/plain-button.js';

// The representative positive slice: each case passes in Storybook's Vitest run, and its play
// asserts what the case is about, so Specimen agrees only if it reproduces that behavior.
const meta = {
	title: 'Fixtures/Cases',
	component: 'plain-button',
	args: { label: 'Meta label', tone: 'quiet' },
	parameters: { layout: 'padded', fixture: { level: 'meta', keep: true } },
	decorators: [
		(story) => {
			const wrapper = document.createElement('div');
			wrapper.dataset.decorator = 'meta';
			const rendered = story() as Node;
			wrapper.append(rendered);
			return wrapper;
		},
	],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** A custom render: the story builds its own markup instead of the default component render. */
export const CustomRenderer: Story = {
	render: (args) => {
		const section = document.createElement('section');
		section.setAttribute('aria-label', 'Custom renderer');
		const button = document.createElement('plain-button');
		button.label = String(args.label);
		section.append(button);
		return section;
	},
	args: { label: 'Rendered by the story' },
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector('plain-button');
		await expect(button?.shadowRoot?.textContent).toBe('Rendered by the story');
		await expect(canvasElement.querySelector('[data-decorator="meta"] > section')).not.toBeNull();
	},
};

/** Args are merged shallowly, parameters deeply, and decorators wrap story, then meta, then project. */
export const Precedence: Story = {
	args: { tone: 'loud' },
	parameters: { fixture: { level: 'story' } },
	decorators: [
		(story, context) => {
			const wrapper = document.createElement('div');
			wrapper.dataset.decorator = 'story';
			wrapper.dataset.args = JSON.stringify(context.args);
			wrapper.dataset.parameters = JSON.stringify(context.parameters.fixture);
			wrapper.append(story() as Node);
			return wrapper;
		},
	],
	play: async ({ canvasElement, args }) => {
		await expect(args).toEqual({ label: 'Meta label', tone: 'loud' });
		const story = canvasElement.querySelector<HTMLElement>('[data-decorator="story"]');
		await expect(story?.parentElement?.dataset.decorator).toBe('meta');
		await expect(JSON.parse(story?.dataset.parameters ?? '{}')).toEqual({
			level: 'story',
			keep: true,
		});
		await expect(document.documentElement.dataset.fixtureTheme).toBe('light');
	},
};

/** A story-level global overrides the project's initial theme; the project decorator applies it. */
export const GlobalTheme: Story = {
	globals: { theme: 'dark' },
	play: async () => {
		await expect(document.documentElement.dataset.fixtureTheme).toBe('dark');
		// The theme global changes no media preference.
		await expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
	},
};

/** A named viewport: the runner sizes the page before the story renders. */
export const Responsive: Story = {
	globals: { viewport: { value: 'mobile1' } },
	play: async () => {
		await expect(window.innerWidth).toBe(320);
		await expect(window.innerHeight).toBe(568);
	},
};

/** The default viewport, when nothing selects one. */
export const DefaultViewport: Story = {
	play: async () => {
		await expect(window.innerWidth).toBe(1200);
		await expect(window.innerHeight).toBe(900);
	},
};

/** A form-associated element takes part in its form's data. */
export const FormAssociated: Story = {
	render: () => {
		const form = document.createElement('form');
		form.setAttribute('aria-label', 'Planting');
		const field = document.createElement('fixture-field');
		field.setAttribute('name', 'plant');
		form.append(field);
		return form;
	},
	play: async ({ canvasElement }) => {
		const field = canvasElement.querySelector('fixture-field');
		const input = field?.shadowRoot?.querySelector('input');
		if (!input) throw new Error('Expected the field to render an input');
		await userEvent.type(input, 'roma');
		const form = canvasElement.querySelector('form');
		await waitFor(() => expect(new FormData(form ?? undefined).get('plant')).toBe('roma'));
	},
};

/** A story with no play: a smoke test that renders and passes the accessibility check. */
export const SmokeOnly: Story = {};

/** The preview's `import.meta.glob` calls, expanded as Vite expands them. */
export const GlobImport: Story = {
	play: async () => {
		const glob = (
			globalThis as {
				__fixtureGlob?: {
					urls: Record<string, string>;
					values: Record<string, unknown>;
					lazy: string[];
				};
			}
		).__fixtureGlob;
		await expect(glob?.lazy).toEqual(['../data/one.json']);
		await expect(glob?.values).toEqual({ '../data/one.json': { label: 'one' } });
		const url = glob?.urls['../data/one.json'];
		await expect(typeof url).toBe('string');
		await expect(await (await fetch(url as string)).json()).toEqual({ label: 'one' });
	},
};

/** Skipped through the runner's skip tags: listed, never run. */
export const Skipped: Story = {
	tags: ['skip-me'],
	play: async () => {
		throw new Error('A skipped story must not run');
	},
};

/** Excluded through `!test`: listed, but no test is generated for it. */
export const NotATest: Story = {
	tags: ['!test'],
	play: async () => {
		throw new Error('An excluded story must not run');
	},
};
