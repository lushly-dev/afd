#!/usr/bin/env node
/**
 * Writes the committed types and facts in src/_generated/ and the standalone validators in dist/.
 * Fails when a schema does not compile under Ajv's strict mode, or a `$ref` does not resolve
 * against spec/. The validators need no `new Function` in the page.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileValidators, generateFacts, generateTypes, packageRoot } from './compile.mjs';

const generated = resolve(packageRoot, 'src/_generated');
const dist = resolve(packageRoot, 'dist');
mkdirSync(generated, { recursive: true });
mkdirSync(dist, { recursive: true });

for (const [file, source] of Object.entries(compileValidators()))
	writeFileSync(resolve(dist, file), source);
writeFileSync(resolve(generated, 'types.ts'), await generateTypes());
writeFileSync(resolve(generated, 'facts.ts'), generateFacts());
