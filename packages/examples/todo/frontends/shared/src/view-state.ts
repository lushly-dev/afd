/**
 * @fileoverview The page's view state, as commands an agent can call: one view, `todo-filter`,
 * which the list on screen follows. A person changes it with the filter controls and an agent
 * with `view-state-set`, through the same registry, so what the agent sets is what the person
 * sees (job 6, `scenarios/06-narrow-the-view.scenario.yaml`).
 *
 * The commands run in the page through `createDirectRegistry` (browser-safe), never on the
 * server: view state is the page's, not the store's. Phase 4's copilot calls them here.
 */

import { type CommandMiddleware, failure } from '@lushly-dev/afd-core';
import { createDirectRegistry, type DirectCommandRegistry } from '@lushly-dev/afd-server/direct';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';

export type StatusFilter = 'all' | 'pending' | 'completed';
export type PriorityFilter = 'all' | 'low' | 'medium' | 'high';

/** What the list shows. */
export interface TodoFilter extends Record<string, unknown> {
	status: StatusFilter;
	priority: PriorityFilter;
	search: string;
}

export const FILTER_VIEW = 'todo-filter';

export const DEFAULT_FILTER: TodoFilter = { status: 'all', priority: 'all', search: '' };

const STATUSES: readonly StatusFilter[] = ['all', 'pending', 'completed'];
const PRIORITIES: readonly PriorityFilter[] = ['all', 'low', 'medium', 'high'];

/** The filter as `todo-list` input: `completed`, `priority` and `search`, each only when set. */
export function listInput(filter: TodoFilter): Record<string, unknown> {
	return {
		...(filter.status !== 'all' && { completed: filter.status === 'completed' }),
		...(filter.priority !== 'all' && { priority: filter.priority }),
		...(filter.search.trim() !== '' && { search: filter.search.trim() }),
	};
}

/**
 * The values `todo-filter` takes that the list does not know, as `field: value` lines; empty when
 * every value is known.
 */
function unknownValues(state: Record<string, unknown>): string[] {
	const problems: string[] = [];
	for (const [key, value] of Object.entries(state)) {
		if (key === 'status' && !STATUSES.includes(value as StatusFilter))
			problems.push(`status: ${String(value)}`);
		else if (key === 'priority' && !PRIORITIES.includes(value as PriorityFilter))
			problems.push(`priority: ${String(value)}`);
		else if (key === 'search' && typeof value !== 'string')
			problems.push(`search: ${String(value)}`);
		else if (key !== 'status' && key !== 'priority' && key !== 'search')
			problems.push(`${key}: not a field`);
	}
	return problems;
}

/**
 * Refuse a `view-state-set` on `todo-filter` with a value the list does not know, with the values
 * it takes, rather than accept it and leave the view unchanged without saying so.
 */
const checkFilter: CommandMiddleware = async (command, input, _context, next) => {
	const { id, state } = (input ?? {}) as { id?: unknown; state?: unknown };
	if (
		command === 'view-state-set' &&
		id === FILTER_VIEW &&
		typeof state === 'object' &&
		state !== null
	) {
		const problems = unknownValues(state as Record<string, unknown>);
		if (problems.length > 0) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: `todo-filter does not take ${problems.join(', ')}`,
				suggestion: `Use status ${STATUSES.join(' | ')}, priority ${PRIORITIES.join(' | ')} and a search string`,
			});
		}
	}
	return next();
};

/** Keep only known values: the registry's last line of defence behind {@link checkFilter}. */
function clean(next: Partial<TodoFilter>, base: TodoFilter): TodoFilter {
	return {
		status: STATUSES.includes(next.status as StatusFilter)
			? (next.status as StatusFilter)
			: base.status,
		priority: PRIORITIES.includes(next.priority as PriorityFilter)
			? (next.priority as PriorityFilter)
			: base.priority,
		search: typeof next.search === 'string' ? next.search : base.search,
	};
}

/**
 * The page's view state: the filter, its registry and the direct registry that serves
 * `view-state-get`, `view-state-set` and `view-state-list`.
 */
export class TodoViewState {
	readonly registry = new ViewStateRegistry();
	readonly commands: DirectCommandRegistry;
	private filter: TodoFilter = { ...DEFAULT_FILTER };
	private readonly listeners = new Set<(filter: TodoFilter) => void>();

	constructor() {
		this.registry.register(FILTER_VIEW, {
			get: () => ({ ...this.filter }),
			set: (partial) => this.apply(clean(partial as Partial<TodoFilter>, this.filter)),
			replace: (state) => this.apply(clean(state as Partial<TodoFilter>, DEFAULT_FILTER)),
		});
		this.commands = createDirectRegistry(createViewStateCommands(this.registry), {
			middleware: [checkFilter],
		});
	}

	get current(): TodoFilter {
		return { ...this.filter };
	}

	/** A person's change from the filter controls: the same path an agent's takes. */
	set(partial: Partial<TodoFilter>): void {
		this.registry.set(FILTER_VIEW, partial);
	}

	/** Called with the new filter after every change, a person's or an agent's. */
	subscribe(listener: (filter: TodoFilter) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private apply(next: TodoFilter): void {
		const changed = JSON.stringify(next) !== JSON.stringify(this.filter);
		this.filter = next;
		if (changed) for (const listener of this.listeners) listener({ ...next });
	}
}
