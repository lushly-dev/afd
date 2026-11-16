/**
 * @fileoverview DirectClient with the to-do commands, no model and no server: what the copilot's
 * tool list is in each mode, what `allow` refuses, and an approval asked for and answered.
 *
 * Run: pnpm demo
 */

import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { Copilot, type CopilotModel } from './copilot.js';
import { createCopilotRegistry } from './registry.js';

// The middleware logs each call to stderr, as the server does; keep this output readable
console.error = () => {};

const store = new TodoStore();
setStore(store);

/** No model is called: the demo drives the copilot's clients itself. */
const noModel: CopilotModel = {
	respond: async () => ({ text: '', calls: [] }),
};
const copilot = new Copilot({
	registry: createCopilotRegistry({}),
	model: noModel,
	onApprovalNeeded: async ({ command, summary }) => {
		console.log(`  Approval asked for ${command}: "${summary}"; approving`);
		return true;
	},
});

console.log(
	'Tools in change mode:',
	copilot
		.tools('change')
		.map((tool) => tool.name)
		.join(', ')
);
console.log(
	'Tools in look mode:  ',
	copilot
		.tools('look')
		.map((tool) => tool.name)
		.join(', ')
);

const change = copilot.client('change');
const look = copilot.client('look');

const created = await change.call<{ id: string }>('todo-create', {
	title: 'Call the plumber',
	priority: 'high',
});
console.log('\nchange: todo-create ->', created.success ? created.data : created.error);
const id = created.data && 'id' in created.data ? created.data.id : undefined;
if (id) await change.call('todo-toggle', { id });

const refused = await look.call('todo-create', { title: 'Not in look mode' });
console.log('look:   todo-create ->', refused.error?.code, '-', refused.error?.suggestion);

console.log('\nchange: todo-clear (held for approval)');
const cleared = await change.call('todo-clear', {});
console.log('  ->', cleared.success ? cleared.data : cleared.error?.code);

const history = await look.call<{
	entries: { command: string; actor: { kind: string; id?: string } }[];
}>('todo-history', {});
console.log('\nlook:   todo-history ->');
const entries = history.data && 'entries' in history.data ? history.data.entries : [];
for (const entry of entries) {
	console.log(`  ${entry.command} by ${entry.actor.kind} ${entry.actor.id ?? ''}`);
}
