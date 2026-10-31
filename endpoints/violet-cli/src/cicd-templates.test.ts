/**
 * @fileoverview Content checks for the workflows `violet cicd setup` generates
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiSpec } from '@lushly-dev/violet-afd';
import { describe, expect, it } from 'vitest';
import {
	ACTION_PINS,
	CICD_TEMPLATES,
	CLI_PACKAGE,
	HOSTED_EXPORT_FORMATS,
	getWorkflowTemplate,
} from './cicd-templates.js';

const options = { node: 'brand-dark', tokensDir: 'design/tokens' };
const workflows = Object.fromEntries(
	CICD_TEMPLATES.map((template) => [template, getWorkflowTemplate(template, options)]),
);
// Frozen copy of Violet's .github/workflows/ci.yml at the imported source revision
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures');

describe('cicd setup workflow templates', () => {
	it.each(CICD_TEMPLATES)('%s pins every action to a commit SHA', (template) => {
		const uses = workflows[template].match(/uses: .+/g) ?? [];
		expect(uses.length).toBeGreaterThan(0);
		for (const line of uses) {
			expect(line).toMatch(/^uses: [\w-]+\/[\w-]+@[0-9a-f]{40} # v\d/);
		}
		expect(workflows[template]).not.toMatch(/@v\d/);
	});

	it("uses the same action pins as Violet's own CI", () => {
		const ci = fs.readFileSync(path.join(fixtures, 'violet-ci.yml.txt'), 'utf-8');
		for (const pin of Object.values(ACTION_PINS)) {
			expect(ci).toContain(`uses: ${pin}`);
		}
	});

	it.each(CICD_TEMPLATES)('%s never runs npx violet without --no --', (template) => {
		const content = workflows[template];
		expect(content).not.toMatch(/npx violet\b/);
		// Without --, npx reads violet's own flags (--from, --json, --version) as npm config
		expect(content).not.toMatch(/npx --no violet\b/);
		expect(content).not.toContain('dashboard');
		expect(content).not.toMatch(/npm run tokens:/);
	});

	it.each(['validate', 'release'] as const)(
		'%s reads DTCG files with --from on Node 24 and names the CLI package',
		(template) => {
			const content = workflows[template];
			expect(content).toContain("node-version: '24'");
			expect(content).toContain('VIOLET_TOKENS_DIR: design/tokens');
			expect(content).toContain('VIOLET_NODE: brand-dark');
			expect(content).toContain(
				'npx --no -- violet --from "$VIOLET_TOKENS_DIR" cicd validate --node "$VIOLET_NODE"',
			);
			expect(content).toContain(`npm install --save-dev ${CLI_PACKAGE}`);
			expect(content).toContain('not on npm yet');
			expect(content).not.toContain('VIOLET_API_KEY');
		},
	);

	it('validate runs on changes to the tokens directory', () => {
		expect(workflows.validate).toContain("- 'design/tokens/**'");
	});

	it('sync fetches a hosted export with curl --fail, a required URL and a secret key', () => {
		const sync = workflows.sync;
		expect(sync).toContain('VIOLET_API_URL: ${{ vars.VIOLET_API_URL }}\n');
		expect(sync).not.toContain('api.violet.design');
		expect(sync).toContain('VIOLET_API_KEY: ${{ secrets.VIOLET_API_KEY }}');
		expect(sync).toContain('if [ -z "$VIOLET_API_URL" ]');
		expect(sync).toContain('curl --fail');
		expect(sync).toContain('/api/v1/export/$NODE_ID/$format');
		expect(sync.indexOf('mkdir -p "$VIOLET_OUTPUT_DIR"')).toBeGreaterThan(-1);
		expect(sync.indexOf('mkdir -p "$VIOLET_OUTPUT_DIR"')).toBeLessThan(sync.indexOf('curl --fail'));
		expect(sync).toContain('default: brand-dark');
		// The hosted path needs no CLI install
		expect(sync).not.toContain('npm ci');
		expect(sync).not.toContain('npx');
	});

	it('sync names native exports with their usual extensions', () => {
		expect(workflows.sync).toContain('typescript) ext=ts ;;');
		expect(workflows.sync).toContain('kotlin) ext=kt ;;');
	});

	it('hosted formats include the native ones the release workflow writes', () => {
		for (const format of ['swift', 'kotlin', 'dart']) {
			expect(HOSTED_EXPORT_FORMATS).toContain(format);
		}
	});

	it('hosted formats are the list the API routes and OpenAPI spec use', () => {
		const format = buildOpenApiSpec().paths['/api/v1/export/{nodeId}/{format}'].get.parameters.find(
			(p) => p.name === 'format',
		);
		expect(format?.schema.enum).toEqual([...HOSTED_EXPORT_FORMATS]);
		expect(workflows.sync).toContain(`Formats the API serves: ${HOSTED_EXPORT_FORMATS.join(' ')}`);
	});

	it('sync only asks for formats the hosted API serves', () => {
		const formats = workflows.sync.match(/VIOLET_FORMATS: (.+)/)?.[1].split(' ') ?? [];
		expect(formats.length).toBeGreaterThan(0);
		for (const format of formats) {
			expect(HOSTED_EXPORT_FORMATS).toContain(format);
		}
	});
});
