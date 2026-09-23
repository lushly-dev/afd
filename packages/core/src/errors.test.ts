import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
	type CommandError,
	createError,
	ErrorCodes,
	internalError,
	isCommandError,
	notFoundError,
	rateLimitError,
	timeoutError,
	validationError,
	wrapError,
} from './errors.js';

describe('createError', () => {
	it('creates error with code and message', () => {
		const err = createError('MY_CODE', 'something broke');
		expect(err.code).toBe('MY_CODE');
		expect(err.message).toBe('something broke');
	});

	it('merges optional fields', () => {
		const err = createError('FOO', 'bar', {
			suggestion: 'try again',
			retryable: true,
			details: { key: 'val' },
		});
		expect(err.suggestion).toBe('try again');
		expect(err.retryable).toBe(true);
		expect(err.details).toEqual({ key: 'val' });
	});

	it('returns plain object without extra properties when no options given', () => {
		const err = createError('X', 'Y');
		expect(Object.keys(err).sort()).toEqual(['code', 'message']);
	});
});

describe('validationError', () => {
	it('uses VALIDATION_ERROR code', () => {
		const err = validationError('bad input');
		expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
		expect(err.message).toBe('bad input');
		expect(err.retryable).toBe(false);
		expect(err.suggestion).toBeDefined();
	});

	it('includes details when provided', () => {
		const err = validationError('missing field', { field: 'name' });
		expect(err.details).toEqual({ field: 'name' });
	});
});

describe('notFoundError', () => {
	it('formats resource type and id in message', () => {
		const err = notFoundError('User', '42');
		expect(err.code).toBe(ErrorCodes.NOT_FOUND);
		expect(err.message).toContain('User');
		expect(err.message).toContain('42');
		expect(err.retryable).toBe(false);
		expect(err.details).toEqual({ resourceType: 'User', resourceId: '42' });
	});

	it('lowercases resource type in suggestion', () => {
		const err = notFoundError('Document', 'abc');
		expect(err.suggestion).toContain('document');
	});
});

describe('rateLimitError', () => {
	it('includes retry time when provided', () => {
		const err = rateLimitError(60);
		expect(err.code).toBe(ErrorCodes.RATE_LIMITED);
		expect(err.suggestion).toContain('60');
		expect(err.retryable).toBe(true);
		expect(err.details).toEqual({ retryAfterSeconds: 60 });
	});

	it('uses generic suggestion without retry time', () => {
		const err = rateLimitError();
		expect(err.suggestion).toContain('Wait');
		expect(err.details).toBeUndefined();
	});
});

describe('timeoutError', () => {
	it('includes operation name and timeout in message', () => {
		const err = timeoutError('fetchData', 5000);
		expect(err.code).toBe(ErrorCodes.TIMEOUT);
		expect(err.message).toContain('fetchData');
		expect(err.message).toContain('5000');
		expect(err.retryable).toBe(true);
		expect(err.details).toEqual({ operationName: 'fetchData', timeoutMs: 5000 });
	});
});

describe('internalError', () => {
	it('creates internal error with message', () => {
		const err = internalError('something went wrong');
		expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
		expect(err.message).toBe('something went wrong');
		expect(err.retryable).toBe(true);
	});

	it('attaches cause when provided', () => {
		const cause = new Error('root cause');
		const err = internalError('wrapped', cause);
		expect(err.cause).toBe(cause);
	});

	it('never serializes a native cause', () => {
		const cause = Object.assign(new Error('ENOENT: no such file'), {
			code: 'ENOENT',
			path: '/srv/app/.secrets',
		});
		const err = internalError('Could not load settings', cause);

		expect(Object.keys(err)).not.toContain('cause');
		expect(JSON.stringify(err)).not.toContain('.secrets');
		expect({ ...err }).not.toHaveProperty('cause');
	});
});

