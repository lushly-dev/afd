/**
 * @fileoverview The title an app's own content is attributed to, wherever the shell shows it (phase 4 specification,
 * 6.6): an overlay's owner line and an app's account section (phase 3 specification, 5.5). Its own module and the
 * package's `/owner-title` entry, so the chrome's chunks share it without the kernel's root graph.
 */

import { saysShellName } from '@lushly-dev/loam-manifest';

/** What an owner line shows when no name of the app's may be shown (6.6). */
export const UNNAMED_APP = 'an app';

/**
 * The title an app's owner line shows (6.6): its title as the rail shows it, with its instance id after it when another
 * instance shows the same title. A name that says "Loam" as a word (the manifest's and the deployment's one rule,
 * `saysShellName`, which they refuse but the line never trusts) is never shown: the title falls back to the instance
 * id, then the plugin id, then "an app", and a twin's instance id is left out when it says it.
 */
export function ownerTitle(
	summaries: ReadonlyArray<{ instance: string; title: string; app?: string }>,
	instance: string
): string {
	const own = summaries.find((each) => each.instance === instance);
	const shown = (name: string | undefined): string | undefined => {
		const trimmed = name?.trim();
		return trimmed && !saysShellName(trimmed) ? trimmed : undefined;
	};
	const id = shown(instance);
	const title = shown(own?.title);
	if (title === undefined) return id ?? shown(own?.app) ?? UNNAMED_APP;
	const twin = summaries.some(
		(each) => each.instance !== instance && each.title.trim().toLowerCase() === title.toLowerCase()
	);
	return twin && id !== undefined ? `${title} (${id})` : title;
}
