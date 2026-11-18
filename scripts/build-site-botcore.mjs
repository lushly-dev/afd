#!/usr/bin/env node
/**
 * Record what the Botcore page shows.
 *
 * Botcore is a Python package: commands, skills and an MCP server for the
 * agents that work in a repository. It cannot run in a browser tab, so the
 * page shows a real run of it instead, recorded here and never edited. The run
 * does what the page says Botcore is for:
 *
 * 1. It makes a small Python project, `ledger`, in a temporary directory: one
 *    module with a lint error in it, one test, and nothing of Botcore's.
 * 2. `botcore init` sets it up. The same line is run in a TypeScript and a
 *    Rust project too, to record which tools Botcore picks for each.
 * 3. An agent's session over MCP: it lists the tools, asks what there is, reads
 *    one page of the reference, then lints, fixes and tests the project.
 * 4. The skills Botcore seeded are made to drift: one is set back a version
 *    and the project adds a skill of its own. `skill-status` and
 *    `skill-seed --update` are recorded before and after.
 * 5. The project adds a command of its own as a plugin, and a second MCP
 *    session records what changed in the tool list (nothing but one word).
 * 6. The same commands are registered one tool each, with the same MCP
 *    library, and that tool list is recorded for comparison.
 *
 * Botcore prints absolute paths. The temporary directory's path is written
 * `<workspace>` in the record, and that is the only change made to any output;
 * a result that still names a place on this machine is refused.
 *
 * The output is committed, so the site deploys without Python. Run it again
 * when Botcore changes:
 *
 *   node scripts/build-site-botcore.mjs
 *
 * It needs `uv`, which builds Botcore from endpoints/botcore on first use.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'endpoints/botcore');
const out = join(root, 'site/botcore');

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'afd-site-botcore-')));
const workspace = join(base, 'ledger');

/** Anything that names a place on this machine. */
const LOCAL = /(?<![A-Za-z])[A-Za-z]:\\|\/Users\/|\/home\/|\/tmp\/|\/var\/folders\/|\/private\//;

/** The one edit: the temporary directory's path, however it was escaped, becomes a placeholder. */
function place(id, text) {
	let result = text;
	for (const [dir, name] of [
		[workspace, '<workspace>'],
		[base, '<tmp>'],
	]) {
		const once = JSON.stringify(dir).slice(1, -1);
		const twice = JSON.stringify(once).slice(1, -1);
		for (const form of [twice, once, dir, dir.replaceAll('\\', '/')])
			result = result.split(form).join(name);
	}
	if (LOCAL.test(result))
		throw new Error(`${id} names a local path; it cannot be published:\n${result.slice(0, 600)}`);
	return result;
}

const file = (dir, path, text) => {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
};

/** The command line for Botcore built from this repository, with any plugin installed beside it. */
const botcore = (plugins = []) => [
	'run',
	'--frozen',
	'--project',
	source,
	'--extra',
	'mcp',
	'--extra',
	'dev',
	...plugins.flatMap((dir) => ['--with-editable', dir]),
	'botcore',
];

function run(id, line, args, { cwd = workspace, plugins = [] } = {}) {
	const result = spawnSync('uv', [...botcore(plugins), ...args], {
		cwd,
		encoding: 'utf8',
		timeout: 300_000,
	});
	if (result.status === null)
		throw new Error(`${line} did not finish: ${result.error ?? result.signal}`);
	console.log(`${result.status === 0 ? 'ok    ' : `exit ${result.status}`}  ${line}`);
	return { id, line, exit: result.status, stdout: place(id, result.stdout) };
}

