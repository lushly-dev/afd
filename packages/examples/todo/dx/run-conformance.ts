import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConformanceRunner, wireProblems } from './conformance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
	const backendOption = process.argv.indexOf('--backend');
	const target = backendOption >= 0 ? process.argv[backendOption + 1] : undefined;
	if (target !== 'ts' && target !== 'py') {
		console.error('Usage: tsx dx/run-conformance.ts --backend <ts|py>');
		process.exit(1);
	}
	const specPath = path.join(__dirname, '../spec/test-cases.json');

	console.log(`Running conformance tests against: ${target}`);

	let transport: StdioClientTransport;

	if (target === 'ts') {
		transport = new StdioClientTransport({
			command: 'node',
			args: [path.join(__dirname, '../backends/typescript/dist/server.js')],
			env: { ...process.env, PORT: '3101', TODO_STORE_TYPE: 'memory' },
		});
	} else {
		transport = new StdioClientTransport({
			command: 'uv',
			args: ['run', '--project', path.join(__dirname, '../backends/python'), 'todo-server'],
			env: { ...process.env, TODO_STORE_TYPE: 'memory' } as Record<string, string>,
		});
	}

	const client = new Client({ name: 'conformance-runner', version: '1.0.0' }, { capabilities: {} });

	console.log('Connecting to MCP server...');
	await client.connect(transport);
	console.log('Connected.');

	const runner = new ConformanceRunner(async (name, args) => {
		console.log(`Calling tool: ${name}`, args);
		const result = (await client.callTool({
			name,
			arguments: args as Record<string, unknown>,
		})) as { content: Array<{ text: string }>; isError?: boolean };
		const text = result.content[0]?.text;
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : result;
		} catch (e) {
			console.error(`Failed to parse JSON from tool ${name}. Raw text:`, text);
			throw e;
		}
		const problems = wireProblems(parsed, result.isError === true);
		if (problems.length > 0) {
			throw new Error(`${name} broke the wire format (spec/wire): ${problems.join('; ')}`);
		}
		return parsed as { success: boolean; data?: unknown; error?: { message: string } };
	});

	const results = await runner.run(specPath);

	let passed = 0;
	results.forEach((r) => {
		if (r.success) {
			passed++;
			console.log(`✅ ${r.name}`);
		} else {
			console.log(`❌ ${r.name}: ${r.error}`);
		}
	});

	console.log(`\nSummary: ${passed}/${results.length} passed`);

	await client.close();
	process.exit(passed === results.length ? 0 : 1);
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
