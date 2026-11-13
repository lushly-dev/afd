import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { markPath, reminder, TOOL, tagsIn } from './components-brief-hook.mjs';

const root = '/repo';
const script = fileURLToPath(new URL('./components-brief-hook.mjs', import.meta.url));
const write = (file_path, content) => ({ tool_name: 'Write', tool_input: { file_path, content } });

test('the tags a page names, in markup and in code, once each', () => {
	assert.deepEqual(
		tagsIn(
			`<violet-button appearance="accent"></violet-button>\ndocument.createElement('violet-text-field');\nconst t = "violet-button";`
		),
		['violet-button', 'violet-text-field']
	);
	assert.deepEqual(tagsIn('a violet-elements import path: @lushly-dev/violet-elements'), []);
	assert.deepEqual(tagsIn('.violet-like { color: violet }'), []);
});

test('refuses a page with violet tags once, naming the tool and the tags', () => {
	const output = reminder(
		write('/repo/endpoints/loam/packages/console/src/view.ts', '<violet-spinner size="sm">'),
		{
			root,
			marked: false,
		}
	);
	assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
	// Refused, so the reminder arrives before the file is written; never an allow, which would
	// skip the permission flow.
	assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
	const reason = output.hookSpecificOutput.permissionDecisionReason;
	assert.match(reason, /this edit uses violet-spinner\./);
	assert.ok(reason.includes(`\`${TOOL}\``));
	assert.match(reason, /once a session/);
	const edit = {
		tool_name: 'Edit',
		tool_input: {
			file_path: 'apps/notes/src/page.ts',
			old_string: 'x',
			new_string: '<violet-dialog open>',
		},
	};
	assert.ok(reminder(edit, { root, marked: false }));
});

test('is quiet once the session is marked, and for anything that is not a page using the library', () => {
	const page = write('/repo/apps/notes/src/page.ts', '<violet-button>');
	assert.equal(reminder(page, { root, marked: true }), undefined);
	assert.equal(
		reminder(write('/repo/docs/notes.md', '<violet-button>'), { root, marked: false }),
		undefined
	);
	assert.equal(
		reminder(write('/repo/apps/notes/src/page.ts', '<div>'), { root, marked: false }),
		undefined
	);
	assert.equal(
		reminder(
			write(
				'/repo/foundations/fast-af/packages/violet-elements/src/button/button.stories.ts',
				'<violet-button>'
			),
			{ root, marked: false }
		),
		undefined
	);
	assert.equal(
		reminder(
			{ tool_name: 'Read', tool_input: { file_path: '/repo/a.ts' } },
			{ root, marked: false }
		),
		undefined
	);
});

test('a session id becomes a safe file name', () => {
	assert.equal(markPath('../../etc/passwd', '/m'), join('/m', '______etc_passwd'));
	assert.equal(markPath('', '/m'), join('/m', 'unknown'));
});

test('run as hooks: pre refuses once, then lets every write through', (t) => {
	const tmp = mkdtempSync(join(tmpdir(), 'components-brief-hook-'));
	t.after(() => rmSync(tmp, { recursive: true, force: true }));
	const session = `test-${process.pid}-${Date.now()}`;
	const mark = markPath(session);
	t.after(() => rmSync(mark, { force: true }));
	const run = (mode, event) =>
		spawnSync(process.execPath, [script, mode], {
			input: JSON.stringify({ session_id: session, cwd: tmp, ...event }),
			encoding: 'utf8',
			env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
		});
	const page = write(join(tmp, 'page.ts'), '<violet-select></violet-select>');
	assert.equal(run('post', { tool_name: 'Read' }).status, 0);
	assert.equal(existsSync(mark), false, 'only the brief tool marks the session');
	const first = run('pre', page);
	assert.equal(first.status, 0);
	assert.match(
		JSON.parse(first.stdout).hookSpecificOutput.permissionDecisionReason,
		/violet-select/
	);
	assert.match(readFileSync(mark, 'utf8'), /^refused /);
	assert.equal(run('pre', page).stdout, '', 'refused once a session');
	rmSync(mark);
	assert.equal(run('post', { tool_name: TOOL }).status, 0);
	assert.match(readFileSync(mark, 'utf8'), /^briefed /);
	assert.equal(run('pre', page).stdout, '', 'a session that briefed is never refused');
	// Input it cannot read is not an error.
	const broken = spawnSync(process.execPath, [script, 'pre'], {
		input: 'not json',
		encoding: 'utf8',
	});
	assert.equal(broken.status, 0);
	assert.equal(broken.stdout, '');
});
