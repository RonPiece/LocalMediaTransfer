const globals = require('globals');
module.exports = [{
    basePath: require('node:path').resolve(__dirname, '../..'),
    files: ['src/Server/static/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.worker, hashwasm: 'readonly' } },
    rules: {
        'no-async-promise-executor': 'error',
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-duplicate-case': 'error',
        'no-unreachable': 'error', 'no-unsafe-finally': 'error', 'valid-typeof': 'error'
    }
}];
