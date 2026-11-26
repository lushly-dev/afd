/** A stdio host over the same validated definitions and execution path as the CLI. */
import { commandToolAnnotations, ErrorCodes, failure } from '@lushly-dev/afd-core';
import { createSpecimenBench } from '@lushly-dev/specimen';
import type { BenchOptions } from '@lushly-dev/specimen/types';
import { createSpecimenCommands, executeSpecimenCommand } from '@lushly-dev/specimen-afd';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** Options for creating the Specimen MCP stdio server. */
export interface SpecimenMcpServerOptions extends BenchOptions {
	/**
	 * Confirmation enforcement for commands declaring `confirmPrompt` (`spec/command-metadata.md`).
	 * Always `'require-human'`: commands with `confirmPrompt` run only after an accepted MCP form
	 * elicitation and record `decidedBy: { kind: 'person' }` when accepted.
	 */
	confirmations?: 'require-human';
}

const CONFIRM_REQUESTED_SCHEMA = {
	type: 'object' as const,
	properties: {
		confirm: {
			type: 'boolean' as const,
			title: 'Confirm',
			description: 'Run the command',
		},
	},
	required: ['confirm'],
};

const MAX_PROMPT_VALUE_LENGTH = 120;

function isDisallowedPromptChar(code: number): boolean {
	return (
		code <= 0x1f ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x061c ||
		code === 0x200e ||
		code === 0x200f ||
		(code >= 0x2028 && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}

function sanitizePromptValue(value: string): string {
	let cleaned = '';
	let inSpace = false;
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		if (isDisallowedPromptChar(code) || /\s/u.test(ch)) {
			if (!inSpace && cleaned.length > 0) {
				cleaned += ' ';
				inSpace = true;
			}
		} else {
			cleaned += ch;
			inSpace = false;
		}
	}
	const trimmed = cleaned.trim();
	const chars = Array.from(trimmed);
	return chars.length > MAX_PROMPT_VALUE_LENGTH
		? `${chars.slice(0, MAX_PROMPT_VALUE_LENGTH - 1).join('')}…`
		: trimmed;
}

function pushSanitizedField(details: string[], label: string, raw: unknown): boolean {
	if (typeof raw !== 'string') return false;
	const value = sanitizePromptValue(raw);
	if (!value) return false;
	details.push(`${label}: ${value}`);
	return true;
}

function formatConfirmPrompt(basePrompt: string, input: unknown): string {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return basePrompt;
	const fields = input as Record<string, unknown>;
	const details: string[] = [];
	if (!pushSanitizedField(details, 'Decision', fields.slug)) {
		pushSanitizedField(details, 'Decision', fields.decision);
	}
	const supersedes = Array.isArray(fields.supersedes)
		? fields.supersedes.filter((item): item is string => typeof item === 'string').join(', ')
		: fields.supersedes;
	pushSanitizedField(details, 'Supersedes', supersedes);
	if (Array.isArray(fields.items) && fields.items.length > 0) {
		details.push(`Items: ${fields.items.length}`);
	}
	pushSanitizedField(details, 'Chosen', fields.chosen);
	pushSanitizedField(details, 'Reason', fields.reason);
	return details.length > 0 ? `${basePrompt}\n${details.join('\n')}` : basePrompt;
}

function allowsFormElicitation(
	capabilities: ReturnType<McpServer['server']['getClientCapabilities']>
): boolean {
	const elicitation = capabilities?.elicitation;
	if (!elicitation || typeof elicitation !== 'object') return false;
	return Object.keys(elicitation).length === 0 || 'form' in elicitation;
}

function confirmationRequiredResult(name: string, confirmPrompt: string) {
	const result = failure({
		code: ErrorCodes.CONFIRMATION_REQUIRED,
		message: `'${name}' needs confirmation: ${confirmPrompt}`,
		suggestion:
			'This server accepts only a confirmation from the user: use an MCP client that supports elicitation.',
		retryable: false,
		details: { commands: [name] },
	});
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(result) }],
		isError: true,
	};
}

