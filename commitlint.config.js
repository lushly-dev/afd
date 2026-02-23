export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		'type-enum': [
			2,
			'always',
			['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'build', 'ci'],
		],
		'scope-enum': [
			2,
			'always',
			[
				'core',
				'server',
				'client',
				'auth',
				'cli',
				'testing',
				'adapters',
				'examples',
				'alfred',
				'python',
				'rust',
				'deps',
			],
		],
		'subject-max-length': [2, 'always', 72],
		'subject-full-stop': [2, 'never', '.'],
		'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
	},
};
