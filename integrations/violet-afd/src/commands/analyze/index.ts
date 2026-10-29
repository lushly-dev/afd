/**
 * Analyze Commands
 */

import { registry } from '../registry.js';
import { compareNodesCommand } from './compare.js';
import { analyzeComplianceCommand } from './compliance.js';
import { analyzeDeviationsCommand } from './deviations.js';
import { analyzeHealthCommand } from './health.js';
import { analyzeSnapshotCommand } from './snapshot.js';
import { analyzeTrendsCommand } from './trends.js';
import { analyzeViolationsCommand } from './violations.js';

export * from './deviations.js';
export * from './compliance.js';
export * from './compare.js';
export * from './violations.js';
export * from './health.js';
export * from './trends.js';
export * from './snapshot.js';

/**
 * Register all analyze commands
 */
export function registerAnalyzeCommands(): void {
	registry.register(analyzeDeviationsCommand);
	registry.register(analyzeComplianceCommand);
	registry.register(compareNodesCommand);
	registry.register(analyzeViolationsCommand);
	registry.register(analyzeHealthCommand);
	registry.register(analyzeTrendsCommand);
	registry.register(analyzeSnapshotCommand);
}
