import { Character, GenderEnum } from '@/types/character';

/**
 * 本地人物库
 *
 * 全部来自 public/assets/agents（7 套 VRM）。原来这些角色是通过「角色市场 JSON」
 * 下载成 agent 再上台的，agent 概念删掉后这里直接列成静态表，
 * 舞台启动时默认用 DEFAULT_CHARACTER_ID。
 *
 * 加人物：把模型目录放进 public/assets/agents/<id>/（model.vrm + avatar.*），
 * 再在下面加一条即可。
 */
export const DEFAULT_CHARACTER_ID = 'vidol-agent-lilia';

export const characters: Character[] = [
  {
    avatar: '/assets/agents/vidol-agent-lilia/avatar.jpg',
    cover: '/assets/agents/vidol-agent-lilia/cover.jpg',
    description: '莉莉娅 · 官方默认角色',
    gender: GenderEnum.FEMALE,
    id: 'vidol-agent-lilia',
    modelUrl: '/assets/agents/vidol-agent-lilia/model.vrm',
    name: '莉莉娅',
  },
  {
    avatar: '/assets/agents/vidol-agent-mimi/avatar.jpg',
    cover: '/assets/agents/vidol-agent-mimi/cover.jpg',
    description: '米米 · 可爱的小女孩',
    gender: GenderEnum.FEMALE,
    id: 'vidol-agent-mimi',
    modelUrl: '/assets/agents/vidol-agent-mimi/model.vrm',
    name: '米米',
  },
  {
    avatar: '/assets/agents/vidol-agent-klee/avatar.jpg',
    cover: '/assets/agents/vidol-agent-klee/cover.jpg',
    description: '可莉 · 蒙德的小炸弹专家',
    gender: GenderEnum.FEMALE,
    id: 'vidol-agent-klee',
    modelUrl: '/assets/agents/vidol-agent-klee/model.vrm',
    name: '可莉',
  },
  {
    avatar: '/assets/agents/vidol-agent-bronya/avatar.jpg',
    cover: '/assets/agents/vidol-agent-bronya/cover.jpg',
    description: '布洛妮娅 · 崩坏星穹铁道',
    gender: GenderEnum.FEMALE,
    id: 'vidol-agent-bronya',
    modelUrl: '/assets/agents/vidol-agent-bronya/model.vrm',
    name: '布洛妮娅',
  },
  {
    avatar: '/assets/agents/vidol-agent-sample-a/avatar.jpg',
    cover: '/assets/agents/vidol-agent-sample-a/cover.jpg',
    description: 'A 模型 · Vroid 示例角色',
    gender: GenderEnum.FEMALE,
    id: 'vidol-sample-agent-a',
    modelUrl: '/assets/agents/vidol-agent-sample-a/model.vrm',
    name: 'A 模型',
  },
  {
    avatar: '/assets/agents/vidol-agent-sample-b/avatar.webp',
    cover: '/assets/agents/vidol-agent-sample-b/cover.png',
    description: 'B 模型 · Vroid 示例角色',
    gender: GenderEnum.FEMALE,
    id: 'vidol-sample-agent-b',
    modelUrl: '/assets/agents/vidol-agent-sample-b/model.vrm',
    name: 'B 模型',
  },
  {
    avatar: '/assets/agents/vidol-agent-sample-c/avatar.webp',
    cover: '/assets/agents/vidol-agent-sample-c/cover.png',
    description: 'C 模型 · Vroid 示例角色',
    gender: GenderEnum.MALE,
    id: 'vidol-sample-agent-c',
    modelUrl: '/assets/agents/vidol-agent-sample-c/model.vrm',
    name: 'C 模型',
  },
];

export const getCharacterById = (id: string): Character | undefined =>
  characters.find((item) => item.id === id);

export const defaultCharacter =
  getCharacterById(DEFAULT_CHARACTER_ID) || characters[0];


export const LOCAL_VRM_PREFIX = 'local:';

/**
 * 导入的人物没有缩略图（VRM 里没有一张能直接当封面的图），
 * 用名字首字生成一张 SVG 占位，GridList 拿它当 background-image 用。
 */
const placeholderAvatar = (name: string): string => {
  const initial = [...name.trim()].slice(0, 2).join('') || '人';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">` +
    `<rect width="320" height="320" fill="#eef1fb"/>` +
    `<text x="160" y="160" fill="#4b57c9" font-family="sans-serif" font-size="96" ` +
    `text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** 把本地库里的一条记录变成台上能用的人物 */
export const localVrmToCharacter = (meta: { id: string; name: string }): Character => ({
  avatar: placeholderAvatar(meta.name),
  cover: '',
  description: '本地导入 · 存在这台机器的浏览器里',
  gender: GenderEnum.FEMALE,
  id: meta.id,
  modelUrl: `${LOCAL_VRM_PREFIX}${meta.id}`,
  name: meta.name,
});