import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { ShellKeyAction } from '../keybindings.js';
import { isHumanGesture } from '../settings/setting-rules.js';
import { DOCUMENT_KIT as kit } from './command-kit.js';

const titles: Record<ShellKeyAction, string> = {
	'shell-focus-next': 'Focus the next shell part',
	'shell-focus-previous': 'Focus the previous shell part',
	'shell-save': 'Save the active editor',
	'shell-project-switcher': 'Toggle the project switcher',
};

export function createShellKeyCommands(
	actions: readonly ShellKeyAction[],
	perform: ((action: ShellKeyAction) => boolean) | undefined
): ZodCommandDefinition[] {
	return actions.map((name) =>
		kit.define<typeof emptyInput, { performed: true }>({
			name,
			title: titles[name],
			description: titles[name],
			category: 'shell',
			mutation: false,
			executionTime: 'instant',
			expose: { agent: false },
			input: emptyInput,
			jsonSchema: EMPTY_INPUT_JSON,
			async handler(_input, context) {
				if (!isHumanGesture(context))
					return kit.kernelFailure(
						'HUMAN_REQUIRED',
						'This action controls the local shell',
						'Run it in the Loam shell'
					);
				if (!perform?.(name))
					return kit.kernelFailure(
						'SHELL_ACTION_UNAVAILABLE',
						'The shell cannot perform this action now',
						'Open the relevant shell surface and try again'
					);
				return kit.success({ performed: true });
			},
		})
	) as unknown as ZodCommandDefinition[];
}
