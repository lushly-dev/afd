#!/usr/bin/env node
import { createSpecimenMcpServer } from './server.js';

try {
	const args = process.argv.slice(2);
	let root = process.cwd();
	let configFile: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const option = args[index];
		if (option !== '--root' && option !== '--config') throw new Error(`Unknown option: ${option}`);
		const value = args[++index];
		if (!value || value.startsWith('--')) throw new Error(`Option ${option} needs a value`);
		if (option === '--root') root = value;
		else configFile = value;
	}
	const server = await createSpecimenMcpServer({ root, configFile, transport: 'stdio' });
	const close = () => {
		void server
			.close()
			.catch((error: unknown) => console.error('[specimen-mcp] Close failed:', error));
	};
	process.once('SIGINT', close);
	process.once('SIGTERM', close);
	process.stdin.once('end', close);
	await server.start();
} catch (error) {
	console.error('[specimen-mcp] Fatal error:', error);
	process.exitCode = 1;
}