/** One MCP session over stdio: a request at a time, as a harness sends them. */
async function session(calls, { plugins = [] } = {}) {
	const child = spawn('uv', [...botcore(plugins), 'serve'], { cwd: workspace });
	const waiting = new Map();
	let buffer = '';
	let stderr = '';
	child.stderr.setEncoding('utf8').on('data', (chunk) => {
		stderr += chunk;
	});
	child.stdout.setEncoding('utf8').on('data', (chunk) => {
		buffer += chunk;
		for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
			const line = buffer.slice(0, at).trim();
			buffer = buffer.slice(at + 1);
			if (!line) continue;
			const message = JSON.parse(line);
			waiting.get(message.id)?.(message);
			waiting.delete(message.id);
		}
	});
	const gone = new Promise((_, reject) => {
		child.on('exit', (code) =>
			reject(new Error(`botcore serve ended (exit ${code}):\n${stderr.slice(-800)}`))
		);
	});
	gone.catch(() => {});
	let next = 0;
	const ask = (method, params) => {
		next += 1;
		const id = next;
		const answer = new Promise((resolve) => waiting.set(id, resolve));
		child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
		return Promise.race([answer, gone]);
	};

	const hello = await ask('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'afd-site', version: '1' },
	});
	child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
	const listed = await ask('tools/list');
	const tools = listed.result.tools.map(({ name, description, inputSchema }) => ({
		name,
		description,
		inputSchema,
	}));
	const answers = [];
	for (const [id, tool, args] of calls) {
		const message = await ask('tools/call', { name: tool, arguments: args });
		if (!message.result) throw new Error(`${id}: ${JSON.stringify(message.error)}`);
		const text = message.result.content.map((part) => part.text).join('');
		answers.push({
			id,
			tool,
			arguments: args,
			isError: message.result.isError === true,
			text: place(id, text),
		});
		console.log(`ok      ${tool} ${JSON.stringify(args).slice(0, 70)}`);
	}
	child.removeAllListeners('exit');
	child.stdin.end();
	await new Promise((resolve) => child.on('exit', resolve));
	return {
		server: hello.result.serverInfo,
		protocol: hello.result.protocolVersion,
		tools,
		calls: answers,
	};
}

// ── A project that has never seen Botcore ───────────────────────────────

const FILES = {
	'pyproject.toml': `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "ledger"
version = "0.1.0"
requires-python = ">=3.11"

[tool.pytest.ini_options]
pythonpath = ["src"]

[tool.ruff.lint]
select = ["E", "F"]
`,
	'src/ledger/__init__.py': '"""A ledger: entries, and what they add up to."""\n',
	'src/ledger/totals.py': `"""Add up a ledger's entries."""

import os
from decimal import Decimal


def total(amounts: list[str]) -> Decimal:
    """The sum of the amounts, as exact decimals."""
    return sum((Decimal(amount) for amount in amounts), Decimal("0"))
`,
	'tests/test_totals.py': `from decimal import Decimal

from ledger.totals import total


def test_total_is_exact():
    assert total(["0.10", "0.20"]) == Decimal("0.30")


def test_no_entries_is_zero():
    assert total([]) == Decimal("0")
`,
	'entries.csv': 'account,amount\ncash,120.00\ncash,-45.50\nsavings,300.00\n',
};
for (const [path, text] of Object.entries(FILES)) file(workspace, path, text);

const init = run('init', 'botcore init --non-interactive --json', [
	'init',
	'--non-interactive',
	'--json',
]);
const config = readFileSync(join(workspace, 'botcore.toml'), 'utf8');

// The same line in two other kinds of project: which tools does it pick?
const languages = [{ marker: 'pyproject.toml', init: JSON.parse(init.stdout), config }];
for (const [marker, text] of [
	['package.json', '{ "name": "ledger", "private": true }\n'],
	['Cargo.toml', '[package]\nname = "ledger"\nversion = "0.1.0"\nedition = "2021"\n'],
]) {
	const dir = join(base, marker.replace('.', '-'), 'ledger');
	file(dir, marker, text);
	const result = spawnSync(
		'uv',
		[...botcore(), 'init', '--non-interactive', '--no-skills', '--json'],
		{
			cwd: dir,
			encoding: 'utf8',
			timeout: 300_000,
		}
	);
	console.log(`ok      botcore init --non-interactive --json  (${marker})`);
	// Each of these has a directory of its own; in the record all three are the workspace.
	const answer = JSON.parse(result.stdout);
	answer.config_path = answer.config_path.replace(dir, workspace);
	languages.push({
		marker,
		init: JSON.parse(place(marker, JSON.stringify(answer))),
		config: readFileSync(join(dir, 'botcore.toml'), 'utf8'),
	});
}

// ── An agent's session ───────────────────────────────────────────────────

/** The run tool takes Python. A command's result is a model; this turns it into plain data. */
const call = (expression) =>
	`result = await ${expression}\nreturn result.model_dump(exclude_none=True)`;

const first = await session([
	['start', 'botcore-start', {}],
	['topics', 'botcore-docs', {}],
	['docs-dev', 'botcore-docs', { topic: 'dev' }],
	['lint', 'botcore-run', { code: call('dev_lint()') }],
	['fix', 'botcore-run', { code: call('dev_lint(fix=True)') }],
	['test', 'botcore-run', { code: call('dev_test()') }],
	['no-topic', 'botcore-docs', { topic: 'deploy' }],
]);
const fixed = readFileSync(join(workspace, 'src/ledger/totals.py'), 'utf8');

