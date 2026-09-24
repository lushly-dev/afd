/**
 * The frontend's render helpers (`frontend/render.js`) must never turn
 * untrusted strings into markup. These tests run them against a minimal fake
 * DOM whose `innerHTML`/`outerHTML` setters throw, so any HTML parsing path fails.
 */

import { describe, expect, it } from 'vitest';
import {
	type ElementLike,
	renderChatMessage,
	renderLogEntry,
	renderTodoItem,
	safePriority,
} from '../../frontend/render.js';

type Listener = (event: { key?: string; preventDefault(): void }) => void;

class FakeText {
	constructor(readonly text: string) {}
}

class FakeElement implements ElementLike {
	className = '';
	readonly attributes = new Map<string, string>();
	readonly listeners = new Map<string, Listener[]>();
	children: Array<FakeElement | FakeText> = [];

	constructor(readonly tagName: string) {}

	get textContent(): string {
		return this.children
			.map((child) => (child instanceof FakeText ? child.text : child.textContent))
			.join('');
	}

	set textContent(value: string | null) {
		this.children = [new FakeText(value ?? '')];
	}

	set innerHTML(_value: string) {
		throw new Error('render helpers must not assign innerHTML');
	}

	set outerHTML(_value: string) {
		throw new Error('render helpers must not assign outerHTML');
	}

	insertAdjacentHTML(): never {
		throw new Error('render helpers must not call insertAdjacentHTML');
	}

	append(...nodes: unknown[]): void {
		for (const node of nodes) {
			if (node instanceof FakeElement || node instanceof FakeText) this.children.push(node);
			else throw new Error(`append() received a ${typeof node}; strings would be text anyway`);
		}
	}

	setAttribute(name: string, value: string): void {
		if (/^on/i.test(name)) throw new Error(`inline handler attribute ${name}`);
		this.attributes.set(name, value);
	}

	addEventListener(type: string, listener: Listener): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	/** Every element in this subtree, including this one. */
	all(): FakeElement[] {
		return [
			this,
			...this.children.flatMap((child) => (child instanceof FakeElement ? child.all() : [])),
		];
	}

	find(className: string): FakeElement | undefined {
		return this.all().find((element) => element.className.split(' ').includes(className));
	}
}

const doc = {
	createElement: (tag: string) => new FakeElement(tag),
	createTextNode: (text: string) => new FakeText(text),
};

const PAYLOADS = [
	'<img src=x onerror=alert(1)>',
	'<script>alert(1)</script>',
	'"><svg onload=alert(1)>',
	"'); alert(1); ('",
];

describe('renderTodoItem', () => {
	it.each(PAYLOADS)('shows the title %s as text', (title) => {
		const item = renderTodoItem(doc, { id: 't1', title, priority: 'high' }, () => {});

		expect(item.find('todo-title')?.textContent).toBe(title);
		expect(item.all().map((element) => element.tagName)).toEqual(['div', 'div', 'span', 'span']);
		expect([...item.attributes.keys()].some((name) => name.startsWith('on'))).toBe(false);
	});

	it('passes the id to the handler instead of building inline script from it', () => {
		const toggled: string[] = [];
		const id = "x'); alert(1); ('";
		const item = renderTodoItem(doc, { id, title: 'Task' }, (value) => toggled.push(value));

		for (const listener of item.listeners.get('click') ?? []) {
			listener({ preventDefault() {} });
		}
		for (const listener of item.listeners.get('keydown') ?? []) {
			listener({ key: 'Enter', preventDefault() {} });
		}

		expect(toggled).toEqual([id, id]);
	});

	it('only uses known priorities in class names', () => {
		const item = renderTodoItem(
			doc,
			{ id: 't1', title: 'Task', priority: 'high" onmouseover="alert(1)' },
			() => {}
		);
		expect(item.find('priority-badge')?.className).toBe('priority-badge priority-medium');
		expect(safePriority('low')).toBe('low');
		expect(safePriority(undefined)).toBe('medium');
	});
});

describe('renderChatMessage', () => {
	it.each(PAYLOADS)('shows the model reply %s as text', (text) => {
		const message = renderChatMessage(doc, { role: 'assistant', text });

		expect(message.find('chat-text')?.textContent).toBe(text);
		expect(message.all()).toHaveLength(2);
	});

	it('shows tool names as text', () => {
		const message = renderChatMessage(doc, {
			role: 'assistant',
			text: 'Done',
			tools: [{ name: '<img src=x onerror=alert(1)>', latencyMs: 0.01234 }],
			toolLatency: 0.01234,
			modelLatency: 321.4,
		});

		expect(message.find('tool-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
		expect(message.find('tool-latency')?.textContent).toBe('0.012ms');
		expect(message.find('latency-summary')?.textContent).toBe(
			'🧠 Gemini: 321ms | ⚡ DirectClient: 0.012ms'
		);
	});

	it('restricts the role to known classes', () => {
		const message = renderChatMessage(doc, { role: 'assistant x" onclick="alert(1)', text: '' });
		expect(message.className).toBe('chat-message system');
	});
});

describe('renderLogEntry', () => {
	it('shows the command name as text', () => {
		const entry = renderLogEntry(doc, {
			time: '12:00:00',
			command: '<b>todo-list</b>',
			latency: '0.010',
			success: false,
		});

		expect(entry.find('log-cmd')?.textContent).toBe('<b>todo-list</b>');
		expect(entry.find('log-fail')?.textContent).toBe('✗');
	});
});
