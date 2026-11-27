import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

import { updateBodyFrame } from './bodyFrame';

/**
 * 逐腿足底贴地（两骨 IK）。
 *
 * 上一版只做了整具模型上下平移：取两只脚里更低的那只，把人整体挪到地板上。
 * 结果是**总有一只脚是浮的**——待机姿势里两条腿的高度本来就不一样，平移救不了。
 * 这里补上 Hanami `legIk.ts` 的骨架部分：每条腿单独解，把脚踝拉到地面高度。
 *
 * 两骨 IK 的做法（大腿 L1、小腿 L2）：
 *   1. 目标脚踝 T、髋 A，按余弦定理算膝盖该落在哪；
 *   2. 膝盖方向用**当前膝盖在轴上的投影**当极点向量，这样膝盖还是朝原来的方向弯，
 *      不会被解到反关节去；
 *   3. 大腿先转，小腿再转，都是世界空间里的「把这段骨头转到目标方向」。
 *
 * 不做的部分（写在这里免得被当成做了）：脚掌朝向的完整对齐、脚趾、地面法线
 * （斜坡）、坐下时的腿部求解。现在是**把脚踝拉到地面高度**这一件事。
 */

/** 脚踝骨骼离鞋底大约多高（米），按 1.6 m 身高估 */
const ANKLE_HEIGHT = 0.075;
/** 目标离髋太远/太近时把解夹住，避免膝盖反折或完全伸直抖动 */
const MIN_REACH = 0.02;
/** 每帧最多修正多少米。IK 每帧都从片段姿势重算，不会累积，所以可以一次到位 */
const MAX_STEP = 0.3;

interface LegChain {
  upper: NonNullable<ReturnType<VRM['humanoid']['getNormalizedBoneNode']>>;
  lower: NonNullable<ReturnType<VRM['humanoid']['getNormalizedBoneNode']>>;
  foot: NonNullable<ReturnType<VRM['humanoid']['getNormalizedBoneNode']>>;
}

export class StageLegIk {
  /** 只在站着不动的时候开：走路时脚该由片段驱动，硬拽会跟步态打架 */
  public enabled = false;
  /** 走路时改成只防穿地，不拽悬空的脚（那是摆动相，拽下来就是拖脚） */
  public penetrationOnly = false;
  /** 地面高度（房间数据） */
  public groundY = 0;

  private legs: LegChain[] = [];
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpC = new Vector3();
  private tmpT = new Vector3();
  private tmpDir = new Vector3();
  private tmpPerp = new Vector3();
  private tmpKnee = new Vector3();
  private quatA = new Quaternion();
  private quatB = new Quaternion();
  private matrix = new Matrix4();
  /** 身体右方向 / 前方（每帧由 bodyFrame 从两条大腿的位置算） */
  private bodyRight = new Vector3();
  private bodyForward = new Vector3();

