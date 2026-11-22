/**
 * 把 Hanami 的 3D 房间整理成 lobe 侧的舞台清单。
 *
 * 素材来源：Undi95/Hanami 的 `environments/`（房间 .glb + 放置 sidecar + 量好的 .scene.json）。
 * 这里只读元数据（放置参数、可行走面积、座位数），不搬 Hanami 的代码。
 *
 * 用法：node scripts/port-hanami-environments.mjs
 * 产物：public/environments/manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public', 'environments');
const OUT = path.join(DIR, 'manifest.json');

const files = fs.readdirSync(DIR);
const glbs = files.filter((f) => f.endsWith('.glb')).sort();

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  } catch {
    return null;
  }
};

const rooms = glbs.map((glb) => {
  const id = glb.replace(/\.glb$/, '');
  const sidecarFile = `${id}.json`;
  const sceneFile = `${id}.scene.json`;
  const sidecar = files.includes(sidecarFile) ? readJson(sidecarFile) : null;
  const scene = files.includes(sceneFile) ? readJson(sceneFile) : null;

  return {
    id,
    label: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    glb: `/environments/${glb}`,
    scene: files.includes(sceneFile) ? `/environments/${sceneFile}` : null,
    // 放置参数（sidecar）：缩放、朝向、出生点
    placement: sidecar
      ? {
          scale: sidecar.scale ?? 1,
          rotationY: sidecar.rotationY ?? null,
          spawn: sidecar.spawn ?? null,
          exposure: sidecar.exposure ?? null,
        }
      : null,
    // 量出来的房间数据摘要（完整数据在 .scene.json，运行时再取）
    walkArea: scene?.room?.walkArea ?? null,
    seats: Array.isArray(scene?.seats) ? scene.seats.length : 0,
    ceiling: scene?.room?.ceiling ?? null,
    sizeMB: Number((fs.statSync(path.join(DIR, glb)).size / 1024 / 1024).toFixed(1)),
  };
});

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: {
    repo: 'Undi95/Hanami',
    path: 'environments/',
    note: '房间素材各自许可，见同目录 CREDITS.md；Hanami 的代码是 AGPL-3.0，未复制。',
  },
  rooms,
};

fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`写入 ${path.relative(ROOT, OUT)}：${rooms.length} 个房间`);
for (const room of rooms) {
  console.log(`  ${room.id}: ${room.walkArea ?? '?'} m²，${room.seats} 个座位，${room.sizeMB} MB`);
}
