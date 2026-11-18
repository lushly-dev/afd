/**
 * Two screens for the theme audit, beside the change bar, which follows the theme.
 *
 * Both paint fixed colours over the whole frame, so neither changes when the
 * theme does. The receipt is meant to: paper is white. It says so in the
 * configuration, with a reason. The empty state is the ordinary mistake, a
 * panel someone styled with a white background and dark text and never looked
 * at in dark. Nothing declares it, which is what the audit is for.
 */

function panel(style, ...lines) {
	const element = document.createElement('div');
	element.style.cssText = `position:fixed;inset:0;box-sizing:border-box;display:grid;align-content:center;gap:6px;padding:0 24px;${style}`;
	for (const [text, lineStyle] of lines) {
		const line = document.createElement('p');
		line.textContent = text;
		line.style.cssText = `margin:0;${lineStyle}`;
		element.append(line);
	}
	return element;
}

/** A printed receipt: white paper, black ink, in every theme. Declared light only. */
export const Receipt = {
	render: () =>
		panel(
			'background:#fff;color:#111;color-scheme:light;font:600 16px/22px ui-monospace,Consolas,monospace',
			['RECEIPT 0042', 'letter-spacing:0.08em;padding-bottom:6px;border-bottom:2px dashed #111'],
			['3 changes saved · Atlas Dark', 'font-weight:400']
		),
};

/** An empty state with a white background and dark text written straight into it. Nothing declares it. */
export const Empty = {
	render: () =>
		panel(
			'background:#fff;color:#17120f;justify-items:center;text-align:center;font:600 18px/24px system-ui,sans-serif',
			['Nothing to save', ''],
			['Changes you make will appear here.', 'font-weight:400;font-size:14px;line-height:20px;color:#5e6460']
		),
};
