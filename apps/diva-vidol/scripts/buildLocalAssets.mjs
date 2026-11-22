#!/usr/bin/env node
/**
 * 生成本地素材市场索引：把 public/assets 下的角色 / 舞蹈包，
 * 转成应用能直接读的 market JSON（index.json + <id>.json）。
 *
 * 输入：
 *   .downloads/market-raw/agents/*.json   —— 线上市场的原始角色定义（只取本地有素材的）
 *   .downloads/market-raw/dances/index.remote.json —— 线上舞蹈索引（只取本地有素材的）
 *   public/assets/agents/<pkg>/           —— 本地角色素材（model.vrm / avatar / cover）
 *   public/assets/dances/<pkg>/           —— 本地舞蹈素材（*.vmd / 音频 / cover / thumb）
 *
 * 输出：
 *   public/assets/market/agents/index.json
 *   public/assets/market/agents/<agentId>.json
 *   public/assets/market/dances/index.json
 *
 * 用法：node scripts/buildLocalAssets.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RAW_AGENTS = join(ROOT, '.downloads/market-raw/agents');
const RAW_DANCE_INDEX = join(ROOT, '.downloads/market-raw/dances/index.remote.json');
const OUT_AGENTS = join(ROOT, 'public/assets/market/agents');
const OUT_DANCES = join(ROOT, 'public/assets/market/dances');
const LOCAL_AGENTS = join(ROOT, 'public/assets/agents');
const LOCAL_DANCES = join(ROOT, 'public/assets/dances');

/** 线上市场里的 agentId -> 本地素材包目录名 */
const AGENT_PACKAGE_MAP = {
  'vidol-agent-bronya': 'vidol-agent-bronya',
  'vidol-agent-klee': 'vidol-agent-klee',
  'vidol-agent-mimi': 'vidol-agent-mimi',
  'vidol-sample-agent-a': 'vidol-agent-sample-a',
  'vidol-sample-agent-b': 'vidol-agent-sample-b',
  'vidol-sample-agent-c': 'vidol-agent-sample-c',
};

/** 线上舞蹈 danceId -> 本地素材包目录名 */
const DANCE_PACKAGE_MAP = {
  'vidol-dance-dingdingdangdhang': 'vidol-dance-dingdingdangdhang',
  'vidol-dance-gokuraku': 'vidol-dance-gokuraku',
  'vidol-dance-last-surprise': 'vidol-dance-last-surprise',
  'vidol-dance-sample': 'vidol-dance-sample',
  'vidol-dance-shujiwu': 'vidol-dance-shujiwu',
};

const url = (...parts) => '/assets/' + parts.map((p) => p.split('/').map(encodeURIComponent).join('/')).join('/');

const pick = (dir, predicate) => readdirSync(dir).find(predicate);

function buildAgents() {
  mkdirSync(OUT_AGENTS, { recursive: true });
  const index = [];

  for (const [agentId, pkg] of Object.entries(AGENT_PACKAGE_MAP)) {
    const src = join(RAW_AGENTS, `${agentId}.json`);
    const assetDir = join(LOCAL_AGENTS, pkg);

    if (!existsSync(src)) {
      console.warn(`[agents] 跳过 ${agentId}：找不到原始定义 ${src}`);
      continue;
    }
    if (!existsSync(join(assetDir, 'model.vrm'))) {
      console.warn(`[agents] 跳过 ${agentId}：本地缺 model.vrm`);
      continue;
    }

    const agent = JSON.parse(readFileSync(src, 'utf8'));

    const avatar = pick(assetDir, (f) => /^avatar\.(jpg|jpeg|png|webp)$/i.test(f));
    const cover = pick(assetDir, (f) => /^cover\.(jpg|jpeg|png|webp)$/i.test(f));

    agent.meta = {
      ...agent.meta,
      avatar: avatar ? url('agents', pkg, avatar) : agent.meta.avatar,
      cover: cover ? url('agents', pkg, cover) : agent.meta.cover,
      model: url('agents', pkg, 'model.vrm'),
    };

    writeFileSync(join(OUT_AGENTS, `${agentId}.json`), JSON.stringify(agent, null, 2) + '\n');

    index.push({
      agentId,
      author: agent.author,
      createAt: agent.createAt,
      homepage: agent.homepage,
      meta: {
        avatar: agent.meta.avatar,
        category: agent.meta.category,
        cover: agent.meta.cover,
        description: agent.meta.description,
        name: agent.meta.name,
      },
    });
  }

  index.sort((a, b) => (a.createAt < b.createAt ? 1 : -1));
  writeFileSync(
    join(OUT_AGENTS, 'index.json'),
    JSON.stringify({ agents: index, schemaVersion: 1 }, null, 2) + '\n',
  );
  console.log(`[agents] 生成 ${index.length} 个角色：${index.map((i) => i.agentId).join(', ')}`);
}

function buildDances() {
  mkdirSync(OUT_DANCES, { recursive: true });

  if (!existsSync(RAW_DANCE_INDEX)) {
    console.warn('[dances] 缺少线上索引快照，输出的就是空列表');
  }
  const remote = existsSync(RAW_DANCE_INDEX)
    ? JSON.parse(readFileSync(RAW_DANCE_INDEX, 'utf8'))
    : { dances: [] };

  const out = [];
  for (const [danceId, pkg] of Object.entries(DANCE_PACKAGE_MAP)) {
    const dir = join(LOCAL_DANCES, pkg);
    if (!existsSync(dir)) {
      console.warn(`[dances] 跳过 ${danceId}：本地缺目录`);
      continue;
    }

    const files = readdirSync(dir);
    const src = files.find((f) => /\.vmd$/i.test(f) && !/camera/i.test(f));
    const camera = files.find((f) => /camera.*\.vmd$/i.test(f));
    const audio = files.find((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f));
    const cover = files.find((f) => /^cover\.(jpg|jpeg|png|webp)$/i.test(f));
    const thumb = files.find((f) => /^thumb\.(jpg|jpeg|png|webp)$/i.test(f));

    if (!src || !audio) {
      console.warn(`[dances] 跳过 ${danceId}：缺动作或音频文件`);
      continue;
    }

    const base = remote.dances?.find((d) => d.danceId === danceId) || {};

    out.push({
      ...base,
      audio: url('dances', pkg, audio),
      author: base.author || 'rdmclin2',
      camera: camera ? url('dances', pkg, camera) : undefined,
      cover: cover ? url('dances', pkg, cover) : '',
      createAt: base.createAt || '2024-01-01',
      danceId,
      homepage: base.homepage || 'https://github.com/rdmclin2',
      name: base.name || danceId,
      readme: base.readme || '',
      schemaVersion: 1,
      src: url('dances', pkg, src),
      thumb: thumb ? url('dances', pkg, thumb) : cover ? url('dances', pkg, cover) : '',
    });
  }

  writeFileSync(
    join(OUT_DANCES, 'index.json'),
    JSON.stringify({ dances: out, schemaVersion: 1 }, null, 2) + '\n',
  );
  console.log(`[dances] 生成 ${out.length} 支舞蹈：${out.map((d) => d.danceId).join(', ')}`);
}

buildAgents();
buildDances();
