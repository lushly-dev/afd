/**
 * @fileoverview Main CLI setup
 */

import { Command } from 'commander';
import {
	registerConnectCommand,
	registerDisconnectCommand,
	registerStatusCommand,
} from './commands/connect.js';
import { registerToolsCommand } from './commands/tools.js';
import { registerCallCommand } from './commands/call.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerShellCommand } from './commands/shell.js';

/**
 * Create the CLI program.
 */
export function createCli(): Command {
	const program = new Command();

	program
		.name('afd')
		.description('Agent-First Development CLI - Build software where AI agents are first-class users')
		.version('0.1.0');

	// Register commands
	registerConnectCommand(program);
	registerDisconnectCommand(program);
	registerStatusCommand(program);
	registerToolsCommand(program);
	registerCallCommand(program);
	registerValidateCommand(program);
	registerShellCommand(program);

	return program;
}
