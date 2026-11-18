/**
 * @fileoverview The step directives of Loam's runner (phase 4 specification, Jobs and scenarios, the grammar table):
 * at the start of a step's description, a caller (`[agent]`, `[caller: <instance>]` or `[caller: <instance>,
 * inactive]`) and then a scope (`[scope: <project id>]`). An unknown directive, two callers or a scope before a
 * caller fails the file.
 */

export type Directive = {
	caller?: { agent: true } | { instance: string; inactive: boolean };
	scope?: string;
};

/** Read and strip a step description's directives. */
export function readDirectives(description: string): Directive {
	const out: Directive = {};
	let rest = description;
	for (;;) {
		const match = /^\[([^\]]*)\]\s*/.exec(rest);
		if (!match) break;
		rest = rest.slice(match[0].length);
		const body = (match[1] ?? '').trim();
		if (body === 'agent') {
			if (out.caller) throw new Error(`Two caller directives in "${description}"`);
			if (out.scope) throw new Error(`A scope before a caller in "${description}"`);
			out.caller = { agent: true };
		} else if (body.startsWith('caller:')) {
			if (out.caller) throw new Error(`Two caller directives in "${description}"`);
			if (out.scope) throw new Error(`A scope before a caller in "${description}"`);
			const [instance, flag] = body
				.slice('caller:'.length)
				.split(',')
				.map((part) => part.trim());
			if (!instance || (flag !== undefined && flag !== 'inactive'))
				throw new Error(`A malformed caller in "${description}"`);
			out.caller = { instance, inactive: flag === 'inactive' };
		} else if (body.startsWith('scope:')) {
			const project = body.slice('scope:'.length).trim();
			if (!project) throw new Error(`A malformed scope in "${description}"`);
			out.scope = project;
		} else {
			throw new Error(`An unknown directive [${body}] in "${description}"`);
		}
	}
	return out;
}
