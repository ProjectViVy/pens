/**
 * 舞台帧预算
 *
 * 渲染循环只回答两个问题：这一帧该不该画、该按多少帧画。
 * 这两件事都被单独放在这里（纯函数、不碰 THREE、不碰 DOM），
 * 因为它们是「省电」的全部规则，必须能被直接测——而不是靠肉眼猜帧率。
 *
 * 帧率档位（实测依据见 scripts/perfProbe.mjs 与 frameBudget.test.ts）：
 * - 待机 30：呼吸、眨眼、头发在 24~30 帧看不出差别，比满帧省一半；
 * - 演出 60：跳舞、走路、一次性动作、交互后的一小段时间，掉帧会被一眼看出；
 * - 窗口失焦 15：她在别的程序后面，只看得出「还在动」就行。
 *
 * 注意：「打开设置」不在这里。那不是降帧，是整个舞台都不存在了——
 * Stage 会把 CharacterViewer 卸掉，走 viewer.teardown()，一帧都不再画。
 */

export const FPS_ACTIVE = 60;
export const FPS_IDLE = 30;
export const FPS_UNFOCUSED = 15;

export interface FrameState {
  /** 当前时间戳（performance.now()） */
  now: number;
  /** 被交互叫醒到什么时候 */
  wakeUntil: number;
  /** 正在跳舞 */
  dancing: boolean;
  /** 正在走位 / 闲逛 */
  walking: boolean;
  /** 正在演一次性动作 */
  oneShot: boolean;
  /** 窗口不在前台 */
  unfocused: boolean;
}

/** 当前该按多少帧跑 */
export function frameCapFor(state: FrameState): number {
  // 刚被交互叫醒：这段时间一律满帧，用户正在看
  if (state.now < state.wakeUntil) return FPS_ACTIVE;
  // 在演：满帧
  if (state.dancing || state.walking || state.oneShot) return FPS_ACTIVE;
  // 窗口不在前台：15 帧，呼吸还在动，但便宜一半
  if (state.unfocused) return FPS_UNFOCUSED;
  // 待机
  return FPS_IDLE;
}

export interface LoopState {
  /** 画布挂上了、循环应该跑 */
  wantLoop: boolean;
  /** 渲染器还在（没被 teardown 掉） */
  rendererReady: boolean;
  /** 页面在后台（切标签 / 最小化） */
  hidden: boolean;
}

/**
 * 现在该不该继续排下一帧
 *
 * 只有「循环被主动停掉」「渲染器已经卸下」「页面前后台不可见」三种情况彻底停。
 * 打开设置属于「渲染器已经卸下」：Stage 会把 CharacterViewer 整个卸掉。
 */
export function shouldPaint(state: LoopState): boolean {
  return state.wantLoop && state.rendererReady && !state.hidden;
}

export interface PaintTiming {
  /** 这一帧要不要真的画 */
  due: boolean;
  /** 这一档的帧间隔（毫秒） */
  interval: number;
  /** 下一次判断用的「上一帧时间」 */
  nextLastPaint: number;
}

/**
 * 判断「到点」时允许的误差（毫秒）
 *
 * rAF 的时间戳和 1000/30 这样的间隔都不是整数，直接 `elapsed >= interval`
 * 会在恰好到点的那些帧上因为 0.0000001 的误差判成「还没到」，白丢一帧。
 * 半毫秒的容差不会让 60 帧档多画一帧（那一档的间隔是 16.7ms）。
 */
const DUE_TOLERANCE_MS = 0.5;

/**
 * 节流判断
 *
 * `lastPaint < 0` 表示还没画过（用 -1 当哨兵，而不是 0——
 * 0 在页面刚加载时是合法时间戳，拿它当「没画过」会让第一秒按满帧跑）。
 *
 * 画完一帧之后，节拍基准**加一个固定的 interval**，而不是对齐到当前时间：
 * 60Hz 屏幕上 30 帧档的回调间隔是 16.7ms，如果每次对齐到 now，
 * 每一帧都会差一点点、每一帧都被跳过，实际只能跑到 20 帧。
 * 只有在落后超过一整个 interval 时（切后台回来、断点）才重新对齐。
 */
export function paintTiming(now: number, lastPaint: number, cap: number): PaintTiming {
  const interval = 1000 / cap;
  const first = lastPaint < 0;
  const elapsed = first ? interval : now - lastPaint;
  const due = first || elapsed >= interval - DUE_TOLERANCE_MS;
  if (!due) return { due, interval, nextLastPaint: lastPaint };
  return {
    due,
    interval,
    // 正常：往后推一格；落后太多：贴到「现在」的前一格，最多补一帧的追赶
    nextLastPaint: first ? now : Math.max(lastPaint + interval, now - interval),
  };
}
