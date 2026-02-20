import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConformanceRunner } from './conformance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
	const target = process.argv[2] || 'ts';
	const specPath = path.join(__dirname, '../spec/test-cases.json');

	console.log(`Running conformance tests against: ${target}`);

	let transport: StdioClientTransport;

	if (target === 'ts') {
		transport = new StdioClientTransport({
			command: 'node',
			args: [path.join(__dirname, '../backends/typescript/dist/server.js')],
			env: { ...process.env, PORT: '3101' },
		});
	} else if (target === 'py') {
		transport = new StdioClientTransport({
			command: 'python',
			args: [path.join(__dirname, '../backends/python/src/server.py')],
			env: process.env as Record<string, string>,
		});
	} else {
		console.error(`Unknown target: ${target}`);
		process.exit(1);
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
		})) as { content: Array<{ text: string }> };
		const text = result.content[0]?.text;
		try {
			return text ? JSON.parse(text) : result;
		} catch (e) {
			console.error(`Failed to parse JSON from tool ${name}. Raw text:`, text);
			throw e;
		}
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

run().catch(console.error);
