import {
  VRM,
  VRMExpressionPresetName,
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { GLTFLoader, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { VRMLookAtSmootherLoaderPlugin } from '@/libs/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmootherLoaderPlugin';
import { EmoteController } from '@/libs/emoteController/emoteController';
import { StageHands } from '@/libs/emoteController/stageHands';
import { LipSync } from '@/libs/lipSync/lipSync';
import { Screenplay, TouchAreaEnum } from '@/types/touch';

import { IDLE_MOTION_URL, MotionPresetName } from '../emoteController/motionPresetMap';
import { posturePresetMap } from '../emoteController/posturePresets';
import { MotionFileType } from '../emoteController/type';

/**
 * 3Dキャラクターを管理するクラス
 */
export class Model {
  public vrm?: VRM | null;
  /** 走位用的外壳：模型套在里面，只负责位置与朝向 */
  public navRoot: THREE.Object3D | null = null;
  public emoteController?: EmoteController;
  public speaking: boolean = false; // 是否正在说话

  private _lookAtTargetParent: THREE.Object3D;
  private _lipSync?: LipSync;
  private _headHitbox?: THREE.Mesh;
  private _headHitboxSize: THREE.Vector3 = new THREE.Vector3(0.2, 0.25, 0.2);
  private _raycaster: THREE.Raycaster;

  constructor(lookAtTargetParent: THREE.Object3D) {
    this._lookAtTargetParent = lookAtTargetParent;
    this._lipSync = new LipSync(new AudioContext());
    this._raycaster = new THREE.Raycaster();
  }

  public async loadVRM(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';

    loader.register(
      (parser: GLTFParser) =>
        new VRMLoaderPlugin(parser, {
          lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
          autoUpdateHumanBones: true,
        }),
    );
    const gltf = await loader.loadAsync(url);

    // 提升性能
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);

    const vrm = (this.vrm = gltf.userData.vrm);
    vrm.scene.name = 'VRMRoot';

    VRMUtils.rotateVRM0(vrm);

    // 朝向只在这里统一一次：VRM0 靠 rotateVRM0 转到「脸朝 +Z」，VRM1 的模型按规范本来就是
    // 「脸朝 +Z」，所以到这里两种规范都是 +Z，不能再动。
    //
    // 以前这里还无条件写了一次 vrm.scene.rotation.y = Math.PI：
    // 对 VRM0 只是把 rotateVRM0 刚设的同一个值再赋一遍（无害），
    // 对 VRM1 却等于多转 180°——导入的 VRM1 人物背对镜头，走位看着也成了倒着走。
    // 外壳只管走位与转身，不掺朝向修正。
    const root = new THREE.Object3D();
    root.name = 'ModelRoot';
    root.add(vrm.scene);
    this.navRoot = root;

    // 手指静息姿势必须写在任何动作播放之前：mixer 会把那一刻的骨骼值当作原值缓存。
    // idle / world-walk / world-sit-idle 这些最常看的片段都没有手指轨道。
    new StageHands(vrm).applyRestPose();

    this.emoteController = new EmoteController(vrm, this._lookAtTargetParent);

    // 在这里调用 createHeadHitbox
    this.createHeadHitbox();
  }

  public unLoadVrm() {
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
  }

  public async playMotionUrl(fileType: MotionFileType, url: string, loop: boolean = true) {
    this.emoteController?.playMotionUrl(fileType, url, loop);
  }

  /**
   * 视线：不传点就看回镜头，传了点就看那个位置。
   * 转的是脖子和头（StageGaze 在 mixer 之后叠加），不是只动眼珠。
   */
  public lookAt(point?: { x: number; y?: number; z: number }) {
    const gaze = this.emoteController?.gaze;
    if (!gaze) return;
    if (point) {
      gaze.lookAt(new Vector3(point.x, point.y ?? 1.2, point.z));
      return;
    }
    gaze.lookAtCamera();
  }

  /** 房间地面高度（贴地层对齐用） */
  public setGroundY(y: number) {
    if (this.emoteController?.ground) this.emoteController.ground.groundY = y;
    if (this.emoteController?.legIk) this.emoteController.legIk.groundY = y;
  }

  /** 站着不动的时候打开逐腿 IK（走路/坐着时关掉，脚该由片段驱动） */
  /**
   * 足底 IK 的开关。
   *
   * walking=true 时切成「只防穿地」：走路片段的摆动相本来就把脚抬起来了，
   * 那时把脚拽回地面会变成拖脚。站着不动时才做完整解。
   */
  public setFootPlanting(enabled: boolean, walking = false) {
    const legIk = this.emoteController?.legIk;
    if (!legIk) return;
    // 走位期间整条腿一条都不解。
    // 以前是「走路时只防穿地」（penetrationOnly）：只要摆动腿的脚在某一帧落到地面以下，
    // IK 就把整条腿掰到够得着地面——实测大腿被掰到离竖直 106°（越过水平线、朝后甩），
    // 小腿却还是垂直向下，看上去就是马的后腿，也就是「半人马」。
    // 走路片段自己的落脚高度本来就是对的，地面又是平的（贴在 room.ground 上），不需要 IK 兜底。
    legIk.enabled = enabled && !walking;
    legIk.penetrationOnly = false;
  }

  /** 坐着的时候，贴地只做极轻微修正（脚可能本来就够不着地） */
  public setSeated(seated: boolean, seatY?: number) {
    const ground = this.emoteController?.ground;
    if (!ground) return;
    ground.seated = seated;
    ground.seatY = seated ? seatY : undefined;
  }

  /** 一次性动作是否正在播（待机轮换用） */
  public get isOneShotPlaying() {
    return Boolean(this.emoteController?.isOneShotPlaying);
  }

  /** 模型的静止髋高（米）：动作片段的时间/速度是按髋高归一的，换算真实速度要用它 */
  public hipsHeight(): number {
    const rest = this.vrm?.humanoid.normalizedRestPose?.hips?.position;
    return rest?.[1] ?? 0;
  }

  public async loadIdleAnimation() {
    // 一次性动作播完自动回到这个片段（Hanami 的 Overte 待机，不再是占位）
    this.emoteController?.setIdleUrl(IDLE_MOTION_URL);
    // 走位途中不许抢片段。模型/房间加载完成、触摸反应结束都会调到这里，
    // 而它们经常正好落在一次走位中间——硬切 idle 的结果就是「人还在往前滑、
    // 姿态却是站着不动」（实测 [clip] idle 紧跟在 world-walk 之后）。
    if (this.emoteController?.isWalkHeld) return;
    this.emoteController?.playEmotion(VRMExpressionPresetName.Neutral);
    this.emoteController?.playMotion(MotionPresetName.Idle, true);
  }

  /**
   * 语音播放，配合人物表情动作
   * @param buffer
   * @param screenplay
   */
  public async speak(buffer: ArrayBuffer, screenplay: Screenplay) {
    this.speaking = true;
    // 播放人物表情
    this.emoteController?.playEmotion(screenplay.expression);
    // 播放人物动作
    if (screenplay.motion) this.emoteController?.playMotion(screenplay.motion);
    // 唇形同步
    await new Promise((resolve) => {
      this._lipSync?.playFromArrayBuffer(buffer, () => {
        resolve(true);
      });
    });
    this.speaking = false;
  }

  /**
   * 无声表演：只播表情与动作，不需要音频
   *
   * 拆线后本地环境没有可用的语音合成（edge TTS 的 WebSocket 连不上），
   * 触摸反应退化成纯表情/动作。
   */
  public playScreenplay(screenplay: Pick<Screenplay, 'expression' | 'motion'>) {
    this.emoteController?.playEmotion(screenplay.expression);
    if (screenplay.motion) this.emoteController?.playMotion(screenplay.motion);
  }

  /**
   * 停止语音
   */
  public stopSpeak() {
    this.speaking = false;
    this._lipSync?.stopPlay();
    this.emoteController?.playEmotion('neutral');
  }

  public update(delta: number): void {
    if (this._lipSync) {
      const { volume } = this._lipSync.update();
      this.emoteController?.lipSync('aa', volume);
    }
    // 更新表情动作
    this.emoteController?.update(delta);
    // 更新头部点击区域
    this.updateHeadHitbox();
  }

  public async preloadMotion(motion: MotionPresetName) {
    await this.emoteController?.preloadMotion(motion);
  }
  public async preloadAllMotions(onLoad?: (loaded: number, total: number) => void) {
    const motions = Object.values(MotionPresetName);
    let loaded = 0;
    const total = motions.length;
    for (const motion of motions) {
      await this.preloadMotion(motion);
      loaded++;
      onLoad?.(loaded, total);
    }
  }

  public async preloadMotionUrl(fileType: MotionFileType, url: string) {
    await this.emoteController?.preloadMotionUrl(fileType, url);
  }

  /**
   * 应用一个静态姿势预设（纯程序化骨骼姿势，不依赖素材文件）
   *
   * @param id `posturePresetMap` 里的预设 id，例如 `handsOnHips` / `sit`
   */
  public applyPosture(id: string) {
    const preset = posturePresetMap[id];

    if (!preset) {
      console.warn(`未知的姿势预设: ${id}`);
      return;
    }

    this.emoteController?.applyPosture(preset);
  }

  /** 清除姿势：骨骼归零并回到待机 idle */
  public clearPosture() {
    this.emoteController?.clearPosture();
  }

  /** 当前生效的静态姿势 id，姿势面板用它恢复卡片高亮 */
  public get currentPostureId(): string | undefined {
    return this.emoteController?.currentPostureId;
  }

  public createHeadHitbox() {
    if (!this.vrm) return;

    const headBone = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (!headBone) return;

    const geometry = new THREE.BoxGeometry(
      this._headHitboxSize.x,
      this._headHitboxSize.y,
      this._headHitboxSize.z,
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      visible: false,
    });
    this._headHitbox = new THREE.Mesh(geometry, material);

    headBone.add(this._headHitbox);

    this._headHitbox.position.set(0, this._headHitboxSize.y * 0.3, 0);
  }

  public updateHeadHitbox() {
    if (!this.vrm || !this._headHitbox) return;

    const headBone = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (!headBone) return;

    const scale = new THREE.Vector3();
    headBone.getWorldScale(scale);
    this._headHitbox.scale.copy(scale);
  }

  public getHeadHitbox(): THREE.Mesh | undefined {
    return this._headHitbox;
  }

  public getClosestBone(point: THREE.Vector3): VRMHumanBoneName | null {
    if (!this.vrm) return null;

    let closestBone: VRMHumanBoneName | null = null;
    let closestWeightedDistance = Infinity;

    const mainBones: VRMHumanBoneName[] = [
      ...this.getHeadBones(),
      VRMHumanBoneName.UpperChest,
      VRMHumanBoneName.Chest,
      VRMHumanBoneName.Spine,
      VRMHumanBoneName.Hips,
      VRMHumanBoneName.LeftUpperArm,
      VRMHumanBoneName.LeftLowerArm,
      VRMHumanBoneName.LeftHand,
      VRMHumanBoneName.RightUpperArm,
      VRMHumanBoneName.RightLowerArm,
      VRMHumanBoneName.RightHand,
      VRMHumanBoneName.LeftUpperLeg,
      VRMHumanBoneName.LeftLowerLeg,
      VRMHumanBoneName.LeftFoot,
      VRMHumanBoneName.LeftToes,
      VRMHumanBoneName.RightUpperLeg,
      VRMHumanBoneName.RightLowerLeg,
      VRMHumanBoneName.RightFoot,
      VRMHumanBoneName.RightToes,
    ];

    const getBoneWeight = (boneName: VRMHumanBoneName): number => {
      switch (boneName) {
        case VRMHumanBoneName.Head:
        case VRMHumanBoneName.LeftEye:
        case VRMHumanBoneName.RightEye:
        case VRMHumanBoneName.Jaw:
          return 2; // 增加头部相关骨骼的权重
        case VRMHumanBoneName.Chest:
        case VRMHumanBoneName.UpperChest:
        case VRMHumanBoneName.Spine:
        case VRMHumanBoneName.Hips:
          return 1.5;
        case VRMHumanBoneName.LeftUpperLeg:
        case VRMHumanBoneName.RightUpperLeg:
        case VRMHumanBoneName.LeftUpperArm:
        case VRMHumanBoneName.RightUpperArm:
          return 1.2;
        default:
          return 1;
      }
    };

    mainBones.forEach((boneName) => {
      const boneData = this.vrm!.humanoid.getNormalizedBoneNode(boneName);
      if (boneData) {
        const boneWorldPosition = new THREE.Vector3();
        boneData.getWorldPosition(boneWorldPosition);
        const distance = point.distanceTo(boneWorldPosition);
        const weightedDistance = distance / getBoneWeight(boneName);

        if (weightedDistance < closestWeightedDistance) {
          closestWeightedDistance = weightedDistance;
          closestBone = boneName;
        }
      }
    });

    return closestBone;
  }

  /**
   * 骨骼 → 触摸区域。
   *
   * 划分是按「用户能指着说的部位」来的：头 / 上半身（chest）/ 肚子（spine）/
   * 手和手臂 / 腿 / 脚 / 臀部（hips）。脚以前并进腿里，点脚背和点小腿没区别；
   * 现在脚掌和脚趾单独算一个区域。
   */
  public mapBoneNameToTouchArea(boneName: VRMHumanBoneName): TouchAreaEnum | null {
    const headBones = this.getHeadBones();
    if (headBones.includes(boneName)) {
      return TouchAreaEnum.Head;
    }

    switch (boneName) {
      case VRMHumanBoneName.LeftUpperArm:
      case VRMHumanBoneName.LeftLowerArm:
      case VRMHumanBoneName.LeftHand:
      case VRMHumanBoneName.RightUpperArm:
      case VRMHumanBoneName.RightLowerArm:
      case VRMHumanBoneName.RightHand:
        return TouchAreaEnum.Arm;

      case VRMHumanBoneName.LeftUpperLeg:
      case VRMHumanBoneName.LeftLowerLeg:
      case VRMHumanBoneName.RightUpperLeg:
      case VRMHumanBoneName.RightLowerLeg:
        return TouchAreaEnum.Leg;

      case VRMHumanBoneName.LeftFoot:
      case VRMHumanBoneName.LeftToes:
      case VRMHumanBoneName.RightFoot:
      case VRMHumanBoneName.RightToes:
        return TouchAreaEnum.Foot;

      // upperChest 是「上半身」真正的骨，之前没映射，点锁骨一带什么都不触发
      case VRMHumanBoneName.UpperChest:
      case VRMHumanBoneName.Chest:
        return TouchAreaEnum.Chest;

      case VRMHumanBoneName.Spine:
        return TouchAreaEnum.Belly;

      case VRMHumanBoneName.Hips:
        return TouchAreaEnum.Buttocks;

      default:
        return null;
    }
  }

  private getHeadBones(): VRMHumanBoneName[] {
    return [
      VRMHumanBoneName.Head,
      VRMHumanBoneName.Neck,
      VRMHumanBoneName.LeftEye,
      VRMHumanBoneName.RightEye,
      VRMHumanBoneName.Jaw,
    ];
  }

  public handleRaycasterIntersection(
    mouse: THREE.Vector2,
    camera: THREE.Camera,
  ): THREE.Intersection[] | null {
    if (!this.vrm) {
      return null;
    }

    this._raycaster.setFromCamera(mouse, camera);

    return this._raycaster.intersectObject(this.vrm.scene, true);
  }

  public handleClick(intersects: THREE.Intersection[]): TouchAreaEnum | null {
    if (!intersects || intersects.length === 0) return null;

    // 检查是否点击了头部 hitbox
    const headHitboxIntersect = intersects.find(
      (intersect) => intersect.object === this._headHitbox,
    );
    if (headHitboxIntersect) {
      return this.mapBoneNameToTouchArea(VRMHumanBoneName.Head);
    }

    const intersectedPoint = intersects[0].point;
    const closestBone = this.getClosestBone(intersectedPoint);

    if (closestBone) {
      return this.mapBoneNameToTouchArea(closestBone);
    }

    return null;
  }

  // ... 其他现有的方法 ...
}










