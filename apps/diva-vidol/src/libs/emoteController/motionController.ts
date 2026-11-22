import type { VRM } from '@pixiv/three-vrm';
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
} from 'three';

import { loadMixamoAnimation } from '@/libs/FBXAnimation/loadMixamoAnimation';
import { loadVMDAnimation } from '@/libs/VMDAnimation/loadVMDAnimation';
import IKHandler from '@/libs/VMDAnimation/vrm-ik-handler';
import VRMIKHandler from '@/libs/VMDAnimation/vrm-ik-handler';
import { loadVRMAnimation } from '@/libs/VRMAnimation/loadVRMAnimation';

import { MotionPresetName, motionPresetMap } from './motionPresetMap';
import { StageBreath } from './stageBreath';
import { StageGround } from './stageGround';
import { StageLegIk } from './stageLegIk';
import { StageJointLimits } from './stageJointLimits';
import { StageExpression } from './stageExpression';
import { StageGaze } from './stageGaze';
import { MotionFileType } from './type';

/** 切换动作时的交叉淡入时长（秒）。素材本身带量好的接缝，这里只做兜底渐变。 */
const CROSSFADE_S = 0.24;

export interface PlayClipOptions {
  loop?: boolean;
  /** 播完后自动回到待机（只有一次性动作有意义） */
  returnToIdle?: boolean;
  fadeS?: number;
}

/**
 * 过渡时长 + 缓动 —— 现在逐条对得上素材了。
 *
 * 做法：把 `public/vrma/transitions.json`（Overte 状态图的摊平结果）按「每个状态播哪些
 * 片段」分组取中位数，并记下它来自哪个状态。探针是
 * `scratch/probe-transitions-families.mjs`，可以随时重跑复核。
 *
 * 两边没有 ID 表能直接 join（Overte 叫 `walkFwdNormal_c`，Hanami 改名叫 `world-walk`），
 * 所以是按家族对齐的。能直接引用的几条：
 *
 *   idleToWalkFwd     0.267 s  linéaire        → 步态循环、起步/收步
 *   turnLeft/Right    0.500 s  easeInOutQuad   → 转身片段
 *   seated 家族中位数  0.267 s  easeInOutQuad   → 坐下 / 站起 / 坐姿
 *   talk / talk02…    0.667 s  easeInOutQuad   → 说话
 *   idle 家族中位数    0.500 s  easeInOutQuad   → 待机
 *
 * 缓动也跟着状态图走：移动类在 Overte 里标的是 `linéaire`，其余是 `easeInOutQuad`。
 * 这和 `fades.ts` 里量出来的结论一致——给行走循环的接缝加缓动是反效果。
 */
type FadeEase = 'linear' | 'ease';

const FADE_RULES: { pattern: RegExp; seconds: number; ease: FadeEase; from: string }[] = [
  // 步态循环 + 起步/收步：Overte 的 idleToWalkFwd（0.267 s，线性）
  { pattern: /world-(walk|jog|run|strafe)/, seconds: 0.267, ease: 'linear', from: 'idleToWalkFwd' },
  {
    pattern: /world-(walk-start|walk-stop)/,
    seconds: 0.267,
    ease: 'linear',
    from: 'idleToWalkFwd',
  },
  // 转身片段：Overte 的 turnLeft / turnRight（0.5 s，缓动）
  { pattern: /world-turn-(left|right)/, seconds: 0.5, ease: 'ease', from: 'turnLeft/turnRight' },
  // 坐姿一族：seated 家族中位数 0.267 s
  { pattern: /world-sit-/, seconds: 0.267, ease: 'ease', from: 'seated*' },
  // 说话：Overte 的 talk / talk02 / talk03 …（0.667 s）
  { pattern: /\/(talking|talk)/, seconds: 0.667, ease: 'ease', from: 'talk*' },
  // 待机：idle 家族中位数 0.5 s
  { pattern: /\/(idle|idle-\d+|idle-alt\d)/, seconds: 0.5, ease: 'ease', from: 'idle*' },
];

const DEFAULT_FADE_S = 0.24;

