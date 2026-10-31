import { describe, expect, it } from 'vitest';
import { analyzeStoryModule } from './csf.mjs';

const storyModule = `
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { expect, userEvent, within } from 'storybook/test';
import { frame, sharedPlay } from './helpers';

const base = { args: { tone: 'neutral' }, parameters: { layout: 'centered' } };

const meta = {
	title: 'Components/Button',
	component: 'violet-button',
	tags: ['autodocs'],
	parameters: { a11y: { test: 'error' }, docs: { description: { component: 'x' } } },
	decorators: [frame],
	render: (args) => document.createElement('violet-button'),
} satisfies Meta;
export default meta;

export const Default: StoryObj = {
	...base,
	play: async ({ canvasElement, step }) => {
		await expect(canvasElement.querySelector('x')).toBeInTheDocument();
	},
};
export const Named = { name: 'Explicit name', tags: ['!test'], globals: { theme: 'dark' } };
export const Skipped = { parameters: { a11y: { test: 'off' } } };
export const Shared = { play: sharedPlay, args: { ...imported } };
export const Generated = makeStory('x');
export function Legacy() { return document.createElement('div'); }
export const Copy = { ...Default, args: { ...Default.args, size: 'small' } };
export const Reused = { play: Default.play, render: meta.render };
export const NoPlay = { ...Default, play: undefined };
export const Dynamic = { parameters: { a11y: policyFor('x') } };
export const Opaque = { ...imported, args: { tone: 'loud' } };
export const Assigned = () => document.createElement('div');
Assigned.play = async ({ canvasElement }) => {};
Assigned.args.size = 'large';
export const Getter = { get play() { return undefined; } };
export const Rewritten = { parameters: { a11y: { test: 'error' } } };
Rewritten.parameters.a11y = policyFor('y');
const helper = { name: 'Aliased' };
export { helper as Aliased };
export type Story = StoryObj;
`;

describe('analyzeStoryModule', () => {
	const result = analyzeStoryModule(storyModule);

	it('reads meta through satisfies, including policy parameters and behavior presence', () => {
		expect(result.meta.resolved).toBe(true);
		expect(result.meta.fields.title).toEqual({ static: 'Components/Button' });
		expect(result.meta.fields.tags).toEqual({ static: ['autodocs'] });
		expect(result.meta.fields.parameters.policies.a11y).toEqual({ static: { test: 'error' } });
		expect(result.meta.fields.decorators).toEqual({ kind: 'array', count: 1 });
		expect(result.meta.fields.render).toEqual({ kind: 'function' });
	});

	it('follows local spreads and records play context keys', () => {
		const story = result.stories.Default;
		expect(story.resolved).toBe(true);
		expect(story.fields.args.keys).toEqual(['tone']);
		expect(story.fields.parameters.policies.layout).toEqual({ static: 'centered' });
		expect(story.fields.play.contextKeys).toEqual(['canvasElement', 'step']);
	});

	it('resolves same-file story spreads and member references', () => {
		expect(result.stories.Copy.resolved).toBe(true);
		expect(result.stories.Copy.fields.args.keys).toEqual(['size', 'tone']);
		expect(result.stories.Copy.fields.play.contextKeys).toEqual(['canvasElement', 'step']);
		expect(result.stories.Reused.resolved).toBe(true);
		expect(result.stories.Reused.fields.play).toMatchObject({
			kind: 'function',
			via: 'Default.play',
		});
		expect(result.stories.Reused.fields.render).toMatchObject({
			kind: 'function',
			via: 'meta.render',
		});
	});

	it('keeps static names, tags, globals and per-story policy overrides', () => {
		expect(result.stories.Named.fields.name).toEqual({ static: 'Explicit name' });
		expect(result.stories.Named.fields.tags).toEqual({ static: ['!test'] });
		expect(result.stories.Named.fields.globals).toEqual({ static: { theme: 'dark' } });
		expect(result.stories.Skipped.fields.parameters.policies.a11y).toEqual({
			static: { test: 'off' },
		});
	});

	it('marks imported references, unresolved spreads and generated stories explicitly', () => {
		expect(result.stories.Shared.fields.play).toEqual({ kind: 'reference', text: 'sharedPlay' });
		expect(result.stories.Shared.resolved).toBe(false);
		expect(result.stories.Shared.unresolved).toEqual([{ field: 'args', text: '<partial object>' }]);
		expect(result.stories.Generated).toEqual({ resolved: false, text: "makeStory('x')" });
	});

	it('handles CSF2 functions, aliased exports and ignores type exports', () => {
		expect(result.stories.Legacy.csf2).toBe(true);
		expect(result.stories.Legacy.resolved).toBe(true);
		expect(result.stories.Legacy.fields.render).toEqual({ kind: 'function' });
		expect(result.stories.Aliased.fields.name).toEqual({ static: 'Aliased' });
		expect(Object.keys(result.stories).sort()).toEqual([
			'Aliased',
			'Assigned',
			'Copy',
			'Default',
			'Dynamic',
			'Generated',
			'Getter',
			'Legacy',
			'Named',
			'NoPlay',
			'Opaque',
			'Reused',
			'Rewritten',
			'Shared',
			'Skipped',
		]);
	});

	it('records runtime helper imports and jest-dom matchers', () => {
		expect(result.imports).toEqual({ 'storybook/test': ['expect', 'userEvent', 'within'] });
		expect(result.jestDomMatchers).toEqual(['toBeInTheDocument']);
		expect(result.problems).toEqual([]);
	});

	it('treats an explicit undefined play as removing the inherited one', () => {
		expect(result.stories.NoPlay.fields.play).toEqual({ kind: 'absent' });
	});

	it('marks dynamic policy values and unreadable spreads', () => {
		expect(result.stories.Dynamic.resolved).toBe(false);
		expect(result.stories.Dynamic.unresolved).toEqual([
			{ field: 'parameters.a11y', text: "policyFor('x')" },
		]);
		expect(result.stories.Opaque.opaque).toBe(true);
		expect(result.stories.Default.opaque).toBe(false);
	});

	it('applies later top-level assignments and flags nested writes', () => {
		const story = result.stories.Assigned;
		expect(story.csf2).toBe(true);
		expect(story.fields.play).toMatchObject({ kind: 'function', contextKeys: ['canvasElement'] });
		expect(story.resolved).toBe(false);
		expect(story.unresolved).toEqual([
			{ field: 'args.size', root: 'args', text: "Assigned.args.size = 'large';" },
		]);
	});

	it('treats accessors and nested rewrites as hiding their fields', () => {
		expect(result.stories.Getter.opaque).toBe(true);
		expect(result.stories.Rewritten.fields.parameters).toMatchObject({ kind: 'dynamic' });
		expect(result.stories.Rewritten.resolved).toBe(false);
	});

	it('reports parse errors as problems', () => {
		expect(analyzeStoryModule('export default { title: ;').problems[0].kind).toBe('parse-error');
	});
});
