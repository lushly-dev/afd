/**
 * @fileoverview What of an app's context calls the kernel, over one caller's `call` (phase 2
 * specification, 3.6): the port's for `activate`, and a surface's for its element, so an embed's
 * `navigate` or modal is refused as its client's calls are.
 */

import type { AppPortV2 } from '@lushly-dev/loam-kernel';
import type { AppContextV1, CommandResult, ModalInputV1, ToastInputV1 } from '@lushly-dev/loam-sdk';

/** A refusal as a rejection, with its code and suggestion, for what an app awaits rather than reads. */
function refusal(result: CommandResult<unknown>, fallback: string): Error {
	return Object.assign(new Error(result.error?.message ?? fallback), {
		code: result.error?.code,
		suggestion: result.error?.suggestion,
	});
}

export function surfaceCalls(
	port: Pick<AppPortV2, 'instance' | 'waitOverlay'>,
	call: AppPortV2['call']
): Pick<AppContextV1, 'client' | 'navigate' | 'overlays'> {
	const { instance } = port;
	return {
		client: { call },
		async navigate(route: string) {
			const moved = await call('app-route-set', { instance, path: route });
			if (!moved.success) throw refusal(moved, 'The route could not change');
		},
		overlays: {
			toast: (input: ToastInputV1) => call('toast-show', input),
			async modal(input: ModalInputV1) {
				const opened = await call<{ overlayId: string }>('modal-open', input);
				if (!opened.success || !opened.data) throw refusal(opened, 'The modal could not open');
				return port.waitOverlay(opened.data.overlayId);
			},
		},
	};
}