/**
 * Overte 的缓动，公式照抄 `AnimUtil.cpp` 的 `easeInOutQuad`：
 *   α < 0.5 → 2α² ；否则 → −2α² + 4α − 1
 * 两端导数为 0，所以淡入淡出的**起点和终点没有速度台阶**——那正是「一卡」的来源。
 * three 自带的 crossFadeFrom 是线性的，两端各有一次速度突变。
 */
function easeInOutQuad(alpha: number): number {
  return alpha < 0.5 ? 2 * alpha * alpha : -2 * alpha * alpha + 4 * alpha - 1;
}

/** 正在做的一次缓动过渡 */
interface FadeRun {
  from?: AnimationAction;
  /** 接管时 from 的实际权重（中途再切片段时不能假装它是 1） */
  fromWeight: number;
  to: AnimationAction;
  elapsed: number;
  duration: number;
  /** 缓动方式：移动类在 Overte 状态图里标的是线性，其余是 easeInOutQuad */
  ease: FadeEase;
}

function fadeRuleFor(url?: string) {
  if (!url) return undefined;
  return FADE_RULES.find((rule) => rule.pattern.test(url));
}

function fadeSecondsFor(url?: string) {
  return fadeRuleFor(url)?.seconds ?? DEFAULT_FADE_S;
}

function fadeEaseFor(url?: string): FadeEase {
  return fadeRuleFor(url)?.ease ?? 'ease';
}


/**
 * 动作播放器
 *
 * 与旧版的区别：整份 VRM 只用一个 AnimationMixer，动作之间交叉淡入，
 * 一次性动作播完自动回待机。旧版每次播放新建 mixer，等于硬切。
 */
export class MotionController {
  private vrm: VRM;
  private mixer: AnimationMixer;
  /** 当前动作是不是一次性的、还没播完 */
  public get isOneShotPlaying() {
    return Boolean(this.currentAction?.isRunning() && this.currentAction.loop === LoopOnce);
  }

  private currentAction?: AnimationAction;
  private currentUrl?: string;
  /**
   * 播放代次：每次请求播片段就 +1，片段建立时记下当时的代次。
   * 用来判断「这条 finished 事件是不是已经过期的旧片段发出来的」——
   * 走路起步片段播完时把身后的 walk 循环换成待机，就是靠这个挡掉的。
   */
  private playGen = 0;
  private actionGen = new WeakMap<AnimationAction, number>();
  /** 联调读数：最近一次切片段用的时长与缓动 */
  public lastFade = '-';
  /** 当前正在跑的缓动过渡（同一时刻只保留最后一次切片段的那一段） */
  private fade?: FadeRun;
  /** 预加载过的片段缓存（按 url） */
  private preloadedMotions = new Map<string, AnimationClip>();
  private ikHandler: VRMIKHandler;

  /** 播完后回到这里；由 Model 在加载完成后设成 idle 的剪辑 */
  private idleUrl?: string;
  /**
   * 走位期间由 StageNavigator 置 true：这段时间片段由它自己调度，
   * 任何一次性片段播完都不许回待机（起步片段 → 走路循环的接力就靠这个）。
   */
  public suppressReturnToIdle = false;
  /** 注视层：每帧在片段姿势之上叠加脖子/头的朝向 */
  public gaze: StageGaze;
  /** 呼吸层：站着不动时唯一的持续动作 */
  private breath: StageBreath;
  /** 贴地层：整具模型沿 Y 对齐，让较低的脚踩在地面上 */
  public ground: StageGround;
  /** 逐腿足底 IK：站着不动时把两只脚都压到地面上 */
  public legIk: StageLegIk;
  public expression: StageExpression;
  /** 膝关节限位：mixer 之后、IK 之前 */
  public jointLimits: StageJointLimits;

  constructor(vrm: VRM, camera: Object3D) {
    this.vrm = vrm;
    this.gaze = new StageGaze(vrm, camera);
    this.breath = new StageBreath(vrm);
    this.ground = new StageGround(vrm);
    this.legIk = new StageLegIk(vrm);
    this.expression = new StageExpression(vrm);
    this.jointLimits = new StageJointLimits(vrm);
    this.mixer = new AnimationMixer(vrm.scene);
    this.ikHandler = IKHandler.get(vrm);
    this.mixer.addEventListener('finished', this.handleFinished);
  }

