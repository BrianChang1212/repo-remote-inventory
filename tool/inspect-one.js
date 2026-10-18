const path = require('node:path');
const { runGit, inspectRepository } = require('../source/git-state');

async function main() {
  const repository = path.resolve(process.argv[2]);
  const status = await runGit(repository, ['status', '--porcelain']);
  const row = await inspectRepository({ path: repository, label: path.basename(repository) });
  process.stdout.write(JSON.stringify({
    gitStatusExit: status.code,
    gitStatusLines: status.stdout.split(/\r?\n/).filter(Boolean).length,
    gitError: status.stderr.split(/\r?\n/)[0] || '',
    row,
  }, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
