const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yauzl = require('yauzl');
const { createVSIX } = require('@vscode/vsce');

const root = path.resolve(__dirname, '..');
const manifest = require(path.join(root, 'package.json'));
const release = path.join(root, 'release');
const vsix = path.join(release, `${manifest.name}-${manifest.version}.vsix`);

function inspectZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const names = [];
      let packagedManifest = '';
      zip.on('error', reject);
      zip.on('end', () => resolve({ names, packagedManifest: JSON.parse(packagedManifest) }));
      zip.on('entry', entry => {
        names.push(entry.fileName);
        if (entry.fileName !== 'extension/package.json') return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          stream.on('data', chunk => { packagedManifest += chunk.toString(); });
          stream.on('error', reject);
          stream.on('end', () => zip.readEntry());
        });
      });
      zip.readEntry();
    });
  });
}

async function main() {
  fs.mkdirSync(release, { recursive: true });
  await createVSIX({ cwd: root, packagePath: vsix, dependencies: false, allowMissingRepository: true });
  const { names, packagedManifest } = await inspectZip(vsix);
  for (const required of ['extension/package.json', 'extension/source/extension.js', 'extension/source/dashboard.js', 'extension/source/sidebar.js', 'extension/source/git-state.js', 'extension/resources/inventory.svg', 'extension/resources/extension-icon.png', 'extension/readme.md', 'extension/LICENSE.txt']) {
    if (!names.includes(required)) throw new Error(`VSIX is missing ${required}`);
  }
  if (names.some(name => /^extension\/(?:test|tool|release|node_modules|\.git)\//.test(name))) {
    throw new Error('VSIX contains development or local files');
  }
  if (packagedManifest.name !== manifest.name || packagedManifest.publisher !== manifest.publisher || packagedManifest.version !== manifest.version || packagedManifest.main !== manifest.main) {
    throw new Error('VSIX manifest does not match the source package');
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(vsix)).digest('hex');
  const git = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const gitStatus = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
  const record = {
    file: path.basename(vsix), version: manifest.version, publisher: manifest.publisher,
    sha256, sourceCommit: git.status === 0 ? git.stdout.trim() : null,
    sourceDirty: gitStatus.status === 0 ? gitStatus.stdout.trim().length > 0 : null,
    builtAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    packagedFiles: names.length,
  };
  fs.writeFileSync(path.join(release, `${manifest.name}-${manifest.version}.json`), JSON.stringify(record, null, 2) + '\n');
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
