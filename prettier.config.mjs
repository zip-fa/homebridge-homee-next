/** Adapted from jabka: same base style, without the Angular/Tailwind/Twig parts. */
/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',

  overrides: [
    { files: ['*.ts', '*.mts', '*.js', '*.mjs'], options: { printWidth: 80 } },
    {
      files: '*.html',
      options: {
        printWidth: 80,
        singleAttributePerLine: true,
        htmlWhitespaceSensitivity: 'css',
      },
    },
    { files: '*.css', options: { printWidth: 120 } },
    {
      files: ['*.json', '*.jsonc'],
      options: { printWidth: 120, trailingComma: 'none' },
    },
    { files: ['*.yaml', '*.yml'], options: { printWidth: 120 } },
    { files: '*.md', options: { proseWrap: 'always' } },
  ],
};
