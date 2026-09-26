// Tiny syntax highlighter for the page's code samples. It reads each block's
// text and rewrites it as token spans, so blocks stay readable without JS.

const AFD_KEYS = new Set([
	'confidence',
	'reasoning',
	'warnings',
	'suggestions',
	'suggestion',
	'sources',
	'plan',
	'alternatives',
]);

const RULES = {
	json: [
		['key', /"(?:[^"\\]|\\.)*"(?=\s*:)/y],
		['str', /"(?:[^"\\]|\\.)*"/y],
		['num', /-?\d+(?:\.\d+)?/y],
		['kw', /\b(?:true|false|null)\b/y],
		['plain', /[A-Za-z_][\w-]*/y],
	],
	ts: [
		['com', /\/\/[^\n]*/y],
		['str', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/y],
		[
			'kw',
			/\b(?:import|from|export|const|let|async|await|function|return|if|type|interface|typeof|new|true|false)\b/y,
		],
		['key', /[A-Za-z_]\w*(?=\??:\s)/y],
		['fn', /[A-Za-z_]\w*(?=\s*\()/y],
		['num', /\b\d+(?:\.\d+)?\b/y],
		['plain', /[A-Za-z_]\w*/y],
	],
	yaml: [
		['com', /#[^\n]*/y],
		['str', /\$\{\{[^}]*\}\}|"(?:[^"\\]|\\.)*"/y],
		['key', /[A-Za-z_][\w-]*(?=:(?:\s|$))/y],
		['kw', /\b(?:true|false)\b/y],
		['num', /\b\d+\b/y],
		['plain', /[A-Za-z_][\w-]*/y],
	],
};

const escape = (text) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tokenize(source, rules) {
	let out = '';
	let pos = 0;
	while (pos < source.length) {
		let matched = false;
		for (const [type, pattern] of rules) {
			pattern.lastIndex = pos;
			const match = pattern.exec(source);
			if (!match || match[0].length === 0) continue;
			const text = match[0];
			let cls = type;
			if (type === 'key' && AFD_KEYS.has(text.replace(/"/g, ''))) cls = 'afd';
			out += cls === 'plain' ? escape(text) : `<span class="tok-${cls}">${escape(text)}</span>`;
			pos += text.length;
			matched = true;
			break;
		}
		if (!matched) {
			out += escape(source[pos]);
			pos += 1;
		}
	}
	return out;
}

// Terminal transcripts are styled line by line, mirroring afd-cli output.
function terminal(source) {
	return source
		.split('\n')
		.map((line) => {
			if (line.startsWith('$ ')) return `<span class="tok-prompt">${escape(line.slice(2))}</span>`;
			if (line.startsWith('✓')) return `<span class="tok-ok">${escape(line)}</span>`;
			if (line.startsWith('✗')) return `<span class="tok-err">${escape(line)}</span>`;
			const label = line.match(/^(Error|Suggestion|Confidence|Data):(.*)$/);
			if (label) return `<span class="tok-label">${label[1]}:</span>${escape(label[2])}`;
			if (line.startsWith('  ')) return escape(line);
			return tokenize(line, RULES.json);
		})
		.join('\n');
}

export function highlightAll(root = document) {
	for (const code of root.querySelectorAll('code[class*="lang-"]')) {
		const lang = code.className.match(/lang-(\w+)/)?.[1];
		const source = code.textContent;
		if (lang === 'term') code.innerHTML = terminal(source);
		else if (RULES[lang]) code.innerHTML = tokenize(source, RULES[lang]);
	}
}