// Every page of the reference, so the page can add up what reading each one costs.
const topics = JSON.parse(first.calls.find((item) => item.id === 'start').text).topics;
const reference = (
	await session(topics.map((topic) => [`docs-${topic}`, 'botcore-docs', { topic }]))
).calls.map((item) => ({ topic: item.arguments.topic, text: item.text }));

// ── Skills, and what happens when they drift ────────────────────────────

const skillsDir = join(workspace, '.claude/skills');
const seeded = readdirSync(skillsDir).sort();
const before = run('status-seeded', 'botcore --json skill-status', ['--json', 'skill-status']);

// Set one of Botcore's skills back a version, as a copy made months ago would be.
const stale = 'code-reviewer';
const stalePath = join(skillsDir, stale, 'SKILL.md');
const current = readFileSync(stalePath, 'utf8');
const versionLine = current.match(/^(\s*version:\s*)(.+)$/m);
if (!versionLine) throw new Error(`${stale} no longer carries a version line.`);
const older = '1.0.0';
writeFileSync(
	stalePath,
	current.replace(versionLine[0], `${versionLine[1]}${older}\n# Edited in this repository.`)
);
// And a skill this project wrote itself.
const LOCAL_SKILL = `---
name: ledger-rules
description: House rules for the ledger. Use when adding or changing an entry type.
---

# Ledger rules

Amounts are exact decimals, never floats. Every entry names its account.
`;
file(skillsDir, 'ledger-rules/SKILL.md', LOCAL_SKILL);

const drifted = run('status-drifted', 'botcore --json skill-status', ['--json', 'skill-status']);
const update = run('seed-update', 'botcore --json skill-seed --update', [
	'--json',
	'skill-seed',
	'--update',
]);
const after = run('status-updated', 'botcore --json skill-status', ['--json', 'skill-status']);
const lint = run('skill-lint', 'botcore --json skill-lint', ['--json', 'skill-lint']);
const localKept = readFileSync(join(skillsDir, 'ledger-rules/SKILL.md'), 'utf8') === LOCAL_SKILL;
// Did the update put Botcore's own copy back exactly, the edit gone?
const staleRestored = readFileSync(stalePath, 'utf8') === current;

// The way to keep an edit: name the skill under `skip`, edit it again, update again.
const SKIP_LINE = `skip = ["${stale}"]`;
const configPath = join(workspace, 'botcore.toml');
const configBefore = readFileSync(configPath, 'utf8');
if (!/^\[skills\]\r?$/m.test(configBefore))
	throw new Error('botcore.toml no longer has a [skills] table.');
writeFileSync(
	configPath,
	configBefore.replace(/^\[skills\]\r?$/m, (table) => `${table}\n${SKIP_LINE}`)
);
const edited = current.replace(versionLine[0], `${versionLine[0]}\n# Edited in this repository.`);
writeFileSync(stalePath, edited);
const skipUpdate = run('seed-skip', 'botcore --json skill-seed --update', [
	'--json',
	'skill-seed',
	'--update',
]);
const skipKept = readFileSync(stalePath, 'utf8') === edited;

// ── The project's own command, as a plugin ──────────────────────────────

const PLUGIN = {
	'pyproject.toml': `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "ledger-bot"
version = "0.1.0"
dependencies = ["lushly-botcore"]

[project.entry-points."botcore.plugins"]
ledger = "ledger_bot:LedgerPlugin"

[tool.hatch.build.targets.wheel]
packages = ["ledger_bot"]
`,
	'ledger_bot/__init__.py': `"""This project's own commands, added to Botcore."""

import csv
from decimal import Decimal
from pathlib import Path

from afd import CommandResult, error, success

DOCS = """\\
# Ledger Commands

## ledger_balance(account="cash")
Add up the entries for one account in entries.csv.
"""


async def ledger_balance(account: str = "cash") -> CommandResult[dict]:
    """Add up the entries for one account."""
    with Path("entries.csv").open(newline="") as entries:
        amounts = [Decimal(row["amount"]) for row in csv.DictReader(entries) if row["account"] == account]
    if not amounts:
        return error(
            "ACCOUNT_NOT_FOUND",
            f"No entries for account '{account}'",
            suggestion="Check the account names in entries.csv",
        )
    return success(
        data={"account": account, "entries": len(amounts), "balance": str(sum(amounts))},
        reasoning=f"Added up {len(amounts)} entries for {account}",
    )


class LedgerPlugin:
    def register(self, registry) -> None:
        registry.add_commands([ledger_balance])
        registry.add_docs("ledger", DOCS)

    def config_schema(self):
        return None
`,
};
const pluginDir = join(workspace, 'tools/ledger-bot');
for (const [path, text] of Object.entries(PLUGIN)) file(pluginDir, path, text);

