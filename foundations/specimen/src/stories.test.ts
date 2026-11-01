import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STORY_FILES,
	type Discovery,
	normalizeSpecifier,
	validateDiscovery,
} from './stories.js';
import type { SpecimenEntry } from './types.js';

const root = resolve(import.meta.dirname, '../compat');

describe('stories specifiers', () => {
	it('split a glob at its first glob segment, as Storybook does', () => {
		expect(normalizeSpecifier('../apps/web/src/components/**/*.stories.ts', root)).toEqual({
			directory: '../apps/web/src/components',
			files: '**/*.stories.ts',
			titlePrefix: '',
		});
		expect(normalizeSpecifier('*.stories.ts', root)).toEqual({
			directory: '.',
			files: '*.stories.ts',
			titlePrefix: '',
		});
		expect(normalizeSpecifier('src/{a,b}/x.stories.ts', root).directory).toBe('src');
	});

	it('read a directory as its default CSF pattern and a file as itself', () => {
		expect(normalizeSpecifier('stories', root)).toEqual({
			directory: 'stories',
			files: DEFAULT_STORY_FILES,
			titlePrefix: '',
		});
		expect(normalizeSpecifier('stories/ordered.stories.ts', root)).toEqual({
			directory: 'stories',
			files: 'ordered.stories.ts',
			titlePrefix: '',
		});
		expect(normalizeSpecifier({ directory: 'src', titlePrefix: 'Lib' }, root)).toEqual({
			directory: 'src',
			files: DEFAULT_STORY_FILES,
			titlePrefix: 'Lib',
		});
	});
});

function story(
	id: string,
	overrides: Partial<NonNullable<SpecimenEntry['story']>> = {}
): SpecimenEntry {
	return {
		id,
		title: 'Fixtures/Validation',
		module: './stories/validation.stories.ts',
		exportName: id,
		story: {
			name: id,
			tags: ['dev', 'test', 'manifest'],
			play: 'absent',
			unresolved: [],
			annotations: { meta: ['title'], story: ['args'] },
			...overrides,
		},
	};
}
function discovery(overrides: Partial<Discovery> = {}): Discovery {
	return {
		entries: [],
		projectTags: ['dev', 'test', 'manifest'],
		projectAnnotations: ['parameters', 'decorators'],
		errors: [],
		warnings: [],
		files: [],
		...overrides,
	};
}

describe('static story validation', () => {
	it('passes indexable stories whose annotations compatibility mode runs', () => {
		const report = validateDiscovery(discovery({ entries: [story('a'), story('b')] }), root);
		expect(report).toEqual({ valid: true, scope: 'static', checked: 2, issues: [] });
	});

	it('fails on discovery errors and unsupported annotations at any level', () => {
		const report = validateDiscovery(
			discovery({
				projectAnnotations: ['parameters', 'beforeAll'],
				errors: [
					{
						importPath: './stories/a.stories.ts',
						exportName: 'Primary',
						code: 'DUPLICATE_ID',
						message: "Duplicate stories with id 'x--primary'",
					},
				],
				entries: [story('a', { annotations: { meta: ['loaders'], story: ['mount', 'args'] } })],
			}),
			root
		);
		expect(report.valid).toBe(false);
		expect(report.issues.map((issue) => [issue.severity, issue.code, issue.field])).toEqual([
			['error', 'DUPLICATE_ID', undefined],
			['error', 'UNSUPPORTED_ANNOTATION', 'beforeAll'],
			['error', 'UNSUPPORTED_ANNOTATION', 'meta.loaders'],
			['error', 'UNSUPPORTED_ANNOTATION', 'story.mount'],
		]);
		for (const issue of report.issues) expect(issue.suggestion).not.toBe('');
	});

	it('defers what only running the module can settle', () => {
		const report = validateDiscovery(
			discovery({
				projectAnnotations: ['*'],
				entries: [
					story('made', {
						play: 'unknown',
						unresolved: [{ level: 'story', field: '*', reason: 'the result of `make(...)`' }],
					}),
				],
			}),
			root
		);
		expect(report.valid).toBe(true);
		expect(report.issues.map((issue) => [issue.severity, issue.code, issue.field])).toEqual([
			['deferred', 'UNRESOLVED_PROJECT_ANNOTATIONS', undefined],
			['deferred', 'UNRESOLVED_ANNOTATION', 'story.*'],
		]);
	});

	it('narrows to one story or one file', () => {
		const other = { ...story('other'), module: './stories/other.stories.ts' };
		const all = discovery({
			entries: [story('a', { annotations: { meta: [], story: ['loaders'] } }), other],
			warnings: [{ importPath: './stories/other.stories.ts', code: 'NO_STORIES', message: 'x' }],
		});
		expect(validateDiscovery(all, root, { id: 'other' })).toMatchObject({
			valid: true,
			checked: 1,
		});
		const file = validateDiscovery(all, root, { file: 'stories/other.stories.ts' });
		expect(file.checked).toBe(1);
		expect(file.issues.map((issue) => issue.code)).toEqual(['NO_STORIES']);
		expect(validateDiscovery(all, root, { id: 'a' }).valid).toBe(false);
	});
});
