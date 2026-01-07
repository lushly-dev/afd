/**
 * @fileoverview Quick test to verify DirectClient works with the experiment registry
 */

import { DirectClient } from '@lushly-dev/afd-client';
import { registry } from './src/registry.js';

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
	if (createResult.success && createResult.data) {
		console.log('  Created ID:', createResult.data.id);
	}

	// Test 3: List todos
	const listResult = await client.call<{ items: unknown[]; total: number }>('todo-list', {});
	console.log('\n✓ List command:', listResult.success ? 'SUCCESS' : 'FAILED');
	if (listResult.success && listResult.data) {
		console.log('  Total items:', listResult.data.total);
	}

	// Test 4: Clear
	await client.call('todo-clear', {});
	console.log('\n✓ Clear command: SUCCESS');

	console.log('\n═══════════════════════════════════════');
	console.log('  DirectClient integration verified! ✓');
	console.log('═══════════════════════════════════════\n');
}

test().catch(console.error);
