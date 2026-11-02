/** A view fixture's handlers (E2), on the SDK's real `serveHandlers`, with no store grant. */
import { failure, success } from '@lushly-dev/loam-sdk';
import { serveHandlers } from '@lushly-dev/loam-sdk/view';

const answer = async () => success({ answered: true });

serveHandlers({
	sdk: 1,
	handlers: {
		'fixture-echo': answer,
		'fixture-linked': answer,
		'fixture-appless': answer,
		'fixture-modelless': answer,
		async 'fixture-throw'() {
			throw new Error('secret-in-a-thrown-message');
		},
		async 'fixture-refuse'() {
			return failure({ code: 'FIXTURE_REFUSED', message: 'No.', suggestion: 'Stop.' });
		},
	},
});