describe('wrapError', () => {
	it('returns CommandError unchanged (idempotent)', () => {
		const original: CommandError = {
			code: 'CUSTOM',
			message: 'already wrapped',
			suggestion: 'do nothing',
		};
		const wrapped = wrapError(original);
		expect(wrapped).toBe(original);
	});

	it('wraps Error instances without putting the stack or the Error in the result', () => {
		const err = new Error('native error');
		const wrapped = wrapError(err);
		expect(wrapped).toEqual({
			code: ErrorCodes.INTERNAL_ERROR,
			message: 'native error',
			suggestion: 'Please try again. If this persists, contact support.',
			retryable: true,
		});
		expect(wrapped).not.toBeInstanceOf(Error);
		expect(wrapped.details).toBeUndefined();
		expect(wrapped.cause).toBeUndefined();
		expect(JSON.stringify(wrapped)).not.toContain('at ');
	});

	it('keeps the stack on a non-enumerable property for logging', () => {
		const err = new Error('native error');
		const wrapped = wrapError(err);
		expect(Object.keys(wrapped)).not.toContain('stack');
		expect((wrapped as CommandError & { stack?: string }).stack).toBe(err.stack);
	});

	it('wraps Node system errors without their errno, syscall or path fields', () => {
		const systemError = Object.assign(
			new Error("ENOENT: no such file or directory, open '/srv/app/.secrets'"),
			{ errno: -2, code: 'ENOENT', syscall: 'open', path: '/srv/app/.secrets' }
		);
		const wrapped = wrapError(systemError);

		expect(wrapped).not.toBe(systemError);
		expect(wrapped.code).toBe('ENOENT');
		expect(Object.keys(wrapped).sort()).toEqual(['code', 'message', 'retryable', 'suggestion']);
		expect(JSON.parse(JSON.stringify(wrapped))).not.toHaveProperty('path');
		expect(JSON.parse(JSON.stringify(wrapped))).not.toHaveProperty('syscall');
	});

	it('keeps the code, suggestion and retryable of structured Error subclasses', () => {
		class ProviderError extends Error {
			readonly code = 'TOKEN_EXPIRED';
			readonly suggestion = 'Sign in again to continue';
			readonly retryable = false;
		}
		expect(wrapError(new ProviderError('Session has expired'))).toEqual({
			code: 'TOKEN_EXPIRED',
			message: 'Session has expired',
			suggestion: 'Sign in again to continue',
			retryable: false,
		});
	});

	it('keeps a cause only when it is a CommandError', () => {
		const commandCause: CommandError = { code: 'UPSTREAM', message: 'Upstream failed' };
		expect(wrapError(new Error('outer', { cause: commandCause })).cause).toBe(commandCause);
		expect(wrapError(new Error('outer', { cause: new Error('inner') })).cause).toBeUndefined();
		expect(wrapError(new Error('outer', { cause: 'text' })).cause).toBeUndefined();
	});

	it('wraps non-Error values as strings', () => {
		const wrapped = wrapError('string error');
		expect(wrapped.code).toBe(ErrorCodes.UNKNOWN_ERROR);
		expect(wrapped.message).toBe('string error');
	});

	it('wraps numbers as strings', () => {
		const wrapped = wrapError(404);
		expect(wrapped.message).toBe('404');
	});

	it('wraps null as string', () => {
		const wrapped = wrapError(null);
		expect(wrapped.message).toBe('null');
	});
});

describe('ErrorCodes', () => {
	it('includes COMMAND_EXECUTION_ERROR', () => {
		expect(ErrorCodes.COMMAND_EXECUTION_ERROR).toBe('COMMAND_EXECUTION_ERROR');
	});
});

describe('isCommandError', () => {
	it('returns true for valid CommandError objects', () => {
		expect(isCommandError({ code: 'ERR', message: 'msg' })).toBe(true);
	});

	it('returns true for errors with extra fields', () => {
		expect(
			isCommandError({ code: 'ERR', message: 'msg', suggestion: 'try again', retryable: true })
		).toBe(true);
	});

	it('returns false for null', () => {
		expect(isCommandError(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isCommandError(undefined)).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isCommandError('string')).toBe(false);
		expect(isCommandError(42)).toBe(false);
		expect(isCommandError(true)).toBe(false);
	});

	it('returns false for objects missing code', () => {
		expect(isCommandError({ message: 'msg' })).toBe(false);
	});

	it('returns false for objects missing message', () => {
		expect(isCommandError({ code: 'ERR' })).toBe(false);
	});

	it('returns false when code is not a string', () => {
		expect(isCommandError({ code: 42, message: 'msg' })).toBe(false);
	});

	it('returns false when message is not a string', () => {
		expect(isCommandError({ code: 'ERR', message: 42 })).toBe(false);
	});

	it('returns false for Error instances that carry a string code', () => {
		const systemError = Object.assign(new Error('ENOENT: no such file'), {
			code: 'ENOENT',
			path: '/etc/secret',
		});
		expect(isCommandError(systemError)).toBe(false);
	});

	it('returns false for Error objects from another realm', () => {
		const foreign: unknown = runInNewContext(
			"Object.assign(new Error('permission denied'), { code: 'EACCES' })"
		);
		expect(foreign instanceof Error).toBe(false);
		expect(isCommandError(foreign)).toBe(false);
		expect(Object.keys(wrapError(foreign))).not.toContain('stack');
	});
});
