const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { packager } = require('@electron/packager');
const manifest = require('./package.json');

const outputDirectory = path.join(__dirname, 'dist');
const appFiles = new Set(['', '/index.html', '/main.cjs', '/package.json']);

async function packageDemo() {
  const [bundleDirectory] = await packager({
    dir: __dirname,
    name: manifest.productName,
    platform: 'win32',
    arch: 'x64',
    electronVersion: manifest.devDependencies.electron,
    out: outputDirectory,
    asar: true,
    prune: false,
    overwrite: true,
    // Packager passes slash-normalized paths relative to the app root.
    ignore: (filePath) => !appFiles.has(filePath),
  });

  const archive = path.join(outputDirectory, 'PENS-Demo-Windows-x64.zip');
  execFileSync('tar.exe', [
    '-a', '-c', '-f', archive,
    '-C', path.dirname(bundleDirectory), path.basename(bundleDirectory),
  ], { stdio: 'inherit' });
  console.log(`Demo package written: ${archive}`);
}

packageDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
