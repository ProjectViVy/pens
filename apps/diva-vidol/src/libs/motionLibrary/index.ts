/**
 * 动作库（Hanami 素材侧）
 *
 * 索引由 `scripts/port-hanami-motion.mjs` 生成到 `public/vrma/index.json`：
 * 151 个 `.vrma` 片段（Overte/Apache-2.0、Rocketbox/MIT、Quaternius/CC0），
 * 带 world.json 里量好的时长、循环、步速与坐姿高度分数。
 *
 * 这里只做读取与分组，不含任何播放逻辑（播放走 MotionController）。
 */

export type MotionCategory =
  | 'idle'
  | 'talking'
  | 'emotion'
  | 'response'
  | 'greeting'
  | 'locomotion'
  | 'transition'
  | 'seated'
  | 'world-idle'
  | 'world-gesture';

export interface MotionClipMeta {
  id: string;
  file: string;
  domain: 'face' | 'world';
  family: string;
  category: MotionCategory;
  label: string;
  role?: string | null;
  loop: boolean;
  durationS?: number | null;
  /** 片段本身的步速（m/s），以测量 rig 髋高 1.0167 m 为基准 */
  speedMS?: number | null;
  cycleM?: number | null;
  lateralMS?: number | null;
  hipsFraction?: { min: number; max: number; debut: number; fin: number } | null;
  chain?: { depuis: string; vers: string } | null;
  license?: string | null;
  credit?: string | null;
}

export interface MotionIndex {
  version: number;
  generatedAt: string;
  source: Record<string, unknown>;
  counts: { total: number; byCategory: Record<string, number> };
  clips: MotionClipMeta[];
}

/** 面板里的分类顺序与中文名 */
export const MOTION_CATEGORIES: { key: MotionCategory; label: string }[] = [
  { key: 'idle', label: '待机' },
  { key: 'talking', label: '说话' },
  { key: 'emotion', label: '情绪' },
  { key: 'greeting', label: '招呼' },
  { key: 'response', label: '回应' },
  { key: 'locomotion', label: '移动' },
  { key: 'seated', label: '坐姿' },
  { key: 'transition', label: '过渡' },
  { key: 'world-idle', label: '场景待机' },
  { key: 'world-gesture', label: '场景手势' },
];

let cache: Promise<MotionIndex> | null = null;

export function loadMotionIndex(): Promise<MotionIndex> {
  if (!cache) {
    cache = fetch('/vrma/index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`动作索引加载失败: ${res.status}`);
        return res.json() as Promise<MotionIndex>;
      })
      .catch((error) => {
        cache = null;
        throw error;
      });
  }
  return cache;
}

export function findClip(index: MotionIndex, id: string): MotionClipMeta | undefined {
  return index.clips.find((clip) => clip.id === id);
}

/** 某个分类下的片段，按 id 排序（-2、-3 这类变体自然排在一起） */
export function clipsOf(index: MotionIndex, category: MotionCategory): MotionClipMeta[] {
  return index.clips
    .filter((clip) => clip.category === category)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
