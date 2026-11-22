import type { VRM } from '@pixiv/three-vrm';

/**
 * 表情映射。
 *
 * 搬过来的情绪片段只动骨骼——脸一直是同一张。Hanami 那边（`emotionMap`）做的事是：
 * 把「情绪」这个名字解析成模型上真实存在的 VRM 表情名，然后按权重压上去。
 *
 * 要点是**名字不一定存在**：VRM 1.0 有 happy / sad / angry / surprised / relaxed
 * 这套预设，0.x 或者自制模型常常只有自定义 blendshape（大小写还不一定一样）。
 * 所以加载时先解析一次成表，解析不到的就不驱动，而不是每帧去猜。
 */

/** 这套名字是 VRM 预设名，也是我们内部用的情绪名 */
const CANONICAL = ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const;
export type EmotionName = (typeof CANONICAL)[number];

/**
 * 把「设置 → 触摸」里选的表情（VRM 预设名）收窄成这里能吃的那几个。
 *
 * 那边列表里还有眨眼、口型这类预设，它们不是情绪，这里不表达——
 * 返回 undefined 就是「不额外压表情」，片段照播。
 */
export function toStageEmotion(preset?: string): EmotionName | 'neutral' | undefined {
  switch (preset) {
    case 'happy':
    case 'sad':
    case 'angry':
    case 'surprised':
    case 'relaxed':
    case 'neutral': {
      return preset;
    }
    default: {
      return undefined;
    }
  }
}

/** 每个情绪压多大：情绪片段本身已经带了身体语言，脸不用满 */
const BASE_WEIGHT: Record<EmotionName, number> = {
  happy: 0.85,
  sad: 0.7,
  angry: 0.6,
  surprised: 0.75,
  relaxed: 0.55,
};

/** 权重接近目标的速度（指数平滑时间常数，秒） */
const SMOOTH_TAU_S = 0.16;

export class StageExpression {
  /** 情绪名 → 模型上真实的表情名 */
  private table = new Map<EmotionName, string>();
  private current = new Map<EmotionName, number>();
  private target = new Map<EmotionName, number>();
  /** 到这个时刻之后回到中性（表情不会永远挂着） */
  private holdUntil = 0;

  constructor(private vrm: VRM) {
    this.resolve();
  }

  /** 模型上到底有哪些能用的表情（调试用） */
  public get available(): string[] {
    return [...this.table.values()];
  }

  /** 当前各项权重的快照（调试用） */
  public get weights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, weight] of this.current) {
      if (weight > 0.01) out[name] = Number(weight.toFixed(2));
    }
    return out;
  }

  /** 换一个情绪；holdS 之后自动回到中性 */
  public set(emotion: EmotionName | 'neutral', holdS = 3) {
    for (const name of CANONICAL) {
      this.target.set(name, name === emotion ? BASE_WEIGHT[name] : 0);
    }
    this.holdUntil = performance.now() + holdS * 1000;
  }

  public neutral() {
    this.set('neutral', 0);
  }

  public update(delta: number) {
    const manager = this.vrm.expressionManager;
    if (!manager) return;

    // 到点了就放开，让她回到自己的默认脸
    if (this.holdUntil > 0 && performance.now() > this.holdUntil) {
      this.holdUntil = 0;
      for (const name of CANONICAL) this.target.set(name, 0);
    }

    const k = 1 - Math.exp(-delta / SMOOTH_TAU_S);
    for (const name of CANONICAL) {
      const goal = this.target.get(name) ?? 0;
      const prev = this.current.get(name) ?? 0;
      const next = prev + (goal - prev) * k;
      const resolved = this.table.get(name);
      if (!resolved) continue;

      // 已经在 0 附近就不写了，免得每帧和别的表情控制打架
      if (next < 0.005 && goal === 0 && prev <= 0.005) {
        this.current.set(name, 0);
        continue;
      }
      this.current.set(name, next);
      manager.setValue(resolved, Math.max(0, Math.min(1, next)));
    }
  }

  /** 解析一次：先精确匹配预设名，再按大小写不敏感匹配自定义表情 */
  private resolve() {
    const manager = this.vrm.expressionManager;
    if (!manager) return;

    const presets = manager.expressionMap as Record<string, unknown>;
    const customNames = Object.keys(manager.customExpressionMap ?? {});

    for (const name of CANONICAL) {
      if (presets[name] !== undefined) {
        this.table.set(name, name);
        this.current.set(name, 0);
        this.target.set(name, 0);
        continue;
      }
      const custom = customNames.find((candidate) => candidate.toLowerCase() === name);
      if (custom !== undefined) {
        this.table.set(name, custom);
        this.current.set(name, 0);
        this.target.set(name, 0);
      }
    }
  }
}

