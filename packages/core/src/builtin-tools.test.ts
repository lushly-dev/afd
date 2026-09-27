import { describe, expect, it } from 'vitest';
import {
	AFD_BOOTSTRAP_COMMAND_NAMES,
	AFD_BUILTIN_TOOL_NAMES,
	AFD_CONTEXT_COMMAND_NAMES,
	AFD_META_TOOL_NAMES,
	isAfdBuiltinName,
} from './index.js';

describe('AFD built-in tool names', () => {
	it('combine the meta-tool, bootstrap and context names', () => {
		expect(AFD_BUILTIN_TOOL_NAMES).toEqual([
			...AFD_META_TOOL_NAMES,
			...AFD_BOOTSTRAP_COMMAND_NAMES,
			...AFD_CONTEXT_COMMAND_NAMES,
		]);
		expect(new Set(AFD_BUILTIN_TOOL_NAMES).size).toBe(AFD_BUILTIN_TOOL_NAMES.length);
	});

	it('recognize built-in names exactly', () => {
		for (const name of ['afd-call', 'afd-detail', 'afd-help', 'afd-context-enter']) {
			expect(isAfdBuiltinName(name)).toBe(true);
		}
		for (const name of ['todo-create', 'afd', 'afd-custom', 'AFD-CALL', 'todo']) {
			expect(isAfdBuiltinName(name)).toBe(false);
		}
	});
});
