import { defineConfig } from 'vite';
import { reportValidator } from './tooling/report-validator.ts';
import { singleFile } from './tooling/single-file.ts';

export default defineConfig({
	base: './',
	plugins: [reportValidator(), singleFile()],
	build: {
		target: 'es2022',
		outDir: 'dist',
		emptyOutDir: true,
		assetsInlineLimit: Number.POSITIVE_INFINITY,
		cssCodeSplit: false,
		modulePreload: false,
		reportCompressedSize: false,
		rolldownOptions: { output: { codeSplitting: false } },
	},
});