  /** 设定待机片段：一次性动作播完会回到它 */
  public setIdleUrl(url: string) {
    this.idleUrl = url;
  }

  /**
   * 一次性动作播完 → 回待机。
   *
   * **只理会「当前正在播的那一段」**。被交叉淡入盖掉的上一个片段也会发 finished，
   * 那时候如果照旧回待机，就会把刚接上的循环掐掉——走路走着走着变成站着滑步，
   * 就是起步片段播完、finished 事件把 walk 循环换回了 idle（实测见 walkdiag）。
   */
  private handleFinished = (event: { action: AnimationAction }) => {
    if (this.suppressReturnToIdle) return;
    if (!this.idleUrl || this.currentUrl === this.idleUrl) return;
    const action = event?.action;
    if (!action) return;
    // 旧片段的 finished：它已经被后来的播放取代了，别拿它去回待机
    const gen = this.actionGen.get(action);
    if (gen !== undefined && gen !== this.playGen) return;
    if (this.currentAction && action !== this.currentAction) return;
    void this.playMotionUrl(MotionFileType.VRMA, this.idleUrl, true);
  };

  public async preloadMotion(motion: MotionPresetName) {
    const { type, url } = this.getMotionInfo(motion);
    await this.preloadMotionUrl(type, url);
  }

  public async preloadMotionUrl(fileType: MotionFileType, url: string) {
    if (this.preloadedMotions.has(url)) return;
    const clip = await this.loadMotionClip(fileType, url);
    if (clip) this.preloadedMotions.set(url, clip);
  }

  public playMotion(motion: MotionPresetName, loop: boolean) {
    const { type, url } = this.getMotionInfo(motion);
    if (type && url) void this.playMotionUrl(type, url, loop);
  }

  private getMotionInfo(motion: MotionPresetName) {
    return motionPresetMap[motion] || motionPresetMap.idle;
  }

  public async playMotionUrl(
    fileType: MotionFileType,
    url: string,
    loop: boolean = true,
    fadeS: number = fadeSecondsFor(url),
  ): Promise<void> {
    // 立刻占号：哪怕这个片段还在加载（下面可能 await），
    // 也已经宣告「现在轮到新的这一段了」。旧片段随后发 finished 就该被忽略。
    this.playGen += 1;
    let clip: AnimationClip | undefined;
    if (this.preloadedMotions.has(url)) {
      clip = this.preloadedMotions.get(url);
    } else {
      clip = await this.loadMotionClip(fileType, url);
      if (clip) this.preloadedMotions.set(url, clip);
    }

    if (!clip) {
      console.error(`无法加载动作: ${url}`);
      return;
    }

    this.playClip(clip, { loop, fadeS, url });
  }

  /** 直接播一个已加载的剪辑（动作库面板走这条） */
  public playClip(
    clip: AnimationClip,
    opts: { loop?: boolean; fadeS?: number; url?: string; ease?: FadeEase } = {},
  ) {
    const { loop = true, fadeS = CROSSFADE_S, url, ease = fadeEaseFor(url) } = opts;
    // 联调读数：这一刀用的时长 / 缓动 / 命中的是哪条规则
    if (url) {
      this.lastFade = `${url.split('/').pop()} ${fadeS.toFixed(3)}s ${ease}`;
    }

    const next = this.mixer.clipAction(clip);
    if (next === this.currentAction && loop) return;

    next.reset();
    next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.setEffectiveWeight(1);

    if (this.currentAction && this.currentAction !== next) {
      // 缓动交叉淡入，替掉 three 的线性 crossFadeFrom。
      // 上一段过渡还没跑完时，从「此刻真正最显眼的那一条」接着淡，
      // 而不是假装它还是满权重——否则连切片段会闪。
      const candidates: { action: AnimationAction; weight: number }[] = [];
      if (this.fade?.from) {
        candidates.push({ action: this.fade.from, weight: this.fade.from.getEffectiveWeight() });
      }
      if (this.fade?.to) {
        candidates.push({ action: this.fade.to, weight: this.fade.to.getEffectiveWeight() });
      }
      if (this.currentAction) {
        candidates.push({
          action: this.currentAction,
          weight: this.currentAction.getEffectiveWeight(),
        });
      }
      candidates.sort((a, b) => b.weight - a.weight);
      const source = candidates.find((item) => item.action !== next);
      if (source) {
        source.action.enabled = true;
        source.action.setEffectiveWeight(source.weight);
      }
      this.fade = {
        from: source?.action,
        fromWeight: source?.weight ?? 0,
        to: next,
        elapsed: 0,
        duration: Math.max(fadeS, 1e-3),
        ease,
      };
      next.setEffectiveWeight(0);
    }
    next.play();

    this.currentAction = next;
    this.currentUrl = url;
    this.actionGen.set(next, this.playGen);
    this.ikHandler.disableAll();
  }

