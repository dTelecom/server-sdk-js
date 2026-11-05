module.exports = {
  extends: ['airbnb-typescript/base', 'prettier'],
  parserOptions: {
    project: './tsconfig.eslint.json',
  },
  ignorePatterns: ['src/proto', 'src/**/*.test.ts', 'docs/', 'dist/', 'examples'],
  rules: {
    'import/export': 'off',
    'max-classes-per-file': 'off',
    'no-param-reassign': 'off',
    'no-await-in-loop': 'off',
    'consistent-return': 'off',
    'class-methods-use-this': 'off',
    'import/prefer-default-export': 'off',
    '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
    '@typescript-eslint/no-use-before-define': 'off',
    'no-restricted-syntax': ['error', 'WithStatement', "BinaryExpression[operator='in']"],
  },
};
