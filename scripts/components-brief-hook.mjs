#!/usr/bin/env node
/**
 * Claude Code hooks for this repository (`.claude/settings.json`): before a Write or Edit whose new
 * text uses a `violet-elements` tag, remind the agent to brief on those components with Umbel's
 * `components-brief`, until it has called it once in the session.
 *
 * Step C5 of Component Briefs found that design.md, the loam-design skill and AGENTS.md did not get
 * the tool called (2 of 3 sessions skipped it), because Claude Code defers MCP tools until something
 * names them; a sentence in the task naming it did. This names it at the moment it matters.
 *
 * Context a PreToolUse hook adds reaches the agent with the tool's result, after the file is written,
 * so the first such write in a session is refused once, with the reminder as the reason: the agent
 * briefs and writes again. Every later write goes ahead, briefed or not, so a session without the
 * `umbel` server is slowed by one refusal and never stopped.
 *
 *   node scripts/components-brief-hook.mjs pre    PreToolUse on Write|Edit: maybe refuse once
 *   node scripts/components-brief-hook.mjs post   PostToolUse on the brief tool: mark the session
 *
 * Each reads the hook's JSON on stdin. Any failure is silent: a reminder is not worth a broken edit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL = 'mcp__umbel__components-brief';

/** Files whose text can put a component on a page. */
const SOURCE = new Set(['.html', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue', '.svelte']);

/** The library itself: its authors work from its source, not from a brief of it. */
const LIBRARY = ['foundations', 'fast-af', 'packages', 'violet-elements'].join(sep);

/** A tag as markup or code names it: `<violet-button`, `'violet-button'`, `"violet-button"`. */
const TAG = /(?:<|['"`])(violet-[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/g;

/** The tags `text` uses, sorted, without repeats. */
export function tagsIn(text) {
	const found = new Set();
	for (const match of text.matchAll(TAG)) found.add(match[1]);
	return [...found].sort();
}

/** The new text a Write or Edit puts in its file. */
function newText(input) {
	if (typeof input?.content === 'string') return input.content;
	if (typeof input?.new_string === 'string') return input.new_string;
	return '';
}

/**
 * Where a session's mark lives: written when the hook has refused once or the session has briefed.
 * The id is reduced to safe characters.
 */
export function markPath(session, directory = join(tmpdir(), 'afd-components-brief')) {
	return join(directory, String(session).replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown');
}

/**
 * The hook's answer to one PreToolUse event, or `undefined` for none. `root` is the project
 * directory, `marked` whether the session has briefed or been refused once already.
 */
export function reminder(event, { root, marked }) {
	if (marked) return undefined;
	if (!['Write', 'Edit'].includes(event?.tool_name)) return undefined;
	const path = event.tool_input?.file_path;
	if (typeof path !== 'string' || !SOURCE.has(extname(path))) return undefined;
	const inside = relative(root, resolve(root, path));
	if (inside === LIBRARY || inside.startsWith(LIBRARY + sep)) return undefined;
	const tags = tagsIn(newText(event.tool_input));
	if (tags.length === 0) return undefined;
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: `Not written yet: this edit uses ${tags.join(', ')}. Before writing with violet-elements, brief on every component the change uses with the \`${TOOL}\` tool (one call, all the tags; load it with ToolSearch if it is deferred), follow its answer (attributes and values, usage and accessibility statements, shared rules; omitted names what components-open returns), then make the edit again. This is asked once a session: if the tool is not available, make the edit again as it was.`,
		},
	};
}

function readStdin() {
	try {
		return JSON.parse(readFileSync(0, 'utf8'));
	} catch {
		return undefined;
	}
}

function main(mode) {
	const event = readStdin();
	if (!event) return;
	const mark = markPath(event.session_id);
	const write = (why) => {
		mkdirSync(join(mark, '..'), { recursive: true });
		writeFileSync(mark, `${why} ${new Date().toISOString()}\n`);
	};
	if (mode === 'post') {
		if (event.tool_name === TOOL) write('briefed');
		return;
	}
	const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
	const output = reminder(event, { root, marked: existsSync(mark) });
	if (!output) return;
	write('refused');
	process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main(process.argv[2]);
	} catch {
		// Silent by design: see the header.
	}
}
