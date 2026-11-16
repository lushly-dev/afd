/** What a hostile server puts in a notification: script-ending text, line separators and quotes (P6-D2). */
export const HOSTILE = [
	'</script><script>window.loamPwned=1</script>',
	String.fromCharCode(0x2028, 0x2029),
	'"',
	"'",
	'`${window.loamPwned=2}`',
	String.fromCharCode(92),
	'<!--',
].join('');
