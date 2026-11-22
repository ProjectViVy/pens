import { VRM, VRMExpressionPresetName, VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';

import { ExpressionController } from './expressionController';
import { MotionController } from './motionController';
import { MotionPresetName, motionPresetMap } from './motionPresetMap';
import { POSTURE_BONE_NAMES, PostureBoneRotation, PosturePreset } from './posturePresets';
import { MotionFileType } from './type';

/** 姿势过渡时长（秒） */
const POSTURE_TRANSITION_DURATION = 0.4;

/** 归零姿势（reset / 过渡终点都会用到） */
const REST_ROTATION: PostureBoneRotation = { x: 0, y: 0, z: 0 };

/**
 * 姿势预设里的重心偏移量按 0.9m 髋高的角色标定（约 1.6m 高）。
 * 应用时按模型自己的髋高等比缩放：矮的角色（比如髋高 0.62m）不缩放的话，
 * 坐下会整个人陷进地面，高的角色则会悬空。
 */
const POSTURE_REFERENCE_HIP_HEIGHT = 0.9;

/**
 * 把 from -> to 的角度差收敛到 (-π, π]，避免欧拉角插值时绕远路转一整圈
 * （例如从上臂放下 -1.41 到叉腰的 +1.11 之间应该走短的那一边）。
 */
const shortestAngleDelta = (from: number, to: number) => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
};

interface PostureTransitionBone {
  node: THREE.Object3D;
  from: PostureBoneRotation;
  to: PostureBoneRotation;
}

interface PostureTransition {
  elapsed: number;
  bones: PostureTransitionBone[];
  hips?: { node: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3 };
  onComplete?: () => void;
}

/**
 * 作为情感表达操作 Expression 和 Motion的类
 */
export class EmoteController {
  private _expressionController: ExpressionController;
  private _motionController: MotionController;
  private _vrm: VRM;

  /** VRM 0.x 的 normalized 骨骼坐标系比 VRM 1.0 多转了 180° */
  private _isVRM0: boolean;
  /** 髋部 normalized 骨骼的静止位置，clearPosture 时还原到这里 */
  private _hipsRestPosition = new THREE.Vector3();
  /** 正在进行的姿势过渡；没有过渡时为 undefined */
  private _postureTransition?: PostureTransition;
  /** 当前生效的静态姿势 id（没有姿势 / 已回到 idle 时为 undefined） */
  private _currentPostureId?: string;

  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._expressionController = new ExpressionController(vrm, camera);
    this._motionController = new MotionController(vrm, camera);
    this._vrm = vrm;
    this._isVRM0 = vrm.meta?.metaVersion === '0';

