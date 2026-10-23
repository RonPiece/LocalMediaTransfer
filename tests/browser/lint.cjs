const { execFileSync } = require('node:child_process');
const path = require('node:path');
const eslint = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin/eslint.js');
execFileSync(process.execPath, [eslint, '--config', 'tests/browser/eslint.config.cjs', 'src/Server/static/js'], {
    cwd: path.resolve(__dirname, '../..'), stdio: 'inherit'
});
