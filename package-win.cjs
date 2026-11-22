const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { packager } = require('@electron/packager');
const manifest = require('./package.json');

const outputDirectory = path.join(__dirname, 'dist');
// 打进包里的：面板本体 + 两个应用之外的一切公共件。
const appFiles = new Set([
  '',
  '/index.html',
  '/main.cjs',
  '/preload.cjs',
  '/package.json',
  '/app-window.cjs',
  '/stage-session.cjs',
  '/stage-window.cjs',
  '/vidol-session.cjs',
  '/vidol-window.cjs',
]);
// 模型与 Cubism Core 有各自的授权，不进发布包；缓存、依赖、构建产物更不该进。
const excluded = /^\/apps\/(?:stage-app\/(?:models|\.cache|demo\/Hiyori|vendor\/live2dcubismcore\.min\.js)|diva-vidol\/(?:node_modules|\.next|\.env))/;

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
      if (normalized.startsWith('/apps/diva-vidol/')) return false;
      return !appFiles.has(normalized);
    },
  });

  const archive = path.join(outputDirectory, 'DIVA-OLV-Demo-Windows-x64.zip');
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
