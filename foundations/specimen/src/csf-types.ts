/**
 * The types a retained story and preview are written against, so neither needs Storybook's.
 * Each describes what `browser/story-runtime.ts` provides, and no more: a play reaching for
 * `canvas`, `mount` or `userEvent` from its context fails validation there, and fails here too.
 */

// Values are whatever a story says, as they are in Storybook, whose default this matches.
// biome-ignore lint/suspicious/noExplicitAny: a story with no declared args reads them untyped.
export type Args = Record<string, any>;

export interface StoryContext<TArgs = Args> {
	id: string;
	name: string;
	story: string;
	title: string;
	kind: string;
	componentId: string;
	component?: string;
	tags: string[];
	parameters: Record<string, unknown>;
	initialArgs: Partial<TArgs>;
	args: TArgs;
	argTypes: Record<string, unknown>;
	// biome-ignore lint/suspicious/noExplicitAny: globals are the project's own, undeclared here.
	globals: Record<string, any>;
	storyGlobals: Record<string, unknown>;
	loaded: Record<string, unknown>;
	viewMode: 'story';
	abortSignal: AbortSignal;
	canvasElement: HTMLElement;
	step(label: string, play: (context: StoryContext<TArgs>) => unknown): Promise<void> | void;
	context: StoryContext<TArgs>;
}

export type Decorator<TArgs = Args> = (
	story: (update?: Partial<StoryContext<TArgs>>) => unknown,
	context: StoryContext<TArgs>
) => unknown;

/** What a project, a meta and a story can each declare. */
interface Annotations<TArgs> {
	args?: Partial<TArgs>;
	argTypes?: { [K in keyof TArgs]?: Record<string, unknown> } & Record<string, unknown>;
	parameters?: Record<string, unknown>;
	decorators?: Decorator<TArgs> | Decorator<TArgs>[];
	loaders?: unknown;
	beforeEach?: (context: StoryContext<TArgs>) => unknown;
	render?: (args: TArgs, context: StoryContext<TArgs>) => unknown;
	play?: (context: StoryContext<TArgs>) => Promise<void> | void;
	tags?: string[];
	globals?: Record<string, unknown>;
}

export interface Meta<TArgs = Args> extends Annotations<TArgs> {
	title?: string;
	id?: string;
	component?: string;
	subcomponents?: Record<string, unknown>;
	includeStories?: string[] | RegExp;
	excludeStories?: string[] | RegExp;
}

interface Story<TArgs> extends Annotations<TArgs> {
	name?: string;
	storyName?: string;
	id?: string;
}

/**
 * `StoryObj<Args>`, or `StoryObj<typeof meta>`, which takes the args from the meta. An args type
 * that happens to share a field with `Meta`, such as `title`, infers nothing and stays args.
 */
export type StoryObj<T = Args> =
	T extends Meta<infer TArgs> ? (unknown extends TArgs ? Story<T> : Story<TArgs>) : Story<T>;

export interface Preview extends Annotations<Args> {
	initialGlobals?: Record<string, unknown>;
	globalTypes?: Record<string, unknown>;
}
