/**
 * @fileoverview `@lushly-dev/loam-cli/vite`: `singleFileHtml()`, the Health dashboard's single-file
 * plugin without its CSP injection (phase 1 specification, 11.1). A view's resource and a handler
 * frame are one HTML file, because their frames can load nothing else. Each page is inlined where it
 * referenced its script and stylesheet; anything the bundle would still need beside it is an error.
 */

import type { Plugin, Rollup } from 'vite';

type OutputAsset = Rollup.OutputAsset;
type OutputBundle = Rollup.OutputBundle;
type OutputChunk = Rollup.OutputChunk;

const REFERENCE =
	/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>|<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>|<link\b[^>]*\brel="modulepreload"[^>]*>/g;

function named(bundle: OutputBundle, reference: string): OutputAsset | OutputChunk {
	const file = Object.keys(bundle).find((name) => reference.endsWith(name));
	if (!file) throw new Error(`A page references ${reference}, which is not in the bundle`);
	return bundle[file] as OutputAsset | OutputChunk;
}

function inlineScript(bundle: OutputBundle, reference: string, used: Set<string>): string {
	const chunk = named(bundle, reference);
	if (chunk.type !== 'chunk') throw new Error(`${reference} is not a script chunk`);
	if (chunk.imports.length > 0 || chunk.dynamicImports.length > 0) {
		throw new Error(
			`${chunk.fileName} imports other chunks; build each page on its own, with no dynamic import`
		);
	}
	// A script opened by `<!--` and `<script` would not end at its closing tag.
	if (/<\/script/i.test(chunk.code) || /<!--[\s\S]*<script/i.test(chunk.code)) {
		throw new Error('Inlined code must not contain a closing script or style tag');
	}
	used.add(chunk.fileName);
	return `<script type="module">${chunk.code}</script>`;
}

function inlineStyle(bundle: OutputBundle, reference: string, used: Set<string>): string {
	const asset = named(bundle, reference);
	if (asset.type !== 'asset') throw new Error(`${reference} is not a stylesheet`);
	const css = String(asset.source);
	if (/<\/style/i.test(css))
		throw new Error('Inlined code must not contain a closing script or style tag');
	used.add(asset.fileName);
	return `<style>${css}</style>`;
}

export function singleFileHtml(): Plugin {
	return {
		name: 'loam-single-file-html',
		apply: 'build',
		enforce: 'post',
		// Vite's preload polyfill would land in every page, with nothing there to preload.
		config: () => ({ build: { modulePreload: false } }),
		generateBundle(_options, bundle) {
			const pages = Object.values(bundle).filter(
				(item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.html')
			);
			if (pages.length === 0) throw new Error('Expected an HTML page in the bundle');
			const used = new Set<string>();
			for (const page of pages) {
				page.source = String(page.source).replace(
					REFERENCE,
					(_tag, script: string | undefined, style: string | undefined) => {
						if (script) return inlineScript(bundle, script, used);
						if (style) return inlineStyle(bundle, style, used);
						return '';
					}
				);
			}
			for (const file of used) delete bundle[file];
			const left = Object.keys(bundle).filter((file) => !file.endsWith('.html'));
			if (left.length > 0) {
				throw new Error(
					`A page must be one file, and these would sit beside it: ${left.join(', ')}`
				);
			}
		},
	};
}
