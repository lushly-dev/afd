// A schema source that knows what the manifest cannot: the select's command.
export default {
	id: 'example',
	schema(tag, schema) {
		if (tag !== 'example-select' || !schema) return schema;
		return {
			...schema,
			commands: [{ id: '--toggle', description: 'Opens or closes the list.' }],
			unknown: schema.unknown.filter((field) => field !== 'commands'),
		};
	},
};