  constructor(private vrm: VRM) {
    const upperL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperLeg);
    const lowerL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerLeg);
    const footL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftFoot);
    const upperR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperLeg);
    const lowerR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerLeg);
    const footR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightFoot);

    if (upperL && lowerL && footL) this.legs.push({ upper: upperL, lower: lowerL, foot: footL });
    if (upperR && lowerR && footR) this.legs.push({ upper: upperR, lower: lowerR, foot: footR });
  }

  /**
   * 需要在 mixer.update 之后、vrm.update 之前调用。
   * 它会读骨骼世界坐标，所以调用前场景矩阵必须是最新的一帧。
   */
  public update() {
    if (!this.enabled || this.legs.length === 0) return;

    this.vrm.scene.updateMatrixWorld(true);

    for (const leg of this.legs) {
      const hip = leg.upper.getWorldPosition(this.tmpA);
      const knee = leg.lower.getWorldPosition(this.tmpB);
      const ankle = leg.foot.getWorldPosition(this.tmpC);

      const l1 = hip.distanceTo(knee);
      const l2 = knee.distanceTo(ankle);
      if (l1 < 1e-4 || l2 < 1e-4) continue;

      // 目标：脚踝拉到地面高度；水平位置保持不动（不改变她的站姿）
      const target = this.tmpT.set(ankle.x, this.groundY + ANKLE_HEIGHT, ankle.z);

      const toTarget = target.clone().sub(hip);
      const rawDist = toTarget.length();
      if (rawDist < 1e-5) continue;

      // 坐着的时候髋比站着高，地板可能根本够不到——够不到就别解，
      // 让片段自己摆（腿自然垂着），硬解会把两条腿拉成笔直。
      if (rawDist > l1 + l2 - MIN_REACH - 0.02) continue;

      const reach = Math.min(Math.max(rawDist, Math.abs(l1 - l2) + MIN_REACH), l1 + l2 - MIN_REACH);
      const dist = Math.min(rawDist, reach);
      // 一次别修太多
      // 只处理「还悬在半空」的那只脚。低于目标的脚不动——那说明髋已经偏低，
      // 该由整体平移去抬，硬拽会把腿扯直。
      const above = ankle.y - target.y;
      if (this.penetrationOnly) {
        // 走路时：片段负责抬脚，只处理「脚穿到地板下面」这一种错误。
        // 悬空的脚是摆动相，拽下来就变成拖脚。
        if (above > -0.005) continue;
      } else if (above < 0.01) {
        continue;
      }
      const limited = Math.min(MAX_STEP, Math.abs(above));
      const wanted = target.clone();
      wanted.y = ankle.y - Math.sign(above) * limited;

      const dir = this.tmpDir.copy(wanted).sub(hip).normalize();

      // 膝盖只往身体前方弯。极点向量用**身体朝向**，不用「当前膝盖在哪」：
      // 一旦片段（或之前的 IK）把膝盖摆到身体后方，拿当前膝盖当极点会顺着把
      // 它推得更后，越解越反关节。
      //
      // 「前方」由两条大腿的世界位置算出来（bodyFrame.ts），不读髋骨局部轴：
      // VRM0 与 VRM1 的髋骨静止朝向可能差 180°，读局部轴会让导入的 VRM1 人物
      // 膝盖解到身后去（实测正角在 VRM0 上是反关节、在 VRM1 上却是正常屈膝）。
      const axis = dir;
      if (!updateBodyFrame(this.vrm, this.bodyRight, this.tmpPerp)) this.tmpPerp.set(0, 0, 1);
      this.tmpPerp.addScaledVector(axis, -this.tmpPerp.dot(axis));
      if (this.tmpPerp.lengthSq() < 1e-8) this.tmpPerp.set(0, 0, 1);
      this.tmpPerp.normalize();

      // 余弦定理：膝盖在轴上的投影长度 h1 和高度 hh
      const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
      const hSq = l1 * l1 - a * a;
      const hh = hSq > 0 ? Math.sqrt(hSq) : 0;
      const kneeTarget = this.tmpKnee
        .copy(hip)
        .addScaledVector(dir, a)
        .addScaledVector(this.tmpPerp, hh);

      // 1) 大腿：把「髋→当前膝盖」转到「髋→目标膝盖」
      const fromDir = knee.clone().sub(hip).normalize();
      const toDir = kneeTarget.clone().sub(hip).normalize();
      this.quatA.setFromUnitVectors(fromDir, toDir);
      this.applyWorldRotation(leg.upper, this.quatA);

      // 2) 小腿：重算当前膝盖位置，再把「膝→脚踝」转到「目标膝→目标脚踝」
      this.vrm.scene.updateMatrixWorld(true);
      const kneeNow = leg.lower.getWorldPosition(new Vector3());
      const ankleNow = leg.foot.getWorldPosition(new Vector3());
      const fromShin = ankleNow.clone().sub(kneeNow).normalize();
      const toShin = wanted.clone().sub(kneeTarget).normalize();
      this.quatB.setFromUnitVectors(fromShin, toShin);
      this.applyWorldRotation(leg.lower, this.quatB);
    }
  }

  /** 把世界空间的旋转套到骨骼上（骨骼的 quaternion 是父空间里的） */
  private applyWorldRotation(
    bone: NonNullable<ReturnType<VRM['humanoid']['getNormalizedBoneNode']>>,
    worldDelta: Quaternion,
  ) {
    const parent = bone.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const parentWorld = new Quaternion();
    parent.getWorldQuaternion(parentWorld);
    const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
    bone.quaternion.premultiply(localDelta).normalize();
    void this.matrix;
    void Euler;
  }
}

