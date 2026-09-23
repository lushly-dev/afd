#!/usr/bin/env node

/**
 * @fileoverview CLI entry point
 */

import { createCli } from './cli.js';
import { closeClient } from './connection.js';

const program = createCli();

try {
	await program.parseAsync();
} finally {
	// Commands leave their client connected; an open SSE stream would keep the
	// process alive forever after the result is printed.
	await closeClient();
}
