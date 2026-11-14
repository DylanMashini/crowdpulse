// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'ios/*', 'android/*'],
  },
  {
    // Modules with unit tests run under plain Node, which needs the .ts extension on relative
    // imports and cannot follow the "@/…" alias.
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
  },
  {
    // docs/CONTRACTS.md fixes the import as `import TriageCapture from 'triage-capture'`, and the
    // module also exports the interface of that name.
    rules: { 'import/no-named-as-default': 'off' },
  },
]);
