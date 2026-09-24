/**
 * Types for `render.js`, which the browser loads directly (no build step).
 * The backend's `render.test.ts` imports the module through these declarations.
 */

/** The subset of `Document` the builders use. */
export interface DocumentLike<E extends ElementLike = ElementLike> {
	createElement(tagName: string): E;
	createTextNode(text: string): unknown;
}

/** The subset of `HTMLElement` the builders use. */
export interface ElementLike {
	className: string;
	textContent: string | null;
	append(...nodes: unknown[]): void;
	setAttribute(name: string, value: string): void;
	addEventListener(
		type: string,
		listener: (event: { key?: string; preventDefault(): void }) => void
	): void;
}

export interface TodoView {
	id: string;
	title?: string;
	completed?: boolean;
	priority?: string;
}

export interface LogEntryView {
	time: string;
	command: string;
	latency: string;
	success: boolean;
}

export interface ToolExecutionView {
	name?: string;
	latencyMs?: number;
}

export interface ChatMessageView {
	role: string;
	text?: string;
	tools?: ToolExecutionView[];
	toolLatency?: number;
	modelLatency?: number;
}

export function safePriority(priority: unknown): 'low' | 'medium' | 'high';
export function renderTodoItem<E extends ElementLike>(
	doc: DocumentLike<E>,
	todo: TodoView,
	onToggle: (id: string) => void
): E;
export function renderEmpty<E extends ElementLike>(doc: DocumentLike<E>, text: string): E;
export function renderLogEntry<E extends ElementLike>(doc: DocumentLike<E>, entry: LogEntryView): E;
export function renderChatMessage<E extends ElementLike>(
	doc: DocumentLike<E>,
	message: ChatMessageView
): E;
