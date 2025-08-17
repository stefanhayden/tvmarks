// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['**/*.ts'],
  extends: [eslint.configs.recommended, tseslint.configs.recommended],
  rules: {
    'import/prefer-default-export': 'off',
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'no-underscore-dangle': 'off',
    'func-names': 'off',
    camelcase: 'off',
    'no-nested-ternary': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-object-type': 'off',
    // 'import/extensions': [
    //   'error',
    //   {
    //     js: 'ignorePackages',
    //   },
    // ],
  },
});
