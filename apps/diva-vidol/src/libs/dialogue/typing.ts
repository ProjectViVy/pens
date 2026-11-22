/**
 * 台词的节奏（打字 → 停 3 秒 → 渐变消失）
 *
 * 这些数字被两处共用：`Subtitle`（负责逐字显示）和 `libs/dialogue/say.ts`
 * （负责决定一句留多久）。写在两个地方迟早会不同步，所以放这儿。
 */

/** 每个字停留多久（毫秒）：55ms ≈ 每秒 18 字，再快就看不出在打了 */
export const CHAR_MS = 55;

/** 起手空档：字不是「啪」地一下出现 */
export const START_DELAY_MS = 70;

/** 打完字之后停多久：3 秒，够看清一整句 */
export const HOLD_MS = 3000;

/** 渐变消失用多久：和 CSS 里的 transition 保持一致 */
export const FADE_MS = 450;

/** 标点停一下：句末长一点，逗号短一点，读起来才有断句 */
export const PAUSE_MS: Record<string, number> = {
  '。': 240,
  '，': 130,
  '、': 120,
  '：': 140,
  '；': 220,
  '？': 240,
  '！': 240,
  '…': 200,
  '～': 160,
  '~': 160,
};

/**
 * 打完一句话要多少毫秒
 *
 * 第一个字在 `START_DELAY_MS` 出现，之后每多一个字等「上一个字」的间隔
 * （标点用 `PAUSE_MS`，其余 `CHAR_MS`）——和组件里那串 `setTimeout` 是同一套算法。
 */
export function typingDurationMs(text: string): number {
  if (!text) return 0;
  let total = START_DELAY_MS;
  for (let index = 1; index < text.length; index++) {
    total += PAUSE_MS[text[index - 1]] ?? CHAR_MS;
  }
  return total;
}

/** 一句完整占用的时间：打字 + 停 3 秒 + 渐变 */
export function segmentDurationMs(text: string): number {
  return typingDurationMs(text) + HOLD_MS + FADE_MS;
}

/** 一整段回复占用的时间 */
export function replyDurationMs(segments: string[]): number {
  return segments.reduce((sum, segment) => sum + segmentDurationMs(segment), 0);
}
