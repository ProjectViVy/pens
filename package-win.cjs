const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { packager } = require('@electron/packager');
const manifest = require('./package.json');

const outputDirectory = path.join(__dirname, 'dist');
// 打进包里的：面板本体 + 舞台应用（不带模型、不带 Core、不带缓存）。
const appFiles = new Set([
  '',
  '/index.html',
  '/main.cjs',
  '/preload.cjs',
  '/package.json',
  '/stage-session.cjs',
  '/stage-window.cjs',
]);
// 模型与 Cubism Core 有各自的授权，不进发布包；缓存更不该进。
const excluded = /^\/apps\/stage-app\/(?:models|\.cache|demo\/Hiyori|vendor\/live2dcubismcore\.min\.js)/;

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
    ignore: (filePath) => {
      const normalized = filePath.replace(/\\/g, '/');
      if (excluded.test(normalized)) return true;
      if (normalized.startsWith('/apps/stage-app/')) return false;
      return !appFiles.has(normalized);
    },
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
