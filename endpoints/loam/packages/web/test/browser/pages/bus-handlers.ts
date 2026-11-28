/** The bus fixture view's handlers (P5-B2), on the SDK's real `serveHandlers`: one mutation that writes nothing. */
import { success } from '@lushly-dev/loam-sdk';
import { serveHandlers } from '@lushly-dev/loam-sdk/view';

serveHandlers({
	sdk: 1,
	handlers: {
		'busview-touch': async () => success({ touched: true }),
	},
});
