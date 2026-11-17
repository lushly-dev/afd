/**
 * @fileoverview Content checks for the workflows `violet cicd setup` generates
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiSpec } from '@lushly-dev/violet-afd';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
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
		if (template !== 'snapshot') expect(uses.length).toBeGreaterThan(0);
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

	it('snapshot runs daily and manually against a persistent runner database', () => {
		const workflow = parseYaml(workflows.snapshot);
		expect(workflow.on).toEqual({
			schedule: [{ cron: '17 3 * * *' }],
			workflow_dispatch: null,
		});
		expect(workflow.permissions).toEqual({});
		expect(workflow.concurrency).toEqual({ group: 'violet-snapshot', 'cancel-in-progress': false });
		const job = workflow.jobs.snapshot;
		expect(job['runs-on']).toEqual(['self-hosted', 'linux', 'violet']);
		expect(job.env.VIOLET_NODE).toBe('brand-dark');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression
		expect(job.env.VIOLET_DB_PATH).toBe('${{ vars.VIOLET_DB_PATH }}');
		expect(job.steps).toHaveLength(1);
		expect(job.steps[0].run).toContain(
			'violet --db "$VIOLET_DB_PATH" --json snapshot --root "$VIOLET_NODE"',
		);
		expect(workflows.snapshot).not.toContain('uses:');
		expect(job.steps[0].run).not.toContain('--from');
		expect(workflows.snapshot).toContain('indefinitely');
	});

	// These cases run the step under bash as a Linux runner does; Windows has none (#1437).
	const linux = it.skipIf(process.platform === 'win32');

	linux('snapshot refuses a missing or relative database before running Violet', () => {
		const script = parseYaml(workflows.snapshot).jobs.snapshot.steps[0].run;
		for (const db of ['', 'relative.db', '/nonexistent-violet-497/database.db']) {
			const result = spawnSync('bash', ['-e', '-c', script], {
				env: { ...process.env, VIOLET_DB_PATH: db, VIOLET_NODE: 'brand-dark' },
				encoding: 'utf-8',
			});
			expect(result.status).toBe(1);
			expect(result.stdout).toContain('::error::Set VIOLET_DB_PATH');
		}
	});

	it.each(['null', 'true', '001'])(
		'snapshot preserves the literal node ID %s through YAML parsing',
		(node) => {
			const workflow = parseYaml(getWorkflowTemplate('snapshot', { ...options, node }));
			expect(workflow.jobs.snapshot.env.VIOLET_NODE).toBe(node);
		},
	);

	linux('snapshot preserves database paths and propagates CLI failure', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'violet-snapshot-'));
		try {
			const db = path.join(dir, 'live history.db');
			fs.writeFileSync(db, 'existing database');
			// A stand-in checks shell argument boundaries and the runner job's exit status.
			fs.writeFileSync(path.join(dir, 'violet'), '#!/bin/bash\nprintf "[%s]\\n" "$@"\nexit 7\n', {
				mode: 0o755,
			});
			const result = spawnSync(
				'/bin/bash',
				['-e', '-c', parseYaml(workflows.snapshot).jobs.snapshot.steps[0].run],
				{
					env: { ...process.env, PATH: dir, VIOLET_DB_PATH: db, VIOLET_NODE: 'brand-dark' },
					encoding: 'utf-8',
				},
			);
			expect(result.status).toBe(7);
			expect(result.stdout.trim().split('\n')).toEqual([
				'[--db]',
				`[${db}]`,
				'[--json]',
				'[snapshot]',
				'[--root]',
				'[brand-dark]',
			]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('sync fetches a hosted export with curl --fail, a required URL and a secret key', () => {
		const sync = workflows.sync;
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a template
		expect(sync).toContain('VIOLET_API_URL: ${{ vars.VIOLET_API_URL }}\n');
		expect(sync).not.toContain('api.violet.design');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a template
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
