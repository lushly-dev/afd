/**
 * P6-E4's mapping (phase 6 specification, 6.1; step 5): `server-call.ts` maps the transport's `200` to the body's result
 * and generation, a `401` to afd-auth's `UNAUTHORIZED` and runs the session refresh at once, a `400`, `403` or `404` to
 * the body's code with its message and suggestion, and a `5xx`, a network failure or an answer that is not the
 * transport's to `SERVER_UNAVAILABLE`, retryable.
 */

import { describe, expect, it, vi } from 'vitest';
import { serverCall } from './server-call.js';

const REQUEST = {
	command: 'project-create',
	input: { name: 'Delta' },
	scope: { workspace: 'acme' },
};
const URL_ = 'https://loam.example/loam/api/kernel/call';

const answering = (status: number, body: unknown) =>
	vi.fn(
		async () =>
			new Response(typeof body === 'string' ? body : JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' },
			})
	);

describe("P6-E4: server-call.ts's mapping of the transport's answers", () => {
	it('posts the call as same-origin JSON, and maps 200 to the result and its generation', async () => {
		const fetch = answering(200, {
			result: { success: true, data: { id: 'prj_1' } },
			generation: 'g1',
		});
		const refreshSession = vi.fn();
		const answer = await serverCall({ url: URL_, refreshSession, fetch }, REQUEST);
		expect(answer).toEqual({ result: { success: true, data: { id: 'prj_1' } }, generation: 'g1' });
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(URL_);
		expect(init).toMatchObject({
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
		});
		expect(JSON.parse(init.body as string)).toEqual(REQUEST);
		expect((init.headers as Record<string, string>)['loam-person']).toBeUndefined();
		expect(refreshSession).not.toHaveBeenCalled();
	});

	it('sends the person the call was made as in Loam-Person, never in the body', async () => {
		const fetch = answering(200, { result: { success: true }, generation: 'g' });
		await serverCall(
			{ url: URL_, refreshSession: vi.fn(), fetch },
			{ ...REQUEST, person: 'usr_1' }
		);
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect((init.headers as Record<string, string>)['loam-person']).toBe('usr_1');
		expect(JSON.parse(init.body as string)).toEqual(REQUEST);
	});

	it("passes a refusal the server answered 200 through unchanged, the server's code its own", async () => {
		const refused = {
			success: false,
			error: {
				code: 'OWNER_REQUIRED',
				message: 'No',
				suggestion: 'Ask an owner',
				retryable: false,
			},
		};
		const answer = await serverCall(
			{
				url: URL_,
				refreshSession: vi.fn(),
				fetch: answering(200, { result: refused, generation: 'g' }),
			},
			REQUEST
		);
		expect(answer.result).toEqual(refused);
	});

	it('maps 401 to UNAUTHORIZED and runs the session refresh at once', async () => {
		const refreshSession = vi.fn();
		const answer = await serverCall(
			{ url: URL_, refreshSession, fetch: answering(401, { code: 'UNAUTHORIZED', message: 'x' }) },
			REQUEST
		);
		expect(answer.result.error).toMatchObject({
			code: 'UNAUTHORIZED',
			suggestion: 'Sign in again',
		});
		expect(answer.generation).toBeUndefined();
		expect(refreshSession).toHaveBeenCalledTimes(1);
	});

	it('runs the session refresh on 409 SESSION_CHANGED too', async () => {
		const refreshSession = vi.fn();
		await serverCall(
			{
				url: URL_,
				refreshSession,
				fetch: answering(409, { code: 'SESSION_CHANGED', message: 'x' }),
			},
			REQUEST
		);
		expect(refreshSession).toHaveBeenCalledTimes(1);
	});

	it.each([
		[400, 'REQUEST_INVALID'],
		[403, 'REQUEST_NOT_SAME_ORIGIN'],
		[404, 'SERVER_COMMAND_NOT_SERVED'],
		[409, 'SESSION_CHANGED'],
		[413, 'REQUEST_TOO_LARGE'],
	])('maps %i to the body’s code, %s, with its message and suggestion', async (status, code) => {
		const answer = await serverCall(
			{
				url: URL_,
				refreshSession: vi.fn(),
				fetch: answering(status, { code, message: 'Refused', suggestion: 'Do this' }),
			},
			REQUEST
		);
		expect(answer.result).toEqual({
			success: false,
			error: { code, message: 'Refused', suggestion: 'Do this', retryable: false },
		});
	});

	it.each([
		['a 500', answering(500, 'boom')],
		['a 503', answering(503, { code: 'X' })],
		['a network failure', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))],
		['a 200 that is not a result', answering(200, { result: { nope: 1 } })],
		['a 200 that is not JSON', answering(200, '<html>')],
	])('maps %s to SERVER_UNAVAILABLE, retryable', async (_label, fetch) => {
		const answer = await serverCall(
			{ url: URL_, refreshSession: vi.fn(), fetch: fetch as never },
			REQUEST
		);
		expect(answer.result.error).toMatchObject({
			code: 'SERVER_UNAVAILABLE',
			retryable: true,
			suggestion: 'Try again; the hosted server did not answer',
		});
		expect(answer.generation).toBeUndefined();
	});
});