function confirmationDeclinedResult(name: string) {
	const result = failure({
		code: ErrorCodes.CONFIRMATION_DECLINED,
		message: `The user did not confirm '${name}'`,
		suggestion:
			'Do not run this again without asking the user first; the user chose not to proceed.',
		retryable: false,
		details: { commands: [name] },
	});
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(result) }],
		isError: true,
	};
}

export async function createSpecimenMcpServer(
	options: SpecimenMcpServerOptions
): Promise<McpServer> {
	const { confirmations = 'require-human', ...benchOptions } = options;
	if (confirmations !== 'require-human') {
		throw new Error("createSpecimenMcpServer: confirmations must be 'require-human'");
	}
	const bench = await createSpecimenBench(benchOptions);
	const commands = createSpecimenCommands(bench).filter((command) => command.expose?.mcp === true);
	const commandsByName = new Map(commands.map((command) => [command.name, command]));
	const server = new McpServer(
		{ name: 'specimen', version: '0.1.0' },
		{
			capabilities: { tools: {} },
			instructions:
				'Specimen observes and tests native components, retained stories, and job specimens, reviews unsettled changes, and records design decisions under specimens/. Start with specimen-list and specimen-validate; call decision-check before editing files, specimens, or tokens covered by a decision; use specimen-review to inspect unsettled changes (open items are questions for the person). Tools use the same input schemas and CommandResult envelopes as the specimen CLI. Rendering, inspection, and job runs can launch Chromium and execute project code; job-create, job-run, capture, compare, decision-record, baseline, migrate, build, point, note, and pack operations can write files. Commands declaring confirmPrompt (such as decision-record) require accepted human elicitation under confirmations: require-human. Use this server with trusted local projects.',
		}
	);
	server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: commands.map((command) => ({
			name: command.name,
			description: command.description,
			inputSchema: command.jsonSchema as { type: 'object'; [key: string]: unknown },
			annotations: commandToolAnnotations(command),
			...(command.outputBudget ? { _meta: { 'dev.afd/outputBudget': command.outputBudget } } : {}),
		})),
	}));
	server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const { name, arguments: input = {} } = request.params;
		const command = commandsByName.get(name);
		if (!command) {
			const result = failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Unknown tool: ${name}`,
				suggestion: 'List available tools with tools/list.',
			});
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(result) }],
				isError: true,
			};
		}

		let humanConfirmed = false;
		let validatedInput: unknown = input;
		if (command.confirmPrompt) {
			if (!allowsFormElicitation(server.server.getClientCapabilities())) {
				return confirmationRequiredResult(name, command.confirmPrompt);
			}
			const parsed = command.inputSchema.safeParse(input);
			if (!parsed.success) {
				const result = failure({
					code: 'VALIDATION_ERROR',
					message: parsed.error.message,
					suggestion: `Provide input matching the ${command.name} schema.`,
				});
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result) }],
					isError: true,
				};
			}
			validatedInput = parsed.data;
			let elicitation: Awaited<ReturnType<typeof server.server.elicitInput>>;
			try {
				elicitation = await server.server.elicitInput(
					{
						mode: 'form',
						message: formatConfirmPrompt(command.confirmPrompt, parsed.data),
						requestedSchema: CONFIRM_REQUESTED_SCHEMA,
					},
					{ signal: extra.signal }
				);
			} catch {
				return confirmationRequiredResult(name, command.confirmPrompt);
			}
			if (elicitation.action !== 'accept' || elicitation.content?.confirm !== true) {
				return confirmationDeclinedResult(name);
			}
			humanConfirmed = true;
		}

		const metaBudget = request.params._meta?.['dev.afd/outputBudget'];
		const result = await executeSpecimenCommand(bench, name, validatedInput, {
			actor: { kind: 'agent' },
			...(humanConfirmed ? { humanConfirmed: true } : {}),
			...(metaBudget !== undefined ? { outputBudget: metaBudget } : {}),
		});
		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			isError: !result.success,
		};
	});
	// Also covers SDK/client disconnects, not just explicit signal handling in the binary.
	server.server.onclose = () => {
		void bench
			.close()
			.catch((error: unknown) => console.error('[specimen-mcp] Close failed:', error));
	};
	return server;
}
