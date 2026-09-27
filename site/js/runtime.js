// afd.dev is an AFD app. The page's demos run real commands on the
// @lushly-dev/afd-core registry (bundled in vendor/). The web UI, the
// terminal and the scripted agent all go through call(), and every result is
// broadcast to onCommand() listeners, which render it.

import {
	createCommandRegistry,
	failure,
	findSimilarTools,
	success,
} from './vendor/afd-core.js';

export const SECTIONS = [
	'top',
	'inversion',
	'problem',
	'workflow',
	'agent-ux',
	'result',
	'honesty',
	'build',
	'testing',
	'start',
	'get-started',
];

const INSTALL = {
	typescript: 'npm install @lushly-dev/afd-server @lushly-dev/afd-cli zod',
	python: 'pip install afd',
	rust: 'cargo add afd --git https://github.com/lushly-dev/afd',
	// CMake, not a registry: afd-cpp is fetched from the repo until afd-cpp-v0.1.0 is tagged.
	cpp: [
		'include(FetchContent)',
		'FetchContent_Declare(afd GIT_REPOSITORY https://github.com/lushly-dev/afd.git',
		'    GIT_TAG main SOURCE_SUBDIR packages/cpp)',
		'FetchContent_MakeAvailable(afd)',
	].join('\n'),
};

const EVERYWHERE = { palette: true, agent: true, cli: true };

// Mirrors afd-server's input validation failures, so the page's errors look
// exactly like the ones the real CLI prints.
function invalid(field, message, expected) {
	return failure({
		code: 'VALIDATION_ERROR',
		message: 'Input validation failed',
		suggestion: `${field}: ${message}. Expected fields: ${expected.join(', ')}`,
		retryable: false,
	});
}

const todos = [];
const listeners = new Set();
const hooks = {};

/** Let UI modules provide the side effects some commands need (scrolling, views). */
export function provide(name, fn) {
	hooks[name] = fn;
}

export function getTodos() {
	return [...todos];
}

const registry = createCommandRegistry();

registry.register({
	name: 'todo-create',
	description: 'Create a todo item from a title',
	category: 'todo',
	mutation: true,
	expose: EVERYWHERE,
	parameters: [
		{ name: 'title', type: 'string', description: 'What needs doing', required: true },
		{
			name: 'priority',
			type: 'string',
			description: 'How urgent it is',
			enum: ['low', 'medium', 'high'],
			default: 'medium',
		},
	],
	async handler(input = {}) {
		const title = typeof input.title === 'string' ? input.title.trim() : '';
		if (!title) return invalid('title', 'Title is required', ['title', 'priority']);
		if (title.length > 80) return invalid('title', 'Title too long (max 80)', ['title', 'priority']);
		const priority = input.priority ?? 'medium';
		if (!['low', 'medium', 'high'].includes(priority)) {
			return invalid('priority', 'Invalid option: expected one of "low"|"medium"|"high"', [
				'title',
				'priority',
			]);
		}
		const todo = {
			id: `todo-${Math.random().toString(16).slice(2, 6)}`,
			title,
			priority,
			completed: false,
		};
		todos.unshift(todo);
		return success(todo, {
			reasoning: `Created todo "${title}" with ${priority} priority`,
			confidence: 1,
		});
	},
});

registry.register({
	name: 'todo-list',
	description: 'List the todos created on this page',
	category: 'todo',
	expose: EVERYWHERE,
	parameters: [],
	async handler() {
		return success(
			{ todos: getTodos(), total: todos.length },
			{
				reasoning: todos.length
					? `${todos.length} todo${todos.length === 1 ? '' : 's'} in this tab`
					: 'No todos yet',
				confidence: 1,
				...(todos.length === 0 && {
					suggestions: ['Create one: afd call todo-create \'{"title":"Buy groceries"}\''],
				}),
			}
		);
	},
});

registry.register({
	name: 'todo-clear',
	description: 'Delete every todo on this page',
	category: 'todo',
	mutation: true,
	destructive: true,
	expose: EVERYWHERE,
	parameters: [],
	async handler() {
		const count = todos.length;
		todos.length = 0;
		return success(
			{ deleted: count },
			{
				reasoning: `Deleted ${count} todo${count === 1 ? '' : 's'}`,
				confidence: 1,
				warnings: count ? [{ code: 'DESTRUCTIVE', message: 'This cannot be undone' }] : undefined,
			}
		);
	},
});

