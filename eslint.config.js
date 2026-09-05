import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
	{
		ignores: ['dist/', 'node_modules/'],
	},

	js.configs.recommended,

	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
		},
		rules: {
			// Everything here is either a bug or dead weight, never a matter of
			// taste; formatting is Prettier's job and is switched off below.
			eqeqeq: ['error', 'always'],
			'no-var': 'error',
			'prefer-const': 'error',
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'no-console': ['error', { allow: ['warn', 'error'] }],
		},
	},

	{
		// The encoder, the renderers and the page scripts all run in a browser.
		files: ['src/**/*.js', 'site/**/*.js'],
		languageOptions: {
			globals: globals.browser,
		},
	},

	{
		// The build, the tests and the dev server run in Node, and the browser
		// tests evaluate code inside a page as well.
		files: ['tools/**/*.js', 'tools/**/*.mjs', 'test/**/*.js', 'eslint.config.js'],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
		rules: {
			'no-console': 'off',
		},
	},

	prettier,
];
