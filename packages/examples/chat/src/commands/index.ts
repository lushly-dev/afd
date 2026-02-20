/**
 * @fileoverview Export all chat commands
 */

export { chatConnect } from './connect.js';
export { chatDisconnect } from './disconnect.js';
export { chatPoll } from './poll.js';
export { chatRooms } from './rooms.js';
export { chatSend } from './send.js';
export { chatStatus } from './status.js';

import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
// Re-export as array for convenience
import { chatConnect } from './connect.js';
import { chatDisconnect } from './disconnect.js';
import { chatPoll } from './poll.js';
import { chatRooms } from './rooms.js';
import { chatSend } from './send.js';
import { chatStatus } from './status.js';

/**
 * All chat commands as an array.
 */
export const allCommands = [
	chatConnect,
	chatStatus,
	chatDisconnect,
	chatPoll,
	chatRooms,
	chatSend,
] as unknown as ZodCommandDefinition[];
