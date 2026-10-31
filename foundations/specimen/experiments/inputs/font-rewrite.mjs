/** Dependency-free, so a consumer's own Vitest config can load it from outside the snapshot. */
const STYLESHEET = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s<>]+/g;

/** Every Google Fonts stylesheet URL in an HTML fragment, with `&amp;` decoded. */
export function stylesheetUrls(html) {
	return [...new Set([...html.matchAll(STYLESHEET)].map(([url]) => url.replaceAll('&amp;', '&')))];
}

/** Replace live stylesheet links with the local font server and drop preconnects to Google. */
export function rewriteHtml(html, record, base) {
	let rewritten = html.replace(
		/<link[^>]*rel=["']preconnect["'][^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/g,
		''
	);
	for (const sheet of record.stylesheets)
		for (const form of [sheet.url, sheet.url.replaceAll('&', '&amp;')])
			rewritten = rewritten.replaceAll(form, `${base}/css/${sheet.sha256}`);
	return rewritten;
}
