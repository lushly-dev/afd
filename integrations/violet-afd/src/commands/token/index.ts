/**
 * Token Commands
 *
 * Commands for managing tokens (add, override, subtract, reset, copy).
 */

export * from './add.js';
export * from './override.js';
export * from './subtract.js';
export * from './reset.js';
export * from './copy.js';
export * from './resolve.js';
export * from './lineage.js';
export * from './matrix.js';
export * from './compare.js';
export { ResolutionCache, withResolutionCache } from '@lushly-dev/violet-core/engine';
export * from './catalog.js';
export * from './definitions.js';

import { registry } from '../registry.js';
import { tokenAddCommand } from './add.js';
import { tokensCatalogCommand } from './catalog.js';
import { tokensCompareCommand } from './compare.js';
import { tokenCopyCommand } from './copy.js';
import { tokenLineageCommand } from './lineage.js';
import { tokensMatrixCommand } from './matrix.js';
import { tokenOverrideCommand } from './override.js';
import { tokenResetCommand } from './reset.js';
import { tokensResolveCommand } from './resolve.js';
import { tokenSubtractCommand } from './subtract.js';

/**
 * Register all token commands
 */
export function registerTokenCommands(): void {
	registry.register(tokenAddCommand);
	registry.register(tokenOverrideCommand);
	registry.register(tokenSubtractCommand);
	registry.register(tokenResetCommand);
	registry.register(tokenCopyCommand);
	registry.register(tokensResolveCommand);
	registry.register(tokenLineageCommand);
	registry.register(tokensMatrixCommand);
	registry.register(tokensCompareCommand);
	registry.register(tokensCatalogCommand);
}
