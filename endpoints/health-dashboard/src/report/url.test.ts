import { describe, expect, it } from 'vitest';
import { fixture } from './fixtures.test-helper';
import { fetchReport, reportRequests } from './url';
import { MAX_REPORT_BYTES } from './validate';

const PAGE = 'http://127.0.0.1:4173/dist/index.html';

describe('reportRequests', () => {
	it('resolves relative paths against the page', () => {
		const [request] = reportRequests('?report=reports/a.json', PAGE);
		expect(request?.url?.href).toBe('http://127.0.0.1:4173/dist/reports/a.json');
		const [up] = reportRequests('?report=../fixtures/b.json', PAGE);
		expect(up?.url?.href).toBe('http://127.0.0.1:4173/fixtures/b.json');
	});

	it.each([
		'https://example.com/report.json',
		'//example.com/report.json',
		'file:///etc/passwd',
		'data:application/json,{}',
		'javascript:alert(1)',
		'\\\\server\\share.json',
		'',
	])('refuses %s before any request', (value) => {
		const [request] = reportRequests(`?report=${encodeURIComponent(value)}`, PAGE);
		expect(request?.url).toBeUndefined();
	});

	it('refuses everything on a file:// page and says a server is needed', async () => {
		const [request] = reportRequests('?report=a.json', 'file:///reports/index.html');
		expect(request).toEqual({ source: 'a.json', refusal: 'needs-server' });
		expect(await fetchReport(request ?? { source: '' })).toMatchObject({ kind: 'needs-server' });
	});

	it('keeps every report parameter', () => {
		expect(reportRequests('?report=a.json&report=b.json&x=1', PAGE)).toHaveLength(2);
	});
});

describe('fetchReport', () => {
	const respond = (body: string, init?: ResponseInit) => async () => new Response(body, init);

	it('validates fetched text like a selected file', async () => {
		const [request] = reportRequests('?report=a.json', PAGE);
		const ok = await fetchReport(
			request ?? { source: '' },
			respond(fixture('reports/all-passed.report.json'))
		);
		expect(ok.ok).toBe(true);
		const bad = await fetchReport(request ?? { source: '' }, respond('{'));
		expect(bad).toMatchObject({ ok: false, kind: 'not-json' });
	});

	it('requests same-origin without following redirects', async () => {
		const [request] = reportRequests('?report=a.json', PAGE);
		let seen: RequestInit | undefined;
		await fetchReport(request ?? { source: '' }, async (_url, init) => {
			seen = init;
			return new Response('{}');
		});
		expect(seen).toMatchObject({
			credentials: 'same-origin',
			redirect: 'error',
			cache: 'no-store',
		});
	});

	it('explains refused, missing, failed and oversized requests', async () => {
		expect(await fetchReport({ source: 'https://x' })).toMatchObject({ kind: 'not-relative' });
		const [request] = reportRequests('?report=a.json', PAGE);
		const target = request ?? { source: '' };
		expect(await fetchReport(target, respond('', { status: 404 }))).toMatchObject({
			kind: 'unreachable',
			details: ['HTTP status 404'],
		});
		expect(await fetchReport(target, () => Promise.reject(new TypeError('offline')))).toMatchObject(
			{ kind: 'unreachable' }
		);
		expect(
			await fetchReport(
				target,
				respond('{}', { headers: { 'content-length': String(MAX_REPORT_BYTES + 1) } })
			)
		).toMatchObject({ kind: 'too-large' });
		const broken = {
			ok: true,
			status: 200,
			headers: new Headers(),
			text: () => Promise.reject(new Error('x')),
		};
		expect(await fetchReport(target, async () => broken as unknown as Response)).toMatchObject({
			kind: 'unreachable',
		});
	});
});
