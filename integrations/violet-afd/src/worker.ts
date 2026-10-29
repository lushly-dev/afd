/**
 * Worker-safe Violet core entrypoint.
 *
 * Excludes Node-only storage and system command surfaces so Workers can bundle
 * only the command/runtime pieces they actually use.
 */

export type { CommandContext, Database } from './commands/registry.js';
export { registry } from './commands/registry.js';
export * from '@lushly-dev/violet-core/worker';

import { initializeExport } from '@lushly-dev/violet-core/engine';
import { registerAnalyzeCommands } from './commands/analyze/index.js';
import { registerAuditCommands } from './commands/audit/index.js';
import { registerChangesCommands } from './commands/changes/index.js';
import { registerConstraintCommands } from './commands/constraints/index.js';
import { registerExportCommands } from './commands/export/index.js';
import { registerImportCommands } from './commands/import/index.js';
import { registerNodeCommands } from './commands/node/index.js';
import { registerSpecimenCommands } from './commands/specimen/index.js';
import { registerTokenCommands } from './commands/token/index.js';

export function initializeWorkerCore(): void {
	registerNodeCommands();
	registerTokenCommands();
	registerExportCommands();
	registerImportCommands();
	registerConstraintCommands();
	registerAnalyzeCommands();
	registerChangesCommands();
	registerAuditCommands();
	registerSpecimenCommands();
	initializeExport();
}
