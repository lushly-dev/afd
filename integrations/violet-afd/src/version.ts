import { readFileSync } from 'node:fs';

/** This package's version, read from its manifest so a release bump needs no source change. */
export const PACKAGE_VERSION: string = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