const second = await session(
	[
		['start', 'botcore-start', {}],
		['balance', 'botcore-run', { code: call('ledger_balance()') }],
		['no-account', 'botcore-run', { code: call('ledger_balance("petty")') }],
	],
	{ plugins: [pluginDir] }
);

// ── The same commands, one tool each ────────────────────────────────────

const FLAT = `"""Register every Botcore command as its own MCP tool, and print the tool list."""
import asyncio
import json

from botcore._mcp import sdk_types
from botcore.server import build_namespace

FastMCP, _ = sdk_types()
namespace, _registry = build_namespace()
server = FastMCP("flat")
skipped = []
for name in sorted(namespace):
    if not callable(namespace[name]):
        skipped.append(name)
        continue
    # Only the input side is compared, so no output schema is asked for.
    server.add_tool(namespace[name], name=name, structured_output=False)
tools =asyncio.run(server.list_tools())
print(json.dumps({
    "skipped": skipped,
    "tools": [
        {key: value for key, value in tool.model_dump(by_alias=True, exclude_none=True).items()
         if key in ("name", "description", "inputSchema")}
        for tool in tools
    ],
}))
`;
const flatScript = join(base, 'flat.py');
writeFileSync(flatScript, FLAT);
const flatRun = spawnSync('uv', [...botcore().slice(0, -1), 'python', flatScript], {
	cwd: workspace,
	encoding: 'utf8',
	timeout: 300_000,
});
if (flatRun.status !== 0)
	throw new Error(`The one-tool-each listing failed:\n${flatRun.stderr.slice(-1200)}`);
// Names, docstrings and schemas from Botcore's source: nothing of this machine's, so no path check
// (a docstring's example path would trip it).
const flat = JSON.parse(flatRun.stdout);
console.log(
	`ok      one tool each: ${flat.tools.length} tools${flat.skipped.length ? ` (not callable: ${flat.skipped.join(', ')})` : ''}`
);

// ── What produced it ────────────────────────────────────────────────────

const version = run('version', 'botcore --version', ['--version']).stdout.trim().split(' ').pop();
const git = (...args) =>
	execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd: root, encoding: 'utf8' }).trim();

mkdirSync(out, { recursive: true });
// Botcore's portability tool describes the paths it looks for with examples of them
// (a drive letter, a home directory). They name no place on this machine, but this
// repository's own portability check refuses them in a committed file, so the record
// names them instead. The only other change is <workspace> and <tmp>, above.
const EXAMPLE_PATHS = [
	// portability-ok: the example paths Botcore's own description names, replaced here
	['(C:\\\\, D:\\\\, etc.)', '(drive-letter paths)'],
	// portability-ok: as above
	['(/home/user, /Users/name)', '(home-directory paths)'],
];
const named = (json) =>
	EXAMPLE_PATHS.reduce(
		(text, [from, to]) => text.split(JSON.stringify(from).slice(1, -1)).join(to),
		json
	);
writeFileSync(
	join(out, 'runs.json'),
	`${named(
		JSON.stringify(
			{
				recorded: new Date().toISOString(),
				botcore: { version, platform: process.platform },
				source: { revision: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' },
				project: { files: FILES, fixed: { path: 'src/ledger/totals.py', text: fixed } },
				languages,
				session: { line: 'botcore serve', ...first },
				reference,
				skills: {
					seeded,
					stale: { name: stale, from: versionLine[2].trim(), to: older, restored: staleRestored },
					local: { name: 'ledger-rules', text: LOCAL_SKILL, kept: localKept },
					skip: { line: SKIP_LINE, kept: skipKept },
					runs: [before, drifted, update, after, lint, skipUpdate],
				},
				plugin: {
					dir: 'tools/ledger-bot',
					files: PLUGIN,
					session: { line: 'botcore serve', ...second },
				},
				flat,
			},
			null,
			'\t'
		)
	)}\n`
);
rmSync(base, { recursive: true, force: true });
console.log('Recorded → site/botcore/runs.json');
