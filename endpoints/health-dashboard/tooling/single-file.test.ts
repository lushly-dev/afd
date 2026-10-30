import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { singleFile } from './single-file';

const PAGE =
	'<html><head><script type="module" crossorigin src="./assets/index-1.js"></script>\n<link rel="stylesheet" crossorigin href="./assets/index-1.css"></head><body></body></html>';

function bundle(code = 'console.log(1);', css = 'body{margin:0}') {
	return {
		'index.html': { type: 'asset', fileName: 'index.html', source: PAGE },
		'assets/index-1.js': { type: 'chunk', fileName: 'assets/index-1.js', code },
		'assets/index-1.css': { type: 'asset', fileName: 'assets/index-1.css', source: css },
	} as Record<string, { type: string; fileName: string; source?: string; code?: string }>;
}

const run = (files: ReturnType<typeof bundle>) =>
	(singleFile().generateBundle as (options: unknown, bundle: unknown) => void)({}, files);
const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

describe('single-file plugin', () => {
	it('inlines the script and stylesheet and pins them by hash', () => {
		const files = bundle();
		run(files);
		expect(Object.keys(files)).toEqual(['index.html']);
		const page = String(files['index.html']?.source);
		expect(page).toContain('<script type="module">console.log(1);</script>');
		expect(page).toContain('<style>body{margin:0}</style>');
		expect(page).toContain(`script-src ${hash('console.log(1);')}`);
		expect(page).toContain(`style-src ${hash('body{margin:0}')}`);
		expect(page).not.toContain('assets/');
	});

	it('refuses code that would end the inline element early', () => {
		expect(() => run(bundle('"</script>"'))).toThrow(/closing script/);
	});

	it('refuses an unexpected bundle shape', () => {
		const files = bundle();
		delete files['assets/index-1.css'];
		expect(() => run(files)).toThrow(/one stylesheet/);
	});
});
