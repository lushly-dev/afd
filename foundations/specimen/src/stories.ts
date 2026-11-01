import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { HostProcess } from './host.js';
import type {
	BenchConfig,
	SpecimenEntry,
	StoriesSpecifier,
	StoryIdentity,
	ValidationIssue,
	ValidationReport,
	ValidationTarget,
} from './types.js';

/**
 * CSF compatibility mode, discovery: the retained stories a configuration names, with the
 * identities Storybook's index gives them. The native host reads the files statically
 * (`host/src/csf`); no story module runs.
 */

/** Storybook's default files pattern, for CSF files only: MDX docs are not stories. */
export const DEFAULT_STORY_FILES = '**/*.stories.{js,jsx,mjs,ts,tsx}';
const GLOB_SEGMENT = /[*?[\]{}]|[@!+]\(/;
const EXTGLOB = /[@!+*?]\(/;

/** Storybook's `normalizeStoriesEntry`: a glob splits at its first glob segment. */
export function normalizeSpecifier(
	entry: string | StoriesSpecifier,
	base: string
): Required<StoriesSpecifier> {
	if (typeof entry !== 'string')
		return {
			directory: entry.directory,
			files: entry.files ?? DEFAULT_STORY_FILES,
			titlePrefix: entry.titlePrefix ?? '',
		};
	const segments = entry.split('/');
	const glob = segments.findIndex((segment) => GLOB_SEGMENT.test(segment));
	if (glob >= 0)
		return {
			directory: segments.slice(0, glob).join('/') || '.',
			files: segments.slice(glob).join('/'),
			titlePrefix: '',
		};
	const path = resolve(base, entry);
	if (existsSync(path) && statSync(path).isDirectory())
		return { directory: entry, files: DEFAULT_STORY_FILES, titlePrefix: '' };
	return { directory: dirname(entry), files: basename(entry), titlePrefix: '' };
}

export interface DiscoveryProblem {
	importPath?: string;
	exportName?: string;
	code: string;
	message: string;
}
export interface Discovery {
	entries: SpecimenEntry[];
	/** Storybook's default project tags and the preview's own. */
	projectTags: string[];
	/** The fields the project annotations set; `*` when not all are readable. */
	projectAnnotations: string[];
	errors: DiscoveryProblem[];
	warnings: DiscoveryProblem[];
	/** Every file discovery read. */
	files: string[];
}

interface HostEntry extends StoryIdentity {
	id: string;
	title: string;
	importPath: string;
	exportName: string;
	component?: string;
}
interface HostIndex {
	entries: HostEntry[];
	projectTags: string[];
	projectAnnotations: string[];
	errors: DiscoveryProblem[];
	warnings: DiscoveryProblem[];
	files: string[];
}

const INDEX_TIMEOUT = 60_000;

/** Index the configuration's stories in a short-lived host process. */
export async function discoverStories(
	root: string,
	base: string,
	config: BenchConfig
): Promise<Discovery> {
	const specifiers = (config.stories ?? []).map((entry) => normalizeSpecifier(entry, base));
	const errors: DiscoveryProblem[] = specifiers
		.filter((specifier) => EXTGLOB.test(specifier.files))
		.map((specifier) => ({
			code: 'UNSUPPORTED_GLOB',
			message: `Stories pattern '${specifier.files}' uses an extended glob; write it with braces, for example '**/*.stories.{ts,tsx}'`,
		}));
	if (errors.length)
		return {
			entries: [],
			projectTags: [],
			projectAnnotations: [],
			errors,
			warnings: [],
			files: [],
		};
	const host = new HostProcess();
	let index: HostIndex;
	try {
		index = (await host.request(
			'index',
			{ root, base, stories: specifiers, preview: config.preview ?? null },
			INDEX_TIMEOUT
		)) as HostIndex;
	} finally {
		await host.close();
	}
	return {
		entries: index.entries.map(
			({ id, title, importPath, exportName, component, ...story }): SpecimenEntry => ({
				id,
				title,
				module: importPath,
				exportName,
				...(component === undefined ? {} : { component }),
				story: {
					name: story.name,
					tags: story.tags,
					play: story.play,
					unresolved: story.unresolved,
					annotations: story.annotations,
				},
			})
		),
		projectTags: index.projectTags,
		projectAnnotations: index.projectAnnotations,
		errors: index.errors,
		warnings: index.warnings,
		files: index.files,
	};
}

/**
 * Annotations whose behavior the compatibility runtime does not reproduce. A story that uses
 * one fails validation rather than running without it.
 */
export const UNSUPPORTED_ANNOTATIONS = [
	'loaders',
	'beforeAll',
	'beforeEach',
	'afterEach',
	'experimental_afterEach',
	'mount',
	'runStep',
	'argsEnhancers',
	'argTypesEnhancers',
	'renderToCanvas',
	'applyDecorators',
	'decorateStory',
] as const;

const SUGGESTIONS: Record<string, string> = {
	DUPLICATE_ID:
		'Give one of the stories a distinct export name, `name` or meta `id`; Storybook keys flake records and links by story id.',
	UNINDEXABLE_FILE:
		'Make the meta a statically readable object with a string-literal title, as Storybook requires, then validate again.',
	UNREADABLE_FILE: 'Check the path and file permissions, then validate again.',
	UNREADABLE_PROJECT: 'Fix the project annotations module so it parses, then validate again.',
	UNREADABLE_PROJECT_TAGS: 'Write the project tags inline as an array of string literals.',
	OUTSIDE_ROOT: 'Keep story files inside the bench root, or move the root up.',
	UNSUPPORTED_GLOB: 'Rewrite the pattern with braces instead of an extended glob.',
	NO_STORIES: 'Remove the file from the stories pattern or export a story from it.',
};

function matches(entry: SpecimenEntry, target: ValidationTarget | undefined, root: string) {
	if (!target) return true;
	if (target.id !== undefined && entry.id !== target.id) return false;
	if (target.file !== undefined && !sameFile(entry.module, target.file, root)) return false;
	return true;
}
function sameFile(importPath: string, file: string, root: string): boolean {
	return resolve(root, importPath) === resolve(root, file);
}

/** Static validation of discovered stories: format, identity, annotation support and what runtime must settle. */
export function validateDiscovery(
	discovery: Discovery,
	root: string,
	target?: ValidationTarget
): ValidationReport {
	const issues: ValidationIssue[] = [];
	const fileMatches = (importPath?: string) =>
		!target ||
		(target.id === undefined &&
			(target.file === undefined ||
				(importPath !== undefined && sameFile(importPath, target.file, root))));
	for (const [severity, problems] of [
		['error', discovery.errors],
		['warning', discovery.warnings],
	] as const) {
		for (const problem of problems) {
			if (target && !fileMatches(problem.importPath)) {
				// Identity problems also concern the story they name.
				if (
					!(
						target.id &&
						problem.code === 'DUPLICATE_ID' &&
						problem.message.includes(`id: ${target.id} `)
					)
				)
					continue;
			}
			issues.push({
				severity,
				code: problem.code,
				message: problem.message,
				suggestion: SUGGESTIONS[problem.code] ?? 'Fix the reported problem and validate again.',
				...(problem.importPath === undefined ? {} : { importPath: problem.importPath }),
				...(problem.exportName === undefined ? {} : { exportName: problem.exportName }),
			});
		}
	}
	const project = new Set(discovery.projectAnnotations);
	const entries = discovery.entries.filter((entry) => entry.story && matches(entry, target, root));
	if (!target || entries.length) {
		for (const annotation of UNSUPPORTED_ANNOTATIONS)
			if (project.has(annotation))
				issues.push({
					severity: 'error',
					code: 'UNSUPPORTED_ANNOTATION',
					field: annotation,
					message: `The project annotations set \`${annotation}\`, which compatibility mode does not run`,
					suggestion: `Move the \`${annotation}\` behavior into a decorator or the story's render, or keep these stories on Storybook until it is supported.`,
				});
		if (project.has('*'))
			issues.push({
				severity: 'deferred',
				code: 'UNRESOLVED_PROJECT_ANNOTATIONS',
				message: 'The project annotations set fields that cannot be read statically',
				suggestion: 'Run the stories to settle which annotations the project sets.',
			});
	}
	for (const entry of entries) {
		const story = entry.story as StoryIdentity;
		const where = { id: entry.id, importPath: entry.module, exportName: entry.exportName };
		for (const [level, fields] of [
			['meta', story.annotations.meta],
			['story', story.annotations.story],
		] as const) {
			for (const annotation of UNSUPPORTED_ANNOTATIONS)
				if (fields.includes(annotation))
					issues.push({
						severity: 'error',
						code: 'UNSUPPORTED_ANNOTATION',
						field: `${level}.${annotation}`,
						message: `${entry.id}: the ${level} sets \`${annotation}\`, which compatibility mode does not run`,
						suggestion: `Move the \`${annotation}\` behavior into the story's render or play, or keep this story on Storybook until it is supported.`,
						...where,
					});
		}
		for (const item of story.unresolved)
			issues.push({
				severity: 'deferred',
				code: 'UNRESOLVED_ANNOTATION',
				field: `${item.level}.${item.field}`,
				message: `${entry.id}: ${item.level} ${item.field === '*' ? 'fields' : `\`${item.field}\``} cannot be read statically (${item.reason})`,
				suggestion:
					'Run the story to settle the value, or write it as a literal so discovery can read it.',
				...where,
			});
	}
	return {
		valid: !issues.some((issue) => issue.severity === 'error'),
		scope: 'static',
		checked: entries.length,
		issues,
	};
}
