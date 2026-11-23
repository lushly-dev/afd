/**
 * Structural YAML parser for GitHub Actions workflow files (.github/workflows/*.yml).
 *
 * Replaces regex-based trigger extraction (`readTrigger`) with an indentation-aware block parser
 * that understands triggers (`push`, `pull_request`, `merge_group`, `schedule`, `workflow_call`,
 * `workflow_dispatch`), path filter lists (block and flow), jobs (`needs`, `if`, `uses`,
 * `timeout-minutes`, `defaults.run.working-directory`), and steps (`id`, `name`, `uses`, `run`,
 * `working-directory`, `if`).
 */

/** Strip an unquoted trailing YAML comment. */
function stripComment(value) {
	let quote = null;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
			return value.slice(0, i).trim();
		}
	}
	return value.trim();
}

function unquote(value) {
	const trimmed = stripComment(value).trim();
	if (
		trimmed.length >= 2 &&
		((trimmed[0] === "'" && trimmed.at(-1) === "'") ||
			(trimmed[0] === '"' && trimmed.at(-1) === '"'))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Partition lines into key entries at a fixed indentation level. */
function blockEntries(lines, indent) {
	const found = [];
	const keyRe = new RegExp(`^ {${indent}}([\\w-]+):(?:[ \\t]+(.*))?$`);
	for (const line of lines) {
		const match = keyRe.exec(line);
		if (match) {
			found.push({ key: match[1], value: stripComment(match[2] ?? ''), lines: [] });
		} else if (found.length > 0) {
			found.at(-1).lines.push(line);
		}
	}
	return found;
}

/** Parse a scalar string, handling `|`, `|-`, `>`, `>-` block scalars. */
function parseScalar(value, lines) {
	if (/^[>|][+-]?$/.test(value)) {
		const nonEmpty = lines.filter((line) => line.trim().length > 0);
		if (nonEmpty.length === 0) return '';
		const minIndent = Math.min(...nonEmpty.map((line) => line.match(/^ */)[0].length));
		const stripped = lines.map((line) => (line.trim().length > 0 ? line.slice(minIndent) : ''));
		while (stripped.length > 0 && stripped.at(-1) === '') stripped.pop();
		if (value.startsWith('|')) return stripped.join('\n');
		return stripped
			.map((line) => line.trim())
			.join(' ')
			.trim();
	}
	return unquote(value);
}

/** Parse a YAML string list in either flow (`[a, b]`) or block (`- a`) form. */
function parseStringList(value, lines) {
	const flow = /^\[(.*)\]$/.exec(value);
	if (flow) {
		if (!flow[1].trim()) return [];
		return flow[1]
			.split(',')
			.map((item) => unquote(item))
			.filter(Boolean);
	}
	if (value) return [unquote(value)];
	const items = [];
	let itemIndent = null;
	for (const line of lines) {
		if (/^\s*(#.*)?$/.test(line)) continue;
		const match = /^( *)- (.*)$/.exec(line);
		if (!match) break;
		if (itemIndent === null) itemIndent = match[1].length;
		else if (match[1].length !== itemIndent) break;
		items.push(unquote(match[2]));
	}
	return items;
}

/** Parse a `steps:` sequence into structured step objects. */
function parseSteps(lines) {
	const steps = [];
	let current = null;
	let stepIndent = null;

	for (const line of lines) {
		if (/^\s*(#.*)?$/.test(line)) {
			if (current) current.rawLines.push(line);
			continue;
		}
		const itemMatch = /^( *)- (.*)$/.exec(line);
		if (itemMatch && (stepIndent === null || itemMatch[1].length === stepIndent)) {
			stepIndent = itemMatch[1].length;
			current = { firstLine: itemMatch[2], rawLines: [] };
			steps.push(current);
		} else if (current) {
			current.rawLines.push(line);
		}
	}

	const keyIndent = (stepIndent ?? 6) + 2;
	return steps.map((step) => {
		const normalizedLines = [`${' '.repeat(keyIndent)}${step.firstLine}`, ...step.rawLines];
		const fields = new Map(
			blockEntries(normalizedLines, keyIndent).map((entry) => [entry.key, entry])
		);
		const get = (k) =>
			fields.has(k) ? parseScalar(fields.get(k).value, fields.get(k).lines) : undefined;
		return {
			id: get('id'),
			name: get('name'),
			uses: get('uses'),
			if: get('if'),
			workingDirectory: get('working-directory'),
			run: get('run'),
		};
	});
}

/**
 * Parse a GitHub Actions workflow YAML text into a structured object.
 */
export function parseWorkflow(text) {
	const lines = text.replaceAll('\r\n', '\n').split('\n');
	const top = new Map(blockEntries(lines, 0).map((entry) => [entry.key, entry]));
	const name = top.has('name') ? unquote(top.get('name').value) : null;

	const onEntry = top.get('on');
	const triggers = {};
	if (onEntry) {
		for (const trigger of blockEntries(onEntry.lines, 2)) {
			const fields = new Map(blockEntries(trigger.lines, 4).map((entry) => [entry.key, entry]));
			const parsed = {};
			if (fields.has('branches')) {
				parsed.branches = parseStringList(
					fields.get('branches').value,
					fields.get('branches').lines
				);
			}
			if (fields.has('paths')) {
				parsed.paths = parseStringList(fields.get('paths').value, fields.get('paths').lines);
			}
			if (fields.has('workflows')) {
				parsed.workflows = parseStringList(
					fields.get('workflows').value,
					fields.get('workflows').lines
				);
			}
			triggers[trigger.key] = parsed;
		}
	}

	const jobs = {};
	const jobsEntry = top.get('jobs');
	if (jobsEntry) {
		for (const jobEntry of blockEntries(jobsEntry.lines, 2)) {
			const fields = new Map(blockEntries(jobEntry.lines, 4).map((entry) => [entry.key, entry]));
			let defaultCwd;
			if (fields.has('defaults')) {
				const defEntries = new Map(
					blockEntries(fields.get('defaults').lines, 6).map((e) => [e.key, e])
				);
				if (defEntries.has('run')) {
					const runEntries = new Map(
						blockEntries(defEntries.get('run').lines, 8).map((e) => [e.key, e])
					);
					if (runEntries.has('working-directory')) {
						defaultCwd = unquote(runEntries.get('working-directory').value);
					}
				}
			}
			const timeoutRaw = fields.has('timeout-minutes')
				? unquote(fields.get('timeout-minutes').value)
				: undefined;
			jobs[jobEntry.key] = {
				id: jobEntry.key,
				name: fields.has('name')
					? parseScalar(fields.get('name').value, fields.get('name').lines)
					: undefined,
				uses: fields.has('uses') ? unquote(fields.get('uses').value) : undefined,
				runsOn: fields.has('runs-on') ? unquote(fields.get('runs-on').value) : undefined,
				timeoutMinutes: timeoutRaw !== undefined ? Number(timeoutRaw) : undefined,
				needs: fields.has('needs')
					? parseStringList(fields.get('needs').value, fields.get('needs').lines)
					: [],
				if: fields.has('if')
					? parseScalar(fields.get('if').value, fields.get('if').lines)
					: undefined,
				defaultWorkingDirectory: defaultCwd,
				steps: fields.has('steps') ? parseSteps(fields.get('steps').lines) : [],
			};
		}
	}

	// Extract `affected.mjs gate` steps from any job (typically `scope`).
	const gates = new Map();
	for (const job of Object.values(jobs)) {
		for (const step of job.steps) {
			if (!step.id || !step.run) continue;
			const match = /^node scripts\/affected\.mjs gate (.+)$/.exec(step.run.trim());
			if (match) gates.set(step.id, match[1].trim().split(/\s+/));
		}
	}

	return { name, triggers, jobs, gates };
}
