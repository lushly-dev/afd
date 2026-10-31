/**
 * Vite plugin: inline the one script and stylesheet into `index.html` and pin them with
 * a hash-based Content Security Policy. The result is a single static file that works
 * from `file://` or any static server and cannot load or send anything else.
 */
import { createHash } from 'node:crypto';
import type { Plugin, Rollup } from 'vite';

type OutputAsset = Rollup.OutputAsset;
type OutputChunk = Rollup.OutputChunk;

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

export function contentSecurityPolicy(scriptHash: string, styleHash: string): string {
	return [
		"default-src 'none'",
		`script-src ${scriptHash}`,
		`style-src ${styleHash}`,
		// `?report=` paths on the serving origin only; nothing is ever sent elsewhere.
		"connect-src 'self'",
		"img-src 'self' data:",
		"base-uri 'none'",
		"form-action 'none'",
	].join('; ');
}

export function singleFile(): Plugin {
	return {
		name: 'health-dashboard-single-file',
		apply: 'build',
		enforce: 'post',
		generateBundle(_options, bundle) {
			const html = bundle['index.html'] as OutputAsset | undefined;
			const chunks = Object.values(bundle).filter(
				(item): item is OutputChunk => item.type === 'chunk'
			);
			const styles = Object.values(bundle).filter(
				(item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.css')
			);
			if (!html || chunks.length !== 1 || styles.length !== 1)
				throw new Error('Expected one HTML page, one script chunk and one stylesheet');
			const [chunk] = chunks as [OutputChunk];
			const [style] = styles as [OutputAsset];
			const script = chunk.code;
			const css = String(style.source);
			if (/<\/script/i.test(script) || /<\/style/i.test(css))
				throw new Error('Inlined code must not contain a closing script or style tag');
			let page = String(html.source)
				.replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, () => '')
				.replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => '');
			if (page.includes(chunk.fileName) || page.includes(style.fileName))
				throw new Error('Could not replace the bundled script or stylesheet reference');
			const csp = contentSecurityPolicy(sha256(script), sha256(css));
			page = page.replace(
				'</head>',
				() =>
					`\t<meta http-equiv="Content-Security-Policy" content="${csp}" />\n\t\t<style>${css}</style>\n\t\t<script type="module">${script}</script>\n\t</head>`
			);
			html.source = page;
			delete bundle[chunk.fileName];
			delete bundle[style.fileName];
		},
	};
}