  private async loadMotionClip(
    fileType: MotionFileType,
    url: string,
  ): Promise<AnimationClip | undefined> {
    switch (fileType) {
      case 'vmd':
        return await this.loadVMD(url);
      case 'fbx':
        return await this.loadFBX(url);
      case 'vrma':
        return await this.loadVRMA(url);
      default:
        throw new Error('不支持的文件格式');
    }
  }

  private async loadVMD(url: string): Promise<AnimationClip | undefined> {
    return await loadVMDAnimation(url, this.vrm);
  }

  private async loadFBX(url: string): Promise<AnimationClip | undefined> {
    return await loadMixamoAnimation(url, this.vrm);
  }

  private async loadVRMA(url: string): Promise<AnimationClip | undefined> {
    return await loadVRMAnimation(url, this.vrm);
  }

  /**
   * 停止动作。mixer 留着（姿势预设要靠它不再写骨骼），只把当前动作淡出。
   */
  public stopMotion(): void {
    this.fade = undefined;
    if (this.currentAction) {
      this.currentAction.fadeOut(CROSSFADE_S);
      this.currentAction = undefined;
    }
    this.ikHandler.disableAll();
    this.currentUrl = undefined;
  }

  public get currentClipUrl(): string | undefined {
    return this.currentUrl;
  }

  public update(delta: number): void {
    // 先把本帧的过渡权重写好，再交给 mixer —— 权重必须在采样之前生效
    if (this.fade) {
      const fade = this.fade;
      fade.elapsed += delta;
      const progress = Math.min(fade.elapsed / fade.duration, 1);
      const alpha = fade.ease === 'linear' ? progress : easeInOutQuad(progress);
      if (fade.from) fade.from.setEffectiveWeight(fade.fromWeight * (1 - alpha));
      fade.to.setEffectiveWeight(alpha);
      if (progress >= 1) {
        fade.from?.stop();
        this.fade = undefined;
      }
    }
    // 先撤回上一帧叠上去的注视，否则没被片段驱动的骨骼会一帧帧累加
    this.gaze.restore();
    this.breath.restore();
    this.mixer.update(delta);
    // 关节限位紧跟 mixer：先把片段摆出来的姿势收回人体范围，后面的 IK / 注视再在其上工作
    this.jointLimits.apply();
    // 注视必须在 mixer 之后（叠加在本帧姿势上）、vrm.update 之前（否则不生效）
    this.gaze.update(delta);
    this.breath.update(delta);
    // 逐腿 IK 要在 vrm.update 之前：它改的是 normalized 骨骼，vrm.update 才把它们烘到 raw 骨骼
    this.legIk.update();
    this.expression.update(delta);
    this.vrm.update(delta);
    // 贴地必须在 vrm.update 之后：那时候骨骼的世界矩阵才是这一帧的姿势
    // 两者是配合关系：整体平移负责把「较低的那只脚」带到地面（这会同时决定髋高），
    // 逐腿 IK 只把「另一只还悬着的脚」压下去。只留其中一个都不够——
    // 只平移则总有一只脚浮着；只 IK 则站直时腿已经到底，脚根本降不下去。
    this.ground.update(delta);
    this.ikHandler.update();
  }
}











