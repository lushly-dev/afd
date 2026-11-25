/** A stdio host over the same validated definitions and execution path as the CLI. */
import { commandToolAnnotations, failure } from '@lushly-dev/afd-core';
import { createSpecimenBench } from '@lushly-dev/specimen';
import type { BenchOptions } from '@lushly-dev/specimen/types';
import { createSpecimenCommands, executeSpecimenCommand } from '@lushly-dev/specimen-afd';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function createSpecimenMcpServer(options: BenchOptions): Promise<McpServer> {
	const bench = await createSpecimenBench(options);
	const commands = createSpecimenCommands(bench).filter((command) => command.expose?.mcp === true);
	const names = new Set(commands.map((command) => command.name));
	const server = new McpServer(
		{ name: 'specimen', version: '0.1.0' },
		{
			capabilities: { tools: {} },
			instructions:
				'Specimen observes and tests native components, retained stories, and job specimens, and records design decisions under specimens/. Start with specimen-list and specimen-validate; call decision-check before editing files, specimens, or tokens covered by a decision. Tools use the same input schemas and CommandResult envelopes as the specimen CLI. Rendering, inspection, and job runs can launch Chromium and execute project code; job-create, job-run, capture, compare, decision-record, baseline, migrate, build, point, note, and pack operations can write files. Use this server with trusted local projects.',
		}
	);
	server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: commands.map((command) => ({
			name: command.name,
			description: command.description,
			inputSchema: command.jsonSchema as { type: 'object'; [key: string]: unknown },
			annotations: commandToolAnnotations(command),
		})),
	}));
	server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: input = {} } = request.params;
		const result = names.has(name)
			? await executeSpecimenCommand(bench, name, input)
			: failure({
					code: 'COMMAND_NOT_FOUND',
					message: `Unknown tool: ${name}`,
					suggestion: 'List available tools with tools/list.',
				});
		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			isError: !result.success,
		};
	});
	// Also covers SDK/client disconnects, not just explicit signal handling in the binary.
	server.server.onclose = () => {
		void bench
			.close()
			.catch((error: unknown) => console.error('[specimen-mcp] Close failed:', error));
	};
	return server;
}
