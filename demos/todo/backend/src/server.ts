/**
 * AFD Todo Demo - Server
 * 
 * Express server with AFD DirectClient for the rich Todo app.
 */
import express from 'express';
import cors from 'cors';
import { CommandRegistry, DirectClient } from '@lushly-dev/afd-core';
import { registerCommands } from './commands.js';
import { TaskStore } from './stores/task-store.js';
import { ListStore } from './stores/list-store.js';
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || './todo.db';

// Initialize database
const db = new Database(DB_PATH);
const taskStore = new TaskStore(DB_PATH);
const listStore = new ListStore(db);

// Initialize AFD
const registry = new CommandRegistry();
registerCommands(registry, taskStore, listStore);

const client = new DirectClient(registry);

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Execute command via DirectClient
app.post('/execute', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const { command, input } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Missing command name' });
    }

    const result = await client.execute(command, input || {});
    const latency = performance.now() - startTime;

    res.json({
      ...result,
      _debug: {
        latency: `${latency.toFixed(2)}ms`,
        command,
      },
    });
  } catch (error: any) {
    const latency = performance.now() - startTime;
    res.status(500).json({
      error: error.message,
      _debug: {
        latency: `${latency.toFixed(2)}ms`,
      },
    });
  }
});

// List available commands (for dev mode)
app.get('/commands', (_req, res) => {
  const commands = registry.listCommands();
  res.json({ commands });
});

app.listen(PORT, () => {
  console.log(`🚀 AFD Todo Demo running at http://localhost:${PORT}`);
  console.log(`📝 Commands: ${registry.listCommands().map(c => c.name).join(', ')}`);
  console.log(`💾 Database: ${DB_PATH}`);
});
