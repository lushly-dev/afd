// Formats CommandResults the way afd-cli's text output does
// (packages/cli/src/output.ts), as highlighted HTML for the page's terminals.

export const escape = (text) =>
	String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const span = (cls, text) => `<span class="${cls}">${escape(text)}</span>`;

export function confidenceBar(confidence) {
	const ratio = Math.min(1, Math.max(0, Number(confidence) || 0));
	const filled = Math.round(ratio * 10);
	return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(ratio * 100)}%`;
}

/** Highlight a JSON value (keys, strings, numbers, literals). */
export function jsonHtml(value, indent = 2) {
	const text = JSON.stringify(value, null, indent) ?? 'undefined';
	return escape(text).replace(
		/(&quot;|")((?:[^"\\]|\\.)*?)\1(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g,
		(match, _q, _body, colon, literal) => {
			if (literal) return `<span class="tok-kw">${match}</span>`;
			if (colon) {
				const key = match.slice(0, -colon.length);
				const afd = /"(confidence|reasoning|warnings|suggestions?|sources|plan|alternatives)"/.test(key);
				return `<span class="${afd ? 'tok-afd' : 'tok-key'}">${key}</span>${colon}`;
			}
			if (match.startsWith('"')) return `<span class="tok-str">${match}</span>`;
			return `<span class="tok-num">${match}</span>`;
		}
	);
}

/** afd-cli `printResult` in text mode. */
export function formatResult(result, { verbose = false } = {}) {
	const lines = [];
	if (result.success) {
		lines.push(span('tok-ok', '✓ Success'));
		if (result.data !== undefined) {
			lines.push('', span('tok-label', 'Data:'), jsonHtml(result.data));
		}
		if (result.confidence !== undefined) {
			lines.push('', `${span('tok-label', 'Confidence:')} ${confidenceBar(result.confidence)}`);
		}
		if (verbose && result.reasoning) {
			lines.push('', `${span('tok-label', 'Reasoning:')} ${escape(result.reasoning)}`);
		}
		for (const warning of result.warnings ?? []) {
			lines.push('', span('tok-warn', `⚠ ${warning.message}`));
		}
	} else {
		const error = result.error ?? { code: 'UNKNOWN_ERROR', message: 'The command failed' };
		lines.push(span('tok-err', '✗ Failed'), '');
		lines.push(`${span('tok-label', 'Error:')} [${escape(error.code)}] ${escape(error.message)}`);
		if (error.suggestion) {
			lines.push('', `${span('tok-label', 'Suggestion:')} ${escape(error.suggestion)}`);
		}
		if (error.retryable) lines.push(span('tok-label', '(This error may be resolved by retrying)'));
	}
	return lines.join('\n');
}

/** afd-cli `printTools`, grouped by category. */
export function formatTools(commands) {
	const groups = new Map();
	for (const command of commands) {
		const group = groups.get(command.category ?? 'other') ?? [];
		group.push(command);
		groups.set(command.category ?? 'other', group);
	}
	const lines = [span('tok-prompt-plain', `Available Tools (${commands.length}):`), ''];
	for (const [category, group] of groups) {
		lines.push(`  ${span('tok-label', `${category}/`)}`);
		for (const command of group) {
			lines.push(`    ${span('tok-key', command.name)}`, `      ${escape(command.description)}`);
		}
		lines.push('');
	}
	return lines.join('\n').trimEnd();
}
