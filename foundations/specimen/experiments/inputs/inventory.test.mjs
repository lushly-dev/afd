import { describe, expect, it } from 'vitest';
import { analyzeStoryModule } from './csf.mjs';
import { buildInventory } from './inventory.mjs';

const source = `
import { shared } from './shared';
export default {
	title: 'Components/Field',
	play: async ({ canvasElement }) => {},
	parameters: { a11y: { config: { rules: [] } } },
	globals: { theme: 'light' },
};
export const Inherits = {};
export const Disabled = { play: undefined };
export const Override = { parameters: { a11y: { test: 'todo' } }, globals: { viewport: 'mobile1' } };
export const Spread = { ...shared };
export const Built = makeStory();
`;
const project = {
	a11y: { test: 'error' },
	includeTags: ['test'],
	excludeTags: [],
	skipTags: ['skip'],
};
const entry = (exportName, tags = ['test']) => ({
	type: 'story',
	id: `components-field--${exportName.toLowerCase()}`,
	title: 'Components/Field',
	name: exportName,
	exportName,
	importPath: './field.stories.ts',
	tags,
});

describe('buildInventory', () => {
	const inventory = buildInventory({
		consumer: 'fixture',
		index: {
			v: 5,
			entries: Object.fromEntries(
				[
					entry('Inherits'),
					entry('Disabled', ['test', 'skip']),
					entry('Override'),
					entry('Spread'),
					entry('Built'),
				].map((item) => [item.id, item])
			),
		},
		files: { './field.stories.ts': { sha256: 'x', analysis: analyzeStoryModule(source) } },
		project,
	});
	const byName = Object.fromEntries(inventory.stories.map((story) => [story.exportName, story]));

	it('inherits meta plays and honours an explicit removal', () => {
		expect(byName.Inherits.play).toMatchObject({ source: 'meta' });
		expect(byName.Disabled.play).toBeNull();
	});

	it('does not let meta values stand in for unreadable stories', () => {
		for (const name of ['Spread', 'Built']) {
			expect(byName[name].play).toEqual({ source: 'unresolved' });
			expect(byName[name].a11y).toEqual({ source: 'unresolved' });
			expect(byName[name].render).toBe('unresolved');
		}
	});

	it('key-merges a11y parameters and globals across project, meta and story', () => {
		expect(byName.Inherits.a11y).toEqual({
			source: 'meta',
			sources: ['project', 'meta'],
			value: { test: 'error', config: { rules: [] } },
		});
		expect(byName.Override.a11y.value).toEqual({ test: 'todo', config: { rules: [] } });
		expect(byName.Override.globals.value).toEqual({ theme: 'light', viewport: 'mobile1' });
	});

	it('counts unknown plays apart from smoke-only and excludes skipped stories', () => {
		expect(inventory.summary).toMatchObject({
			stories: 5,
			withPlay: 2,
			playUnknown: 2,
			smokeOnly: 0,
			skipped: 1,
			unresolvedStories: 2,
		});
	});
});
