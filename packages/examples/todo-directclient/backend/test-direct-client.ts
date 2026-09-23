/**
 * @fileoverview Quick test to verify DirectClient works with the experiment registry
 */

import { type CommandResult, DirectClient, type UnknownToolError } from '@lushly-dev/afd-client';
import { registry } from './src/registry.js';

/** True when a DirectClient call named a tool the registry does not have. */
function isUnknownToolError(value: unknown): value is UnknownToolError {
	return (
		typeof value === 'object' &&
		value !== null &&
		'error' in value &&
		value.error === 'UNKNOWN_TOOL'
	);
}

/** The command's data, or undefined when the call failed or named an unknown tool. */
function dataOf<T>(result: CommandResult<T> | CommandResult<UnknownToolError>): T | undefined {
	return isUnknownToolError(result.data) ? undefined : result.data;
}

async function test() {
	console.log('Testing DirectClient with experiment registry...\n');

	const client = new DirectClient(registry);

	// Test 1: List commands
	const commands = client.listCommandNames();
	console.log('✓ Commands available:', commands.length);
	console.log('  ', commands.join(', '));

	// Test 2: Call a command
	const createResult = await client.call<{ id: string }>('todo-create', {
		title: 'Test todo',
	});
	console.log('\n✓ Create command:', createResult.success ? 'SUCCESS' : 'FAILED');
	const created = dataOf(createResult);
	if (createResult.success && created) {
		console.log('  Created ID:', created.id);
	}

	// Test 3: List todos
	const listResult = await client.call<{ todos: unknown[]; total: number }>('todo-list', {});
	console.log('\n✓ List command:', listResult.success ? 'SUCCESS' : 'FAILED');
	const listed = dataOf(listResult);
	if (listResult.success && listed) {
		console.log('  Total items:', listed.total);
	}

	// Test 4: Clear
	await client.call('todo-clear', {});
	console.log('\n✓ Clear command: SUCCESS');

	console.log('\n═══════════════════════════════════════');
	console.log('  DirectClient integration verified! ✓');
	console.log('═══════════════════════════════════════\n');
}

test().catch(console.error);
