/**
 * 把 Hanami 的 .vrma 素材整理成 lobe 侧的动作索引。
 *
 * 素材来源：Undi95/Hanami 的 `vrma/`（Overte/Apache-2.0、Rocketbox/MIT、Quaternius/CC0）。
 * 这里只读素材的**元数据**（world.json + 文件名），不搬任何 Hanami 的代码。
 *
 * 用法：node scripts/port-hanami-motion.mjs
 * 产物：public/vrma/index.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const VRMA_DIR = path.join(ROOT, 'public', 'vrma');
const OUT = path.join(VRMA_DIR, 'index.json');

/** 文件名前缀 → 分类。顺序敏感：先长后短。 */
const FACE_RULES = [
  { test: /^idle-talking/, family: 'idle', category: 'talking', loop: true, label: '待机·说话' },
  { test: /^idle/, family: 'idle', category: 'idle', loop: true, label: '待机' },
  { test: /^(happy|laugh)/, family: 'gesture', category: 'emotion', loop: false, label: '开心' },
  { test: /^angry/, family: 'gesture', category: 'emotion', loop: false, label: '生气' },
  { test: /^sad/, family: 'gesture', category: 'emotion', loop: false, label: '难过' },
  { test: /^relaxed/, family: 'gesture', category: 'emotion', loop: false, label: '放松' },
  { test: /^neutral/, family: 'gesture', category: 'emotion', loop: false, label: '中性' },
  { test: /^think/, family: 'gesture', category: 'emotion', loop: false, label: '思考' },
  { test: /^shrug/, family: 'gesture', category: 'emotion', loop: false, label: '耸肩' },
  { test: /^wave/, family: 'gesture', category: 'greeting', loop: false, label: '打招呼' },
  { test: /^raise-hand/, family: 'gesture', category: 'greeting', loop: false, label: '举手' },
  { test: /^point/, family: 'gesture', category: 'greeting', loop: false, label: '指' },
  { test: /^nod/, family: 'gesture', category: 'response', loop: false, label: '点头' },
  { test: /^shake/, family: 'gesture', category: 'response', loop: false, label: '摇头' },
  { test: /^clap/, family: 'gesture', category: 'response', loop: false, label: '拍手' },
  { test: /^listen/, family: 'gesture', category: 'response', loop: true, label: '倾听' },
  { test: /^afk/, family: 'gesture', category: 'response', loop: true, label: '走神' },
];

/** world.json 的 famille → 面板分类。 */
const WORLD_CATEGORY = {
  allure: 'locomotion',
  transition: 'transition',
  posture: 'seated',
  geste: 'world-gesture',
  idle: 'world-idle',
};

function humanize(id) {
  return id
    .replace(/^rb-/, '')
    .replace(/^world-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function faceMeta(id) {
  for (const rule of FACE_RULES) {
    if (rule.test.test(id)) return rule;
  }
  return { family: 'gesture', category: 'emotion', loop: false, label: '' };
}

const worldJsonPath = path.join(VRMA_DIR, 'world.json');
const world = fs.existsSync(worldJsonPath)
  ? JSON.parse(fs.readFileSync(worldJsonPath, 'utf8')).clips ?? {}
  : {};

const files = fs
  .readdirSync(VRMA_DIR)
  .filter((f) => f.endsWith('.vrma'))
  .sort();

const clips = files.map((file) => {
  const id = file.replace(/\.vrma$/, '');
  const meta = world[id];

  if (meta) {
    // 坐姿族：world-sit-* 里进入/离开算过渡，其余是坐着的姿态与反应
    let category = WORLD_CATEGORY[meta.famille] ?? 'world-gesture';
    if (id.startsWith('world-sit-')) {
      category = /-(enter|exit)$/.test(id) ? 'transition' : 'seated';
    }
    return {
      id,
      file: `/vrma/${file}`,
      domain: 'world',
      family: meta.famille,
      category,
      label: humanize(id),
      role: meta.role,
      loop: Boolean(meta.boucle),
      durationS: meta.dureeS,
      // 位移元数据：平移全部被剔成「原地」，速度以测量 rig 的髋高 1.0167 m 为基准
      speedMS: meta.deplacement?.vitesseMS ?? null,
      cycleM: meta.deplacement?.distanceParCycleM ?? null,
      lateralMS: meta.deplacement?.vitesseLateraleMS ?? null,
      hipsFraction: meta.hanchesFraction ?? null,
      chain: meta.enchaine ?? null,
      license: meta.source?.licence ?? null,
      credit: meta.source?.depot ?? meta.source?.pack ?? null,
    };
  }

  const face = faceMeta(id);
  const isRocketbox = id.startsWith('rb-');

  return {
    id,
    file: `/vrma/${file}`,
    domain: 'face',
    family: face.family,
    category: face.category,
    label: `${face.label || humanize(id)}${isRocketbox ? ' ·R' : ''}`,
    role: null,
    loop: face.loop,
    durationS: null,
    speedMS: null,
    cycleM: null,
    lateralMS: null,
    hipsFraction: null,
    chain: null,
    license: isRocketbox ? 'MIT' : 'Apache-2.0',
    credit: isRocketbox ? 'Microsoft Rocketbox' : 'overte-org/overte',
  };
});

const byCategory = {};
for (const clip of clips) {
  byCategory[clip.category] = (byCategory[clip.category] ?? 0) + 1;
}

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: {
    repo: 'Undi95/Hanami',
    path: 'vrma/',
    note: '仅搬运动作素材与元数据；Hanami 的代码是 AGPL-3.0，未复制。',
    licenses: ['Apache-2.0 (Overte)', 'MIT (Microsoft Rocketbox)', 'CC0-1.0 (Quaternius)'],
  },
  counts: { total: clips.length, byCategory },
  clips,
};

fs.writeFileSync(OUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`写入 ${path.relative(ROOT, OUT)}：${clips.length} 个片段`);
for (const [category, count] of Object.entries(byCategory)) {
  console.log(`  ${category}: ${count}`);
}