registry.register({
	name: 'section-go',
	description: 'Scroll the page to a section',
	category: 'page',
	expose: EVERYWHERE,
	parameters: [
		{ name: 'section', type: 'string', description: 'Section id', required: true, enum: SECTIONS },
	],
	async handler(input = {}) {
		const { section } = input;
		if (!SECTIONS.includes(section)) {
			const close = findSimilarTools(String(section ?? ''), SECTIONS, 1)[0];
			return failure({
				code: 'NOT_FOUND',
				message: `No section called "${section ?? ''}"`,
				suggestion: close
					? `Did you mean "${close}"? Sections: ${SECTIONS.join(', ')}`
					: `Sections: ${SECTIONS.join(', ')}`,
				retryable: false,
			});
		}
		hooks.scrollTo?.(section);
		return success({ section }, { reasoning: `Scrolled to #${section}`, confidence: 1 });
	},
});

registry.register({
	name: 'install-copy',
	description: 'Copy the install command for a language',
	category: 'page',
	expose: EVERYWHERE,
	parameters: [
		{
			name: 'language',
			type: 'string',
			description: 'Which package to install',
			enum: Object.keys(INSTALL),
			default: 'typescript',
		},
	],
	async handler(input = {}) {
		const language = input.language ?? 'typescript';
		const command = INSTALL[language];
		if (!command) {
			return invalid('language', 'Invalid option: expected one of "typescript"|"python"|"rust"|"cpp"', [
				'language',
			]);
		}
		try {
			await navigator.clipboard.writeText(command);
		} catch {
			return failure({
				code: 'CLIPBOARD_BLOCKED',
				message: 'The browser did not allow clipboard access',
				suggestion: `Copy it by hand: ${command}`,
				retryable: true,
			});
		}
		return success({ language, command }, { reasoning: 'Copied to the clipboard', confidence: 1 });
	},
});

registry.register({
	name: 'view-set',
	description: 'Show the page as a person or as an agent reads it',
	category: 'page',
	expose: EVERYWHERE,
	parameters: [
		{ name: 'view', type: 'string', description: 'Which view', required: true, enum: ['human', 'agent'] },
	],
	async handler(input = {}) {
		if (!['human', 'agent'].includes(input.view)) {
			return invalid('view', 'Invalid option: expected one of "human"|"agent"', ['view']);
		}
		await hooks.setView?.(input.view);
		return success(
			{ view: input.view },
			{
				reasoning:
					input.view === 'agent' ? 'Showing llms.txt, the agent-readable page' : 'Back to the page',
				confidence: 1,
			}
		);
	},
});

registry.register({
	name: 'get-started',
	description: 'Everything you need to start with AFD',
	category: 'page',
	expose: EVERYWHERE,
	parameters: [],
	async handler() {
		return success(
			{
				install: INSTALL,
				quickstart: 'https://github.com/lushly-dev/afd#quickstart',
				forYourAgent: 'npx degit lushly-dev/afd/.claude/skills/afd .claude/skills/afd',
				source: 'https://github.com/lushly-dev/afd',
			},
			{
				reasoning:
					'Three ways in: install a package, follow the 5-minute quickstart, or teach your coding agent the patterns first.',
				confidence: 1,
				suggestions: ['Start with the quickstart: define one command and call it from the terminal'],
			}
		);
	},
});

/** Every command, for `afd tools`, the palette and tab completion. */
export function listCommands() {
	return registry.list();
}

/** Subscribe to every command call. Returns an unsubscribe function. */
export function onCommand(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const INTERFACE = { palette: 'palette', cli: 'cli', agent: 'agent' };

/**
 * Run a command through the registry.
 * @param {string} name
 * @param {unknown} input
 * @param {{ surface?: 'ui' | 'palette' | 'cli' | 'agent' }} [options]
 */
export async function call(name, input = {}, { surface = 'ui' } = {}) {
	const started = performance.now();
	const iface = INTERFACE[surface];
	let result = await registry.execute(name, input, iface ? { interface: iface } : undefined);

	// Like afd-server and DirectClient, answer an unknown name with the closest matches.
	if (!result.success && result.error?.code === 'COMMAND_NOT_FOUND') {
		const names = registry.list().map((command) => command.name);
		const similar = findSimilarTools(String(name), names, 2);
		if (similar.length) {
			result = failure({
				...result.error,
				suggestion: `Did you mean ${similar.map((n) => `'${n}'`).join(' or ')}? Run 'afd tools' to see every command.`,
			});
		}
	}

	const entry = {
		name,
		input,
		surface,
		result,
		ms: performance.now() - started,
		at: new Date(),
	};
	for (const listener of listeners) {
		try {
			listener(entry);
		} catch (error) {
			console.error('[afd.dev] command listener failed', error);
		}
	}
	return result;
}
