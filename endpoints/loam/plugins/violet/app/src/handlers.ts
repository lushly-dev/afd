/**
 * @fileoverview Assembles all 22 command handlers for `@lushly-dev/loam-app-violet` (spec §6).
 */
import type { AppCommandHandlerV1 } from '@lushly-dev/loam-sdk';
import { createCheckHandlers } from './handlers/check.js';
import { createFileHandlers } from './handlers/files.js';
import { createReadHandlers } from './handlers/read.js';
import { createWriteHandlers } from './handlers/write.js';
import { defaultPort, type VioletPort } from './port/engine.js';

export function createHandlers(
	port: VioletPort = defaultPort
): Record<string, AppCommandHandlerV1<never>> {
	return {
		...createReadHandlers(port),
		...createCheckHandlers(port),
		...createWriteHandlers(port),
		...createFileHandlers(port),
	} as unknown as Record<string, AppCommandHandlerV1<never>>;
}

export const handlers = createHandlers();
