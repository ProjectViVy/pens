/**
 * 把一段回复切成「一句一句」
 *
 * galgame 那种字幕是一句一句往外走的，不是一次糊一整段。所以先把文本按标点切开，
 * 再挑出太短/太长的段做合并与二次切分——「嗯。」单独闪一下反而看不懂。
 */

const BREAK_CHARS = new Set(['。', '！', '？', '!', '?', '…', '；', ';', '～', '~', '\n']);
const SOFT_CHARS = new Set(['，', ',', '、', '：', ':']);

/** 短于这个字数（去掉标点后）就跟下一句合并 */
const MIN_CHARS = 3;
/** 一段大致超过这个字数就按逗号再切一刀，免得太长一句憋半天 */
const MAX_CHARS = 26;

const visibleLength = (text: string) => text.replace(/[\s\p{P}]/gu, '').length;

export function splitSegments(text: string): string[] {
  const raw = text.replace(/\r\n?/g, '\n').trim();
  if (!raw) return [];

  // 1. 先按句末标点硬切
  const hard: string[] = [];
  let buffer = '';
  for (const char of raw) {
    buffer += char;
    if (BREAK_CHARS.has(char)) {
      hard.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) hard.push(buffer.trim());

  // 2. 太短的并到下一句（最后一句太短就并到上一句）
  const merged: string[] = [];
  for (const segment of hard) {
    if (merged.length > 0 && visibleLength(merged[merged.length - 1]) < MIN_CHARS) {
      merged[merged.length - 1] += segment;
      continue;
    }
    merged.push(segment);
  }
  if (merged.length > 1 && visibleLength(merged[merged.length - 1]) < MIN_CHARS) {
    const tail = merged.pop() as string;
    merged[merged.length - 1] += tail;
  }

  // 3. 太长的按逗号再切
  const result: string[] = [];
  for (const segment of merged) {
    if (visibleLength(segment) <= MAX_CHARS) {
      result.push(segment);
      continue;
    }
    let piece = '';
    for (const char of segment) {
      piece += char;
      if (SOFT_CHARS.has(char) && visibleLength(piece) >= MAX_CHARS / 2) {
        result.push(piece.trim());
        piece = '';
      }
    }
    if (piece.trim()) result.push(piece.trim());
  }

  return result.filter(Boolean);
}
