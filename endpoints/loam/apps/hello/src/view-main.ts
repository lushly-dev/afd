/**
 * @fileoverview Hello as a sandboxed view (phase 1 specification, 6.2), compiled into `dist/main.html`.
 * Everything it knows is pushed to it or called for. The shell's tokens reach its stylesheet through
 * `connectView`, so a change of theme needs nothing here.
 */

import type { CommandResult } from '@lushly-dev/loam-sdk';
import { connectView } from '@lushly-dev/loam-sdk/view';

const text = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const view = await connectView({ name: 'hello', version: '0.1.0' });

function show(result: CommandResult): void {
	const data = result.data as { items?: unknown[]; greeting?: string } | undefined;
	if (!result.success) text('greeting').textContent = result.error?.message ?? 'It did not work.';
	if (data?.greeting !== undefined) text('greeting').textContent = data.greeting;
	if (data?.items !== undefined) text('count').textContent = `${data.items.length} greeted`;
}

function showSelection(id: string | null | undefined): void {
	text('selected').textContent = id ? `Selected: ${id}` : '';
}

const refresh = async (): Promise<void> => show(await view.client.call('hello-list'));

// `hello-list` is bound, and `hello-greet` is linked, from whichever interface calls it.
view.onToolResult((result) => {
	show(result);
	if ((result.data as { greeting?: string } | undefined)?.greeting !== undefined) void refresh();
});
/** What Hello greets with here, read through the `settings` grant (phase 4 specification, 3.8); the last read wins. */
let reads = 0;
async function readSettings(): Promise<void> {
	const read = ++reads;
	const got = await view.client.call<{ value?: unknown }>('setting-get', {
		section: 'hello.general',
		key: 'greeting',
	});
	if (read !== reads) return;
	const greeting = typeof got.data?.value === 'string' ? got.data.value : 'Hello';
	text('greets').textContent = `Greets with ${greeting}`;
}

view.onHostContext((changed) => {
	if ('dev.loam/selection' in changed) showSelection(changed['dev.loam/selection']);
	// Hello's own sections changed (3.8): read the greeting again.
	if (changed['dev.loam/settingsChanged']?.some((section) => section.startsWith('hello.')))
		void readSettings();
});
showSelection(view.hostContext['dev.loam/selection']);
void readSettings();

text('greet').addEventListener('submit', (event) => {
	event.preventDefault();
	const input = text('name') as HTMLInputElement;
	const name = input.value.trim();
	void view.client.call('hello-greet', name === '' ? {} : { name });
});
