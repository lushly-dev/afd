/**
 * @fileoverview Chat example - demonstrating the AFD handoff pattern
 *
 * This example shows how to implement real-time chat using the handoff pattern:
 * 1. Commands handle session management and return WebSocket handoff credentials
 * 2. WebSocket server handles real-time message delivery
 * 3. Polling commands provide a fallback for agents that cannot use WebSocket
 */

export * from './commands/index.js';
export * from './services/chat.js';
export * from './types.js';
export { createWebSocketServer } from './ws-server.js';
