import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { Euler, MathUtils, Object3D, Quaternion, Vector3 } from 'three';

/**
 * 注视 —— 头和上半身朝目标转过去。
 *
 * lobe 原来的 `AutoLookAt` 只把 `vrm.lookAt.target` 挂到相机上，动的是**眼珠**
 * （VRMLookAtSmoother 自带扫视）。人转头看人靠的是脖子和上胸，所以这里在
 * mixer 之后、`vrm.update()` 之前，往 normalized 骨骼上叠加一层旋转。
 *
 * 叠加是「本帧算完就丢」的：每帧都从片段姿势重新叠，不累积，所以不会漂。
 * VRM 0.x 的 normalized 骨骼比 1.0 多转了 180°，髋部以上朝外看时转向要反号。
 */

/** 参与转头的骨骼，以及各自的权重与最大角度（度） */
const CHAINS: { bone: VRMHumanBoneName; maxDeg: number; weight: number }[] = [
  { bone: VRMHumanBoneName.UpperChest, maxDeg: 15, weight: 0.12 },
  { bone: VRMHumanBoneName.Neck, maxDeg: 30, weight: 0.26 },
  { bone: VRMHumanBoneName.Head, maxDeg: 36, weight: 0.37 },
];

/** 眼睛+脖子+上胸加起来最多转这么多（弧度，约 45°） */
const MAX_TURN_RAD = Math.PI / 4;

/** 平滑时间常数：越大越黏 */
const SMOOTH_TAU_S = 0.22;

export class StageGaze {
  private enabled = false;
  private target = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private sign: number;
  /**
   * 上一帧叠加之前这些骨骼的姿势。
   *
   * mixer 只写它**动画到的**骨骼；没被任何片段驱动的骨骼（上胸常常是）会留着我们
   * 上一帧写进去的值。所以每帧必须先撤回自己叠的那层，再让 mixer 写，最后重新叠，
   * 否则同一个角度会一帧一帧累加，脖子会自己拧成麻花。
   */
  private bases = new Map<VRMHumanBoneName, Quaternion>();

  constructor(
    private vrm: VRM,
    private camera: Object3D,
  ) {
    // VRM 0.x 的 normalized 骨骼朝向是镜像的
    this.sign = vrm.meta?.metaVersion === '0' ? -1 : 1;
  }

  /** 撤掉上一帧叠加的旋转（必须在 mixer.update 之前调用） */
  public restore() {
    for (const [bone, base] of this.bases) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone);
      if (node) node.quaternion.copy(base);
    }
  }

  /** 调试读数（联调看角度用） */
  public get debug() {
    return { pitch: this.pitch, sign: this.sign, yaw: this.yaw };
  }

  /** 看向一个世界坐标点 */
  public lookAt(point: Vector3) {
    this.target.copy(point);
    this.enabled = true;
  }

  /** 看回相机（默认行为：看镜头外的观众） */
  public lookAtCamera() {
    this.camera.getWorldPosition(this.target);
    this.enabled = true;
  }

  public disable() {
    this.enabled = false;
  }

  public update(delta: number) {
    const scene = this.vrm.scene;
    const head = this.vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (!head) return;

    const headWorld = head.getWorldPosition(new Vector3());
    const rootWorld = scene.getWorldPosition(new Vector3());

    let targetYaw = 0;
    let targetPitch = 0;
    if (this.enabled) {
      const dx = this.target.x - rootWorld.x;
      const dz = this.target.z - rootWorld.z;
      const flat = Math.hypot(dx, dz);
      // 归一到 ±180°，别让 atan2 的圈数混进来
      // 身体的世界朝向在外壳上（vrm.scene 里还留着 180° 朝向修正）
      const baseYaw = scene.parent?.rotation.y ?? scene.rotation.y;
      const wantYaw = Math.atan2(dx, dz) - baseYaw;
      targetYaw = this.sign * Math.atan2(Math.sin(wantYaw), Math.cos(wantYaw));
      if (flat > 0.05) {
        targetPitch = -Math.atan2(this.target.y - headWorld.y, flat);
      }
      // 背后的人不硬扭脖子，转一半就行
      const behind = Math.abs(targetYaw) > Math.PI / 2;
      if (behind) targetYaw *= 0.45;
      // 三层骨骼各自的角度是叠加的，总和才是肉眼看到的转角，所以先把目标收住
      targetYaw = MathUtils.clamp(targetYaw, -MAX_TURN_RAD, MAX_TURN_RAD);
    }

    const alpha = 1 - Math.exp(-delta / SMOOTH_TAU_S);
    this.yaw += (targetYaw - this.yaw) * alpha;
    this.pitch += (targetPitch - this.pitch) * alpha;

    if (Math.abs(this.yaw) < 0.004 && Math.abs(this.pitch) < 0.004) return;

    for (const { bone, maxDeg, weight } of CHAINS) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      const limit = MathUtils.degToRad(maxDeg);
      const yaw = MathUtils.clamp(this.yaw * weight, -limit, limit);
      const pitch = MathUtils.clamp(this.pitch * weight, -limit / 2, limit / 2);
      // 先记下这一帧的底，再在它之上叠加（底是 mixer 刚写出来的姿势）
      if (!this.bases.has(bone)) this.bases.set(bone, new Quaternion());
      this.bases.get(bone)!.copy(node.quaternion);
      node.quaternion.multiply(new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ')));
    }
  }
}



