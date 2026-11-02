import { describe, expect, it } from 'vitest';
import {
	combineParameters,
	combineTags,
	composeGlobals,
	composeStory,
	decorate,
	includeConditionalArg,
	prepareArgs,
	unsupportedFields,
	viewportFor,
} from './browser/csf.js';
import { destructuredFields } from './browser/story-runtime.js';

// Storybook 10.6.2's composition rules, which the compatibility runtime applies in the page.
describe('CSF composition', () => {
	it('merges parameters as combineParameters does', () => {
		expect(
			combineParameters({ a: { x: 1, y: [1] }, b: 1 }, { a: { y: [2], z: 2 }, b: undefined })
		).toEqual({ a: { x: 1, y: [2], z: 2 }, b: 1 });
		// A key merges only while every defined value is a plain object.
		expect(combineParameters({ a: { x: 1 } }, { a: { y: 2 } }, { a: 3 })).toEqual({ a: 3 });
		expect(combineParameters(undefined, { a: [1] }, { a: [2] })).toEqual({ a: [2] });
	});

	it('combines tags in order and removes negated ones', () => {
		expect(combineTags('dev', 'test', 'x', '!test', 'y', '!x', 'x')).toEqual(['dev', 'y', 'x']);
	});

	it('composes a story field by field, as preparePartialAnnotations does', () => {
		const project = {
			args: { p: 1 },
			parameters: { a11y: { test: 'error' } },
			initialGlobals: { theme: 'light', viewport: { value: undefined } },
			globalTypes: { locale: { defaultValue: 'en' } },
			tags: ['project'],
			decorators: [(story: () => unknown) => story()],
		};
		const meta = {
			args: { p: 2, m: 1 },
			globals: { theme: 'dark' },
			parameters: { a11y: { config: { rules: [] } } },
			tags: ['meta'],
			render: () => 'meta render',
			play: async () => {},
		};
		const story = {
			args: { s: 1 },
			tags: ['!dev', 'story'],
			name: 'Named',
			globals: { viewport: { value: 'mobile1' } },
		};
		const composed = composeStory({
			id: 'x--y',
			title: 'X',
			name: 'Y',
			exportName: 'Y',
			project,
			meta,
			story,
		});
		expect(composed.initialArgs).toEqual({ p: 2, m: 1, s: 1 });
		expect(composed.parameters).toEqual({ a11y: { test: 'error', config: { rules: [] } } });
		expect(composed.globals).toEqual({
			locale: 'en',
			theme: 'dark',
			viewport: { value: 'mobile1' },
		});
		expect(composed.storyGlobals).toEqual({ theme: 'dark', viewport: { value: 'mobile1' } });
		// The runtime adds neither play-fn nor manifest.
		expect(composed.tags).toEqual(['test', 'project', 'meta', 'story']);
		expect(composed.name).toBe('Named');
		expect(composed.render).toBe(meta.render);
		expect(composed.play).toBe(meta.play);
		expect(composed.decorators).toHaveLength(1);
	});

	it('takes initial globals before globalTypes defaults and story globals last', () => {
		expect(
			composeGlobals(
				{
					globalTypes: { a: { defaultValue: 1 }, b: { defaultValue: 1 } },
					initialGlobals: { b: 2 },
				},
				{ c: 3 },
				{ b: 4 }
			)
		).toEqual({ a: 1, b: 4, c: 3 });
	});

	it('wraps decorators story first and shares context updates shallowly', () => {
		const order: string[] = [];
		const render = decorate(
			(context) => context.args,
			[
				(story, context) => {
					order.push(`story:${JSON.stringify(context.args)}`);
					return story();
				},
				(story) => {
					order.push('meta');
					return story({ args: { replaced: true }, id: 'ignored' });
				},
				(story) => {
					order.push('project');
					return story();
				},
			]
		);
		expect(render({ id: 'x--y', args: { a: 1 } })).toEqual({ replaced: true });
		expect(order).toEqual(['project', 'meta', 'story:{"replaced":true}']);
	});

	it('maps and filters args with argTypes', () => {
		const argTypes = {
			size: { mapping: { large: 'L' } },
			list: { mapping: { a: 1 } },
			extra: { if: { arg: 'size', eq: 'L' } },
			hidden: { if: { global: 'mode', truthy: false } },
		};
		expect(
			prepareArgs({ size: 'large', list: ['a', 'b'], extra: 1, hidden: 2 }, argTypes, {
				mode: 'on',
			})
		).toEqual({ size: 'L', list: [1, 'b'], extra: 1 });
		expect(() => includeConditionalArg({ if: { arg: 'a', global: 'b' } }, {}, {})).toThrow();
		expect(includeConditionalArg({ if: { arg: 'a', exists: false } }, {}, {})).toBe(true);
		expect(includeConditionalArg({ if: { arg: 'a', neq: [1] } }, { a: [1] }, {})).toBe(false);
	});

	it("sizes the page as the Vitest addon's setViewport does", () => {
		const responsive = { options: { responsive: { styles: { width: '100%', height: '100%' } } } };
		expect(viewportFor({ viewport: { ...responsive, defaultViewport: 'responsive' } }, {})).toEqual(
			{
				width: 1200,
				height: 900,
			}
		);
		expect(viewportFor({ viewport: responsive }, { viewport: { value: 'mobile1' } })).toEqual({
			width: 320,
			height: 568,
		});
		// A string global is ignored; a disabled viewport parameter keeps the default.
		expect(viewportFor({}, { viewport: 'mobile1' })).toEqual({ width: 1200, height: 900 });
		expect(
			viewportFor({ viewport: { disable: true } }, { viewport: { value: 'mobile1' } })
		).toEqual({ width: 1200, height: 900 });
		expect(
			viewportFor(
				{ viewport: { options: { wide: { styles: { width: '50vw', height: '2em' } } } } },
				{ viewport: { value: 'wide' } }
			)
		).toEqual({ width: 600, height: 32 });
	});

	it('reports fields the runtime does not compose and the play fields it does not provide', () => {
		expect(
			unsupportedFields('project', { decorators: [], loaders: [], beforeEach: undefined })
		).toEqual(['loaders']);
		expect(unsupportedFields('story', { play: () => {}, mount: () => {} })).toEqual(['mount']);
		expect(
			destructuredFields(async ({ canvasElement, mount: m }: Record<string, unknown>) => [
				canvasElement,
				m,
			])
		).toEqual(['canvasElement', 'mount']);
		expect(destructuredFields(async (context: unknown) => context)).toEqual([]);
	});
});
