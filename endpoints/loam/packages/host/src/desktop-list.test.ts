/**
 * D138's list against section 7's (phase 6 specification, 10.8): the desktop serves inbound everything the hosted
 * server serves over MCP, and more. Here, since `loam-host` holds `HOSTED_MCP_COMMANDS` and the kernel cannot import
 * it.
 */

import { DESKTOP_MCP_COMMANDS } from '@lushly-dev/loam-kernel/inbound';
import { describe, expect, it } from 'vitest';
import { HOSTED_MCP_COMMANDS } from './mcp.js';

describe('DESKTOP_MCP_COMMANDS', () => {
	it('holds HOSTED_MCP_COMMANDS, in its order, before the documents', () => {
		expect(DESKTOP_MCP_COMMANDS.slice(0, HOSTED_MCP_COMMANDS.length)).toEqual([
			...HOSTED_MCP_COMMANDS,
		]);
	});
});
