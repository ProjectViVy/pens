import { describe, expect, it } from 'vitest';

import {
  FPS_ACTIVE,
  FPS_IDLE,
  FPS_UNFOCUSED,
  FrameState,
  frameCapFor,
  LoopState,
  paintTiming,
  shouldPaint,
} from './frameBudget';

/** 一个默认的待机画面：什么演出都没在跑、窗口在前台 */
const idle = (patch: Partial<FrameState> = {}): FrameState => ({
  dancing: false,
  now: 10_000,
  oneShot: false,
  unfocused: false,
  wakeUntil: 0,
  walking: false,
  ...patch,
});

describe('frameCapFor', () => {
  it('待机 30 帧', () => {
    expect(frameCapFor(idle())).toBe(FPS_IDLE);
  });

  it('跳舞/走路/一次性动作都满帧', () => {
    expect(frameCapFor(idle({ dancing: true }))).toBe(FPS_ACTIVE);
    expect(frameCapFor(idle({ walking: true }))).toBe(FPS_ACTIVE);
    expect(frameCapFor(idle({ oneShot: true }))).toBe(FPS_ACTIVE);
  });

  it('被交互叫醒的一小段时间压过其余档位', () => {
    // 刚点过舞台/换过房，即使窗口失焦，这一小段也满帧
    expect(frameCapFor(idle({ unfocused: true, wakeUntil: 12_000 }))).toBe(FPS_ACTIVE);
    expect(frameCapFor(idle({ dancing: true, unfocused: true, wakeUntil: 12_000 }))).toBe(FPS_ACTIVE);
  });

  it('叫醒窗口结束后回到各自档位', () => {
    expect(frameCapFor(idle({ now: 12_001, unfocused: true, wakeUntil: 12_000 }))).toBe(FPS_UNFOCUSED);
    expect(frameCapFor(idle({ now: 12_001, wakeUntil: 12_000 }))).toBe(FPS_IDLE);
  });

  it('演出优先于失焦：窗口失焦时跳舞仍然是满帧', () => {
    expect(frameCapFor(idle({ dancing: true, unfocused: true }))).toBe(FPS_ACTIVE);
  });

  it('档位从高到低是有意义的：活跃 > 待机 > 失焦', () => {
    expect(FPS_ACTIVE).toBeGreaterThan(FPS_IDLE);
    expect(FPS_IDLE).toBeGreaterThan(FPS_UNFOCUSED);
  });
});

describe('shouldPaint', () => {
  const running = (patch: Partial<LoopState> = {}): LoopState => ({
    hidden: false,
    rendererReady: true,
    wantLoop: true,
    ...patch,
  });

  it('正常在台上就画', () => {
    expect(shouldPaint(running())).toBe(true);
  });

  it('页面切到后台不画', () => {
    expect(shouldPaint(running({ hidden: true }))).toBe(false);
  });

  it('画布卸下 / 渲染器 dispose 之后不画', () => {
    // 打开设置走的就是这一条：CharacterViewer 被卸载，渲染器已经 dispose
    expect(shouldPaint(running({ rendererReady: false }))).toBe(false);
    expect(shouldPaint(running({ wantLoop: false }))).toBe(false);
  });
});

describe('paintTiming', () => {
  it('第一帧立刻画', () => {
    const timing = paintTiming(1000, -1, FPS_IDLE);
    expect(timing.due).toBe(true);
    expect(timing.interval).toBeCloseTo(1000 / 30);
    expect(timing.nextLastPaint).toBe(1000);
  });

  it('间隔不够就不画', () => {
    const timing = paintTiming(1010, 1000, FPS_IDLE);
    expect(timing.due).toBe(false);
    // 没画就不动节拍基准
    expect(timing.nextLastPaint).toBe(1000);
  });

  it('恰好到间隔就画', () => {
    expect(paintTiming(1000 + 1000 / 30, 1000, FPS_IDLE).due).toBe(true);
  });

  it('60Hz 屏幕上 30 帧档不能掉成 20 帧（节拍要累积而不是每帧清零）', () => {
    // 60Hz：每 16.67ms 一次回调。按「每次重排对齐」的写法这里会漏掉一半帧。
    let lastPaint = -1;
    let painted = 0;
    for (let i = 0; i <= 60; i++) {
      const now = 10_000 + i * (1000 / 60);
      const timing = paintTiming(now, lastPaint, FPS_IDLE);
      if (timing.due) {
        painted++;
        lastPaint = timing.nextLastPaint;
      }
    }
    // 一秒应该落在 30 帧附近（±1 帧），而不是 20 帧
    expect(painted).toBeGreaterThanOrEqual(29);
    expect(painted).toBeLessThanOrEqual(31);
  });

  it('长时间停摆（后台回来）之后立刻画一帧', () => {
    const timing = paintTiming(60_000, 10_000, FPS_ACTIVE);
    expect(timing.due).toBe(true);
  });
});
