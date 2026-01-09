/**
 * AFD Todo Demo - Server
 *
 * MCP server for the rich Todo app.
 */
import Database from 'better-sqlite3';
import { createMcpServer } from '@lushly-dev/afd-server';
import { TaskStore } from './stores/task-store.js';
import { ListStore } from './stores/list-store.js';
import { createCommands } from './commands/index.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || 'localhost';
const DB_PATH = process.env.DB_PATH || './todo.db';
const DEV_MODE = process.env.NODE_ENV === 'development';

// Initialize database
const db = new Database(DB_PATH);
const taskStore = new TaskStore(DB_PATH);
const listStore = new ListStore(db);

// Create commands
const commands = createCommands(taskStore, listStore);

// Create MCP server
const server = createMcpServer({
	name: 'afd-todo-demo',
	version: '0.1.0',
	commands,
	port: PORT,
	host: HOST,
	devMode: DEV_MODE,
	cors: true,
	transport: 'auto',
	toolStrategy: 'individual',
	onCommand(command, input, result) {
		if (DEV_MODE) {
			console.log(`[${new Date().toISOString()}] ${command}:`, result.success ? 'OK' : 'FAIL');
		}
	},
	onError(error) {
		console.error('[Server Error]', error);
	},
});

// Start server
server.start().then(() => {
	const transport = server.getTransport();
	if (transport === 'http') {
		console.log(`AFD Todo Demo running at http://${HOST}:${PORT}`);
	} else {
		console.error('AFD Todo Demo running in stdio mode');
	}
	console.error(`Commands: ${commands.map((c) => c.name).join(', ')}`);
	console.error(`Database: ${DB_PATH}`);
});
