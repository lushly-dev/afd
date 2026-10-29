/**
 * Optional `?report=<relative path>` loading for a locally served dashboard.
 *
 * Only same-origin relative paths are accepted; absolute URLs, scheme-relative URLs and
 * other schemes are refused before any request. The page's Content Security Policy
 * (`connect-src 'self'`) enforces the same limit independently.
 */
import { failure, type LoadResult, MAX_REPORT_BYTES, parseReport } from './validate';

export interface ReportRequest {
	/** The parameter exactly as given; used as the report's display name. */
	source: string;
	url?: URL;
	/** Set when the page itself isn't served over HTTP(S), so no path can load. */
	refusal?: 'needs-server';
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** Every `report` parameter, resolved against the page, with non-relative values refused. */
export function reportRequests(search: string, base: string): ReportRequest[] {
	const page = new URL(base);
	const served = /^https?:$/.test(page.protocol);
	return new URLSearchParams(search).getAll('report').map((source) => {
		if (!served) return { source, refusal: 'needs-server' as const };
		const value = source.trim();
		if (!value || SCHEME.test(value) || value.startsWith('//') || value.includes('\\'))
			return { source };
		const url = new URL(value, page);
		return url.origin === page.origin && /^https?:$/.test(url.protocol)
			? { source, url }
			: { source };
	});
}

type Fetch = (input: URL, init: RequestInit) => Promise<Response>;

export async function fetchReport(
	request: ReportRequest,
	fetchImpl: Fetch = (input, init) => fetch(input, init)
): Promise<LoadResult> {
	if (request.refusal) return failure(request.source, request.refusal);
	if (!request.url) return failure(request.source, 'not-relative');
	let response: Response;
	try {
		response = await fetchImpl(request.url, {
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
		});
	} catch {
		return failure(request.source, 'unreachable');
	}
	if (!response.ok)
		return failure(request.source, 'unreachable', [`HTTP status ${response.status}`]);
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES)
		return failure(request.source, 'too-large');
	let text: string;
	try {
		text = await response.text();
	} catch {
		return failure(request.source, 'unreachable');
	}
	return parseReport(text, request.source);
}
