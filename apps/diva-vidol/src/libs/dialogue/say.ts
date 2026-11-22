import { clipsOf, loadMotionIndex } from '@/libs/motionLibrary';
import { useDialogueStore } from '@/store/dialogue';
import { useGlobalStore } from '@/store/global';

import { FADE_MS, HOLD_MS, replyDurationMs, typingDurationMs } from './typing';

/**
 * 把回复搬上台词
 *
 * 一句的完整节奏：**打字 → 停 3 秒 → 渐变消失**，然后才轮到下一句。
 * 三段时长都来自 `typing.ts`（和组件里逐字显示的算法共用同一套常量）。
 *
 * 渐变不是「瞬间把字抹掉」：先把 `subtitleFading` 置真，组件挂上 `opacity: 0` 的过渡，
 * 等 `FADE_MS` 之后再清空字符串——顺序反了就没有动画可看。
 *
 * 说话动作（动作库里 `talking` 分类的循环片段）整段只起一次，
 * 时长按整段总时长给，免得句与句之间她来回抽搐。
 *
 * 播放是可以打断的：新的一条回复进来，旧的那条立刻让位（`token` 自增）。
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 打断计数：每次都 +1，还在等待的旧字幕看到数字变了就自己退场 */
let token = 0;

/** 说话片段缓存（一次请求，之后复用） */
let talkingClips: Promise<string[]> | null = null;

function getTalkingClips(): Promise<string[]> {
  if (!talkingClips) {
    talkingClips = loadMotionIndex()
      .then((index) => clipsOf(index, 'talking').map((clip) => clip.id))
      .catch(() => {
        talkingClips = null;
        return [];
      });
  }
  return talkingClips;
}

/** 立刻收起当前字幕（比如清空历史、或者页面要走了） */
export function stopSubtitle() {
  token += 1;
  const { setSubtitle, setSubtitleFading } = useDialogueStore.getState();
  setSubtitleFading(false);
  setSubtitle('');
}

async function startTalkingMotion(seconds: number, expression?: string) {
  const clips = await getTalkingClips();
  if (clips.length === 0) return;
  const navigator = useGlobalStore.getState().viewer?.navigator;
  if (!navigator) return;
  const clipId = clips[Math.floor(Math.random() * clips.length)];
  void navigator.playTouchClip(clipId, true, expression, seconds);
}

/**
 * 播一条回复（已经切好的句子）
 *
 * 只负责「字幕 + 说话动作」；写历史是调用方的事。
 */
export async function playSegments(segments: string[], expression?: string): Promise<void> {
  const lines = segments.filter(Boolean);
  if (lines.length === 0) return;

  const mine = ++token;
  const { setSubtitle, setSubtitleFading } = useDialogueStore.getState();
  void startTalkingMotion(replyDurationMs(lines) / 1000, expression);

  for (let index = 0; index < lines.length; index++) {
    if (mine !== token) return;
    const line = lines[index];

    setSubtitleFading(false);
    setSubtitle(line);

    // 打完字 + 停 3 秒
    await sleep(typingDurationMs(line) + HOLD_MS);
    if (mine !== token) return;

    // 渐变退场：先挂上淡出样式，等过渡跑完再清空
    setSubtitleFading(true);
    await sleep(FADE_MS);
    if (mine !== token) return;

    setSubtitle('');
    setSubtitleFading(false);
  }
}