    const hipsNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode) {
      this._hipsRestPosition.copy(hipsNode.position);
    }
  }

  public async preloadMotion(motion: MotionPresetName) {
    await this._motionController.preloadMotion(motion);
  }

  public async preloadMotionUrl(fileType: MotionFileType, url: string) {
    await this._motionController.preloadMotionUrl(fileType, url);
  }

  public playEmotion(preset: VRMExpressionPresetName) {
    this._expressionController.playEmotion(preset);
  }

  /** 一次性的手势/反应是否正在播（待机轮换要避开它，别把动作掐断） */
  public get isOneShotPlaying() {
    return this._motionController.isOneShotPlaying;
  }

  /** 当前片段地址（联调读数用） */
  public get currentClipUrl() {
    return this._motionController.currentClipUrl;
  }

  /** 最近一次切片段的过渡时长与缓动（联调读数用） */
  public get lastFade() {
    return this._motionController.lastFade;
  }

  /**
   * 走位期间由 StageNavigator 打开：这段时间「一次性片段播完」不许自动回待机，
   * 片段接力（起步 → 走路循环 → 收步）由导航自己排。
   */
  public setWalkHold(on: boolean) {
    this._motionController.suppressReturnToIdle = on;
  }

  /** 当前是否处在走位接力阶段（这时不许别人抢片段） */
  public get isWalkHeld() {
    return this._motionController.suppressReturnToIdle;
  }

  /** 表情层 */
  public get expression() {
    return this._motionController.expression;
  }

  /** 关节限位（膝） */
  public get jointLimits() {
    return this._motionController.jointLimits;
  }

  /** 逐腿足底 IK 层 */
  public get legIk() {
    return this._motionController.legIk;
  }

  /** 贴地层（整具模型沿 Y 对齐地面） */
  public get ground() {
    return this._motionController.ground;
  }

  /** 注视层（脖子/头朝目标转），由 Model.lookAt 驱动 */
  public get gaze() {
    return this._motionController.gaze;
  }

  /** 设定待机片段：一次性动作播完由 MotionController 自动回到它 */
  public setIdleUrl(url: string) {
    this._motionController.setIdleUrl(url);
  }

  /** 播预设动作。不传 loop 时按预设自己的定义（手势一次性、待机循环） */
  public playMotion(preset: MotionPresetName, loop?: boolean) {
    // 动作会接管骨骼，姿势状态让位
    this._cancelPostureForMotion();
    this._motionController.playMotion(preset, loop ?? motionPresetMap[preset].loop);
  }

  public playMotionUrl(fileType: MotionFileType, url: string, loop: boolean) {
    this._cancelPostureForMotion();
    this._motionController.playMotionUrl(fileType, url, loop);
  }

  public lipSync(preset: VRMExpressionPresetName, value: number) {
    this._expressionController.lipSync(preset, value);
  }

  /** 当前生效的静态姿势 id，面板用它恢复高亮 */
  public get currentPostureId(): string | undefined {
    return this._currentPostureId;
  }

  /**
   * 动作 / idle 开始前给姿势收尾。
   *
   * 旋转交给动画第一帧去覆盖（vrma 里每根骨头都有旋转轨道）；
   * 但 hips 的 position 轨道只有 vrma 自带 translation 时才会生成（idle_loop.vrma 就没有），
   * 所以降低过重心的姿势（坐下 / 蹲下）必须在这里手动把髋部还原，
   * 否则坐下之后直接播动作，人会一直悬在降低后的重心上。
   */
  private _cancelPostureForMotion() {
    this._postureTransition = undefined;
    if (!this._currentPostureId) return;

    this._currentPostureId = undefined;
    const hipsNode = this._vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    hipsNode?.position.copy(this._hipsRestPosition);
  }

  /**
   * 应用一个静态姿势（纯程序化骨骼姿势，不需要素材文件）
   *
   * 两个关键点：
   *
   * 1. 先 `stopMotion()`。AnimationMixer 只要还在跑，每帧都会把 normalized 骨骼的
   *    quaternion 写回动画里的值，这里摆的姿势下一帧就被覆盖，看起来「点了没反应」。
   * 2. 写 `getNormalizedBoneNode()` 而不是 `rawBoneNode`。normalized 骨骼的旋转是
   *    相对 T-pose 的增量、轴向与模型无关（加载器开了 autoUpdateHumanBones，
   *    `vrm.update()` 每帧把它回写到 raw 骨骼）。raw 骨骼的局部轴由各模型自己决定，
   *    写死数字换个模型就完全不是那个姿势了。
   *
   * 过渡用欧拉角分量插值（0.4s，smoothstep），在 `update(delta)` 里推进。
   */
  public applyPosture(preset: PosturePreset) {
    // 没有骨骼数据（面板上的「待机」）等于恢复：骨骼归零 + 重新播 idle
    if (!preset.bones && !preset.hipsPosition) {
      this.clearPosture();
      return;
    }

    this._motionController.stopMotion();

    const restRotation = this._toNodeRotation(REST_ROTATION);
    const targets = new Map<VRMHumanBoneName, PostureBoneRotation>();

    // 受管骨骼全部写一遍：preset 里没写的归零，这样从「坐下」切到「站立」腿会自己站直
    POSTURE_BONE_NAMES.forEach((boneName) => {
      const rotation = preset.bones?.[boneName];
      targets.set(boneName, rotation ? this._toNodeRotation(rotation) : restRotation);
    });

    const hipsTarget = preset.hipsPosition
      ? this._getHipsTarget(preset.hipsPosition)
      : this._hipsRestPosition.clone();

    this._currentPostureId = preset.id;
    this._startPostureTransition(targets, hipsTarget);
  }

  /**
   * 清除姿势：所有受管骨骼回到 0 旋转、髋部回到静止位置，然后重新播放 idle。
   * 先解完过渡再播 idle，避免姿势和 idle 第一帧直接硬切。
   */
  public clearPosture() {
    this._motionController.stopMotion();

    const restRotation = this._toNodeRotation(REST_ROTATION);
    const targets = new Map<VRMHumanBoneName, PostureBoneRotation>();
    POSTURE_BONE_NAMES.forEach((boneName) => {
      targets.set(boneName, restRotation);
    });

    this._currentPostureId = undefined;
    this._startPostureTransition(targets, this._hipsRestPosition.clone(), () => {
      this._motionController.playMotion(MotionPresetName.Idle, true);
    });
  }

  /**
   * 把预设里的欧拉角换成要写进 normalized 骨骼节点的值。
   *
   * 预设写在「面向 +Z、左手在 +X」的 VRM 1.0 约定里。本项目的模型都是 VRM 0.x：
   * 在 glTF 里它们朝 -Z、左手在 -X，`loadVRM` 里的 `VRMUtils.rotateVRM0` 只是把
   * 整个 scene 绕 Y 转了 180°，normalized 骨骼的坐标系也跟着转过去了。
   * 所以同一份数据要按 180° 绕 Y 共轭一次：(x, y, z) -> (-x, y, -z)。
   * 项目里把 VRMA / Mixamo 动作套到 normalized 骨骼时也是这么翻的，
   * 见 `VRMAnimation.createHumanoidTracks` 里 metaVersion === '0' 的分支。
   */
  private _toNodeRotation(rotation: PostureBoneRotation): PostureBoneRotation {
    if (!this._isVRM0) return { ...rotation };
    return { x: -rotation.x, y: rotation.y, z: -rotation.z };
  }

  /** 髋部目标位置：静止位置 + 按模型髋高缩放过的重心偏移 */
  private _getHipsTarget(offset: [number, number, number]): THREE.Vector3 {
    const restY = this._hipsRestPosition.y;
    const scale = restY > 0.2 ? restY / POSTURE_REFERENCE_HIP_HEIGHT : 1;
    // 位置也在模型的坐标系里，VRM 0.x 同样要翻 x / z
    const flip = this._isVRM0 ? -1 : 1;

    return new THREE.Vector3(
      this._hipsRestPosition.x + offset[0] * scale * flip,
      this._hipsRestPosition.y + offset[1] * scale,
      this._hipsRestPosition.z + offset[2] * scale * flip,
    );
  }

  /** 从当前骨骼状态出发，创建一段到目标的过渡 */
  private _startPostureTransition(
    targets: Map<VRMHumanBoneName, PostureBoneRotation>,
    hipsTarget?: THREE.Vector3,
    onComplete?: () => void,
  ) {
    const bones: PostureTransitionBone[] = [];

    targets.forEach((target, boneName) => {
      const node = this._vrm.humanoid.getNormalizedBoneNode(boneName);
      // 模型可能缺骨头（例如没有 upperChest），缺了就跳过
      if (!node) return;

      const from: PostureBoneRotation = {
        x: node.rotation.x,
        y: node.rotation.y,
        z: node.rotation.z,
      };

      bones.push({
        node,
        from,
        to: {
          x: from.x + shortestAngleDelta(from.x, target.x),
          y: from.y + shortestAngleDelta(from.y, target.y),
          z: from.z + shortestAngleDelta(from.z, target.z),
        },
      });
    });

    let hips: PostureTransition['hips'];
    const hipsNode = this._vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hipsNode && hipsTarget) {
      hips = { node: hipsNode, from: hipsNode.position.clone(), to: hipsTarget.clone() };
    }

    this._postureTransition = { elapsed: 0, bones, hips, onComplete };
  }

  /** 推进姿势过渡 */
  private _updatePosture(delta: number) {
    const transition = this._postureTransition;
    if (!transition) return;

    transition.elapsed = Math.min(transition.elapsed + delta, POSTURE_TRANSITION_DURATION);
    const progress = transition.elapsed / POSTURE_TRANSITION_DURATION;
    // smoothstep：起停软一点，不像纯 lerp 那么机械
    const k = progress * progress * (3 - 2 * progress);

    transition.bones.forEach(({ node, from, to }) => {
      node.rotation.set(
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k,
        from.z + (to.z - from.z) * k,
      );
    });

    if (transition.hips) {
      transition.hips.node.position.lerpVectors(transition.hips.from, transition.hips.to, k);
    }

    if (progress >= 1) {
      this._postureTransition = undefined;
      transition.onComplete?.();
    }
  }

  public update(delta: number) {
    // 姿势先写进 normalized 骨骼，再由 motionController.update() 里的 vrm.update()
    // 把 normalized 姿态回写到 raw 骨骼
    this._updatePosture(delta);
    this._expressionController.update(delta);
    this._motionController.update(delta);
  }
}







