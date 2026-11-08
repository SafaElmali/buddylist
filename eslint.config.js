import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'src/shared/vendor/**'] },
  js.configs.recommended,
  {
    files: [
      'src/main/**/*.js',
      'src/providers/**/*.js',
      'src/shared/**/*.js',
      'test/**/*.js',
      'scripts/**/*.js',
      '*.js',
    ],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
  {
    files: ['src/renderer/**/*.js', 'preview/**/*.js', 'site/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['src/preload/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-void': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
];
