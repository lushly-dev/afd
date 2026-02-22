/**
 * Expose & Trust Demo — Visibility Control and Safety Metadata
 *
 * Demonstrates:
 * 1. ExposeOptions — which surfaces see which commands
 * 2. defaultExpose — secure defaults (mcp/cli opt-in)
 * 3. Registry filtering by interface type
 * 4. Interface-gated execution (COMMAND_NOT_EXPOSED)
 * 5. Trust metadata — destructive, confirmPrompt
 * 6. Undo metadata on CommandResult
 */

import { createCommandRegistry, defaultExpose, success, type CommandResult } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';

const divider = (label: string) =>
	console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}`);

// ═══════════════════════════════════════════════════════════
// COMMANDS WITH DIFFERENT EXPOSE CONFIGS
// ═══════════════════════════════════════════════════════════

const todoCreate = defineCommand({
	name: 'todo-create',
	description: 'Create a new todo item',
	category: 'todos',
	mutation: true,
	input: z.object({ title: z.string() }),
	// No expose = defaults (palette: true, agent: true, mcp: false, cli: false)
	async handler(input) {
		return success({ id: '1', title: input.title }, {
			reasoning: 'Created in-memory',
			// Undo metadata — tells the agent how to reverse this
			undoCommand: 'todo-delete',
			undoArgs: { id: '1' },
		});
	},
});

const todoList = defineCommand({
	name: 'todo-list',
	description: 'List all todos',
	category: 'todos',
	input: z.object({}),
	expose: { palette: true, agent: true, mcp: true, cli: true },  // Available everywhere
	async handler() {
		return success([{ id: '1', title: 'Demo' }]);
	},
});

const todoDelete = defineCommand({
	name: 'todo-delete',
	description: 'Delete a todo item permanently',
	category: 'todos',
	mutation: true,
	destructive: true,
	confirmPrompt: 'Delete this todo permanently? This cannot be undone.',
	input: z.object({ id: z.string() }),
	expose: { palette: true, agent: true, mcp: true, cli: true },
	async handler(input) {
		return success({ deleted: input.id });
	},
});

const adminReset = defineCommand({
	name: 'admin-reset',
	description: 'Reset all data (dangerous)',
	category: 'admin',
	mutation: true,
	destructive: true,
	confirmPrompt: 'This will delete ALL data. Are you absolutely sure?',
	input: z.object({ confirm: z.literal(true) }),
	expose: { palette: false, agent: false, mcp: false, cli: true },  // CLI only
	async handler() {
		return success({ reset: true });
	},
});

const internalHealthCheck = defineCommand({
	name: 'internal-health-check',
	description: 'Internal health check for monitoring',
	category: 'internal',
	input: z.object({}),
	expose: { palette: false, agent: false, mcp: true, cli: false },  // MCP only (external monitoring)
	async handler() {
		return success({ status: 'healthy', uptime: 12345 });
	},
});

const agentAnalyze = defineCommand({
	name: 'agent-analyze',
	description: 'Analyze data for the AI assistant',
	category: 'ai',
	input: z.object({ query: z.string() }),
	expose: { palette: false, agent: true, mcp: true, cli: false },  // Agent + MCP only
	async handler(input) {
		return success({ analysis: `Analysis of "${input.query}"`, confidence: 0.87 });
	},
});

// ═══════════════════════════════════════════════════════════
// REGISTRY SETUP
// ═══════════════════════════════════════════════════════════

const commands = [todoCreate, todoList, todoDelete, adminReset, internalHealthCheck, agentAnalyze];

const registry = createCommandRegistry();
for (const cmd of commands) {
	registry.register(cmd.toCommandDefinition());
}

async function run() {
	console.log('\n🔒  Expose & Trust Demo\n');

	// ═══════════════════════════════════════════════════════════
	// 1. DEFAULT EXPOSE VALUES
	// ═══════════════════════════════════════════════════════════

	divider('1. Default Expose (secure by default)');
	console.log('  defaultExpose:', JSON.stringify(defaultExpose));
	console.log('  → palette: ON  (user can find it)');
	console.log('  → agent: ON    (in-app AI can use it)');
	console.log('  → mcp: OFF     (external agents must opt-in)');
	console.log('  → cli: OFF     (automation must opt-in)');

	// ═══════════════════════════════════════════════════════════
	// 2. SURFACE VISIBILITY MATRIX
	// ═══════════════════════════════════════════════════════════

	divider('2. Surface Visibility Matrix');

	const surfaces = ['palette', 'agent', 'mcp', 'cli'] as const;
	const allCmds = registry.list();

	// Header
	const nameWidth = 24;
	console.log(`  ${'Command'.padEnd(nameWidth)} ${surfaces.map((s) => s.padEnd(8)).join(' ')}`);
	console.log(`  ${'─'.repeat(nameWidth)} ${surfaces.map(() => '─'.repeat(8)).join(' ')}`);

	// Rows
	for (const cmd of allCmds) {
		const expose = cmd.expose ?? defaultExpose;
		const cells = surfaces.map((s) => (expose[s] ? '  ✅' : '  ❌').padEnd(8));
		console.log(`  ${cmd.name.padEnd(nameWidth)} ${cells.join(' ')}`);
	}

	// ═══════════════════════════════════════════════════════════
	// 3. REGISTRY FILTERING BY INTERFACE
	// ═══════════════════════════════════════════════════════════

	divider('3. Registry Filtering by Interface');

	for (const surface of surfaces) {
		const visible = registry.listByExposure(surface);
		console.log(`  ${surface}: [${visible.map((c) => c.name).join(', ')}]`);
	}

	// ═══════════════════════════════════════════════════════════
	// 4. INTERFACE-GATED EXECUTION
	// ═══════════════════════════════════════════════════════════

	divider('4. Interface-Gated Execution');

	// todo-create uses defaults (mcp: false) — calling from MCP should be denied
	const mcpDenied = await registry.execute('todo-create', { title: 'test' }, { interface: 'mcp' });
	console.log('  todo-create via MCP:');
	console.log(`    Success: ${mcpDenied.success}`);
	console.log(`    Error: ${mcpDenied.error?.code} — ${mcpDenied.error?.message}`);

	// Same command from palette (palette: true by default) — allowed
	const paletteAllowed = await registry.execute('todo-create', { title: 'test' }, { interface: 'palette' });
	console.log('  todo-create via palette:');
	console.log(`    Success: ${paletteAllowed.success}`);

	// admin-reset: only CLI
	const adminFromAgent = await registry.execute('admin-reset', { confirm: true }, { interface: 'agent' });
	console.log('  admin-reset via agent:');
	console.log(`    Success: ${adminFromAgent.success}`);
	console.log(`    Error: ${adminFromAgent.error?.code}`);

	const adminFromCli = await registry.execute('admin-reset', { confirm: true }, { interface: 'cli' });
	console.log('  admin-reset via CLI:');
	console.log(`    Success: ${adminFromCli.success}`);

	// ═══════════════════════════════════════════════════════════
	// 5. TRUST METADATA — destructive + confirmPrompt
	// ═══════════════════════════════════════════════════════════

	divider('5. Trust Metadata (destructive, confirmPrompt)');

	for (const cmd of allCmds) {
		const flags: string[] = [];
		if (cmd.mutation) flags.push('mutation');
		if ((cmd as { destructive?: boolean }).destructive) flags.push('🔴 destructive');
		if ((cmd as { confirmPrompt?: string }).confirmPrompt) {
			flags.push(`confirm: "${(cmd as { confirmPrompt: string }).confirmPrompt}"`);
		}
		if (cmd.undoable) flags.push('↩️  undoable');
		if (flags.length > 0) {
			console.log(`  ${cmd.name}: ${flags.join(' | ')}`);
		}
	}

	console.log('\n  Trust signals on ZodCommandDefinition:');
	for (const cmd of commands) {
		if (cmd.destructive || cmd.confirmPrompt) {
			console.log(`  ${cmd.name}:`);
			console.log(`    destructive: ${cmd.destructive ?? false}`);
			if (cmd.confirmPrompt) console.log(`    confirmPrompt: "${cmd.confirmPrompt}"`);
		}
	}

	// ═══════════════════════════════════════════════════════════
	// 6. UNDO METADATA ON COMMAND RESULT
	// ═══════════════════════════════════════════════════════════

	divider('6. Undo Metadata on CommandResult');

	const createResult = await registry.execute('todo-create', { title: 'Undo me' });
	console.log('  todo-create result:');
	console.log(`    success: ${createResult.success}`);
	console.log(`    data: ${JSON.stringify(createResult.data)}`);
	console.log(`    undoCommand: ${createResult.undoCommand ?? '(none)'}`);
	console.log(`    undoArgs: ${createResult.undoArgs ? JSON.stringify(createResult.undoArgs) : '(none)'}`);

	if (createResult.undoCommand) {
		console.log('\n  Agent can reverse this by calling:');
		console.log(`    ${createResult.undoCommand}(${JSON.stringify(createResult.undoArgs)})`);
	}

	// ═══════════════════════════════════════════════════════════
	// 7. HOW AN AGENT USES THESE SIGNALS
	// ═══════════════════════════════════════════════════════════

	divider('7. Agent Decision Flow');

	// Note: destructive/confirmPrompt live on ZodCommandDefinition but don't
	// flow through toCommandDefinition() yet. An agent using the server directly
	// (or MCP _meta) sees them; the registry doesn't propagate them today.
	const cmdName = 'todo-delete';
	const zodCmd = commands.find((c) => c.name === cmdName);
	if (zodCmd) {
		const expose = zodCmd.expose ?? defaultExpose;
		console.log(`  Agent considering "${cmdName}" (from ZodCommandDefinition):`);
		console.log(`    1. Am I allowed?  expose.agent = ${expose.agent}`);
		console.log(`    2. Is it safe?    destructive = ${zodCmd.destructive ?? false}`);
		console.log(`    3. Need confirm?  "${zodCmd.confirmPrompt ?? 'none'}"`);
		console.log(`    → Decision: ${expose.agent ? 'Can proceed' : 'Cannot use'}, ${zodCmd.destructive ? 'but MUST confirm with user first' : 'safe to execute'}`);
	}

	console.log(`\n${'═'.repeat(60)}\n  ✅  Expose & trust demo complete\n${'═'.repeat(60)}\n`);
}

run().catch(console.error);
