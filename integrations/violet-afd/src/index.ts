/**
 * Violet Design Core
 *
 * Token management engine with hierarchical inheritance.
 *
 * AFD command bindings for the native @lushly-dev/violet-core foundation. This root keeps the
 * pre-split @lushly-dev/violet-core root contract: native exports plus commands and results.
 */

// Native foundation (types, storage, export, OpenAPI document, CSS validators)
export * from '@lushly-dev/violet-core';

// The Neon store, which the pre-split root exported
export * from '@lushly-dev/violet-core/neon';

// Types, including AFD CommandResult
export * from './types/index.js';

// Commands
export * from './commands/index.js';

// Demo data builders
export * from './demo/index.js';

import { initializeExport } from '@lushly-dev/violet-core';
import { registerAnalyzeCommands } from './commands/analyze/index.js';
import { registerApiKeyCommands } from './commands/apikeys/index.js';
import { registerAuditCommands } from './commands/audit/index.js';
import { registerChangesCommands } from './commands/changes/index.js';
import { registerConstraintCommands } from './commands/constraints/index.js';
import { registerDocsCommand } from './commands/docs/index.js';
import { registerExportCommands } from './commands/export/index.js';
import { registerImportCommands } from './commands/import/index.js';
// Initialize and register all commands
import { registerNodeCommands } from './commands/node/index.js';
import { registerSpecimenCommands } from './commands/specimen/index.js';
import { registerSystemCommands } from './commands/system/index.js';
import { registerTokenCommands } from './commands/token/index.js';
import { registerWebhookCommands } from './commands/webhooks/index.js';

let coreInitialized = false;

/**
 * Initialize the Violet core - registers all commands.
 *
 * Idempotent: calling it more than once is a no-op, so independent entry points
 * (e.g. the CLI and the MCP server) can each call it safely.
 */
export function initializeCore(): void {
	if (coreInitialized) return;
	coreInitialized = true;

	registerNodeCommands();
	registerTokenCommands();
	registerExportCommands();
	registerImportCommands();
	registerConstraintCommands();
	registerAnalyzeCommands();
	registerChangesCommands();
	registerAuditCommands();
	registerSpecimenCommands();
	registerSystemCommands();
	registerDocsCommand();
	registerWebhookCommands();
	registerApiKeyCommands();
	initializeExport();
}
