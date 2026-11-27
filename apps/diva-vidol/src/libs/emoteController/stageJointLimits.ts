import type { VRM } from '@pixiv/three-vrm';
import { Quaternion, Vector3 } from 'three';

import { updateBodyFrame } from './bodyFrame';

/**
 * 膝关节限位（Hanami `jointLimits` 在我们这套骨架上的可用子集）。
 *
 * 走过的两条错路，写在这里免得下次再走：
 *
 * 1. 只掐「骨骼局部四元数绕 X 的扭转角」不行。四元数拆 twist 在 swing 大的时候
 *    会退化，实测给出 +120° 这种不存在的读数；而且 twist 角被夹住了，几何上
 *    膝盖照样能折到反方向——两者不是一回事。
 * 2. 拿「身体的侧向轴」当肘的铰链轴也不行：手臂在 A 姿下沿 X 展开，肘的屈伸
 *    根本不绕 X，那个量测的是前臂旋前。
 *
 * 所以这里从**几何**下手：算出髋→膝→踝在铰链平面内的真实夹角，只有真正折到
 * 反方向时才把小腿掰回边界，其余情况一个字节都不动。
 *
 * 铰链轴用髋骨世界坐标系的 X 轴：腿朝下，膝屈伸确实绕它转（坐姿实测 ≈ −90°）。
 * 只做腿，手臂留着——见上面第 2 条。
 */

/** 允许的自然超伸（度）。真人的膝能过伸几度，但不能更多 */
const KNEE_EXT_MAX_DEG = 3;
/** 反向也留个极限，免得片段给出超过人体的折叠 */
const KNEE_FLEX_MAX_DEG = 150;

/**
 * 肘的铰链轴：**上臂局部坐标系的 Y 轴**。
 *
 * 这一条不是猜的：同目录 `posturePresets.ts` 里「站立」预设用
 * `LeftLowerArm: { y: -0.181 }` / `RightLowerArm: { y: +0.181 }` 表达「小臂再向前 10°」，
 * 也就是屈肘就是绕 Y 转、左右符号相反。手臂在 A 姿下沿 X 展开，所以不能拿全身的
 * 侧向轴（X）当肘轴——那量的是前臂旋前，这一点老代码里已经踩过。
 */
const ELBOW_AXIS_LOCAL = new Vector3(0, 1, 0);
/** 肘允许的自然超伸（度） */
const ELBOW_EXT_MAX_DEG = 3;
/** 肘最大屈曲（度） */
const ELBOW_FLEX_MAX_DEG = 150;

const DEG = Math.PI / 180;

export class StageJointLimits {
  private vrm?: VRM;
  /** 关掉限位（联调 A/B 用） */
  public enabled = true;
  /** 联调用：每帧把两只膝盖强行掰成这个角度（正 = 反关节），验证限位在动 */
  public forceKneeDeg = 0;
  /** 联调用：每帧把两只肘强行掰成这个角度（正 = 屈肘），验证限位在动 */
  public forceElbowDeg = 0;
  /** 本帧被掰回来的关节数 */
  public clamped = 0;
  /** 本帧被掰回来的肘数 */
  public clampedArms = 0;
  /** 本帧几何角（度），联调看数值；NaN = 这一帧没算出可信值 */
  public angles: number[] = [];
  /** 本帧两只肘的屈曲角（度），正 = 屈；NaN = 这一帧没算出可信值 */
  public elbowAngles: number[] = [];

  private hip = new Vector3();
  private knee = new Vector3();
  private ankle = new Vector3();
  private axisWorld = new Vector3();
  private u = new Vector3();
  private v = new Vector3();
  private uPlane = new Vector3();
  private vPlane = new Vector3();
  private cross = new Vector3();
  private target = new Vector3();
  private qWorld = new Quaternion();
  private qParent = new Quaternion();
  private qParentInv = new Quaternion();
  /** 身体右方向 / 前方，每帧由 bodyFrame 从两条大腿的位置算出来 */
  private bodyRight = new Vector3();
  private bodyForward = new Vector3();
  private qLocal = new Quaternion();

  constructor(vrm: VRM) {
    this.vrm = vrm;
  }

  /** 铰链角（度）：正 = 往反关节方向折 */
  private hingeAngle(): number {
    // 去掉沿铰链轴的分量，只留平面内的姿态
    this.u.copy(this.knee).sub(this.hip).normalize();
    this.v.copy(this.ankle).sub(this.knee).normalize();
    this.uPlane.copy(this.u).addScaledVector(this.axisWorld, -this.u.dot(this.axisWorld));
    this.vPlane.copy(this.v).addScaledVector(this.axisWorld, -this.v.dot(this.axisWorld));
    if (this.uPlane.lengthSq() < 1e-8 || this.vPlane.lengthSq() < 1e-8) return Number.NaN;
    this.uPlane.normalize();
    this.vPlane.normalize();
    this.cross.crossVectors(this.uPlane, this.vPlane);
    return Math.atan2(this.cross.dot(this.axisWorld), this.uPlane.dot(this.vPlane)) / DEG;
  }

  /**
   * 弯曲平面是否和髋骨的额状面一致。
   *
   * 腿绕 X 弯的时候，大腿和小腿都在垂直于 X 的平面里，两者叉积必然平行于 X——
   * 这是「这一帧的弯曲确实绕铰链轴」的判据。反过来，坐姿里右腿膝盖稍微外撇时，
   * 叉积会歪到别的方向，这时候算出来的正负号没有解剖意义（实测一只腿 −89°、
   * 另一只 +101°，而两条腿明明都是正常弯曲）。不一致就直接跳过，不动骨骼。
   */
  private planeIsFrontal(): boolean {
    this.cross.crossVectors(this.u, this.v);
    if (this.cross.lengthSq() < 1e-10) return false;
    this.cross.normalize();
    return Math.abs(this.cross.dot(this.axisWorld)) > 0.9;
  }

  public apply() {
    const vrm = this.vrm;
    const humanoid = vrm?.humanoid;
    if (!humanoid) return;

    this.clamped = 0;
    this.angles.length = 0;

    // 铰链轴取「身体的右方向」，由两条大腿的世界位置算出来（见 bodyFrame.ts）：
    // 不能再用髋骨局部 X——VRM0 与 VRM1 的髋骨静止朝向可能差 180°，那样会在其中一种规范上
    // 把正常屈膝读成反关节，膝盖就被限位掰到身后去了。
    if (!updateBodyFrame(vrm, this.bodyRight, this.bodyForward)) return;
    this.axisWorld.copy(this.bodyRight);

    for (const side of ['left', 'right'] as const) {
      const upper = humanoid.getNormalizedBoneNode(`${side}UpperLeg` as never);
      const lower = humanoid.getNormalizedBoneNode(`${side}LowerLeg` as never);
      const foot = humanoid.getNormalizedBoneNode(`${side}Foot` as never);
      if (!upper || !lower || !foot) continue;

      if (this.forceKneeDeg !== 0) {
        this.qLocal.setFromAxisAngle(new Vector3(1, 0, 0), this.forceKneeDeg * DEG);
        lower.quaternion.copy(this.qLocal);
      }

      // 改姿势之前先让世界矩阵跟上，否则量到的是上一帧
      upper.updateWorldMatrix(true, false);
      lower.updateWorldMatrix(true, false);

      upper.getWorldPosition(this.hip);
      lower.getWorldPosition(this.knee);
      foot.getWorldPosition(this.ankle);

      const angle = this.hingeAngle();
      this.angles.push(angle);
      if (!Number.isFinite(angle)) continue;
      if (!this.enabled) continue;
      if (!this.planeIsFrontal()) continue;
      if (angle <= KNEE_EXT_MAX_DEG && angle >= -KNEE_FLEX_MAX_DEG) continue;

      // 要把小腿掰到边界上：绕铰链轴把 v 转到 allowed 方向
      const allowed = Math.min(KNEE_EXT_MAX_DEG, Math.max(-KNEE_FLEX_MAX_DEG, angle)) * DEG;
      this.target.copy(this.v.applyAxisAngle(this.axisWorld, allowed - angle * DEG));

      this.qWorld.setFromUnitVectors(this.v.copy(this.ankle).sub(this.knee).normalize(), this.target);

      const parent = lower.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(this.qParent);
      this.qParentInv.copy(this.qParent).invert();
      // 世界空间的旋转搬到父空间的局部旋转上
      const delta = this.qParentInv
        .clone()
        .multiply(this.qWorld)
        .multiply(this.qParent);
      lower.quaternion.premultiply(delta);
      lower.updateWorldMatrix(true, false);

      this.clamped += 1;
    }

    this.applyElbows(humanoid);
  }

  /**
   * 肘限位。做法和膝一致（几何夹角 + 绕铰链轴掰回去），只是铰链轴取上臂局部 Y。
   *
   * 屈曲正负：左肘屈 = 几何角为负，右肘屈 = 几何角为正（推导见 ELBOW_AXIS_LOCAL 的注释）。
   * 所以统一换成「屈曲角 flex」再判边界：flex ∈ [−3°, 150°]。
   */
  private applyElbows(humanoid: VRM['humanoid']) {
    this.clampedArms = 0;
    this.elbowAngles.length = 0;

    for (const side of ['left', 'right'] as const) {
      const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm` as never);
      const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm` as never);
      const hand = humanoid.getNormalizedBoneNode(`${side}Hand` as never);
      if (!upper || !lower || !hand) continue;

      if (this.forceElbowDeg !== 0) {
        this.qLocal.setFromAxisAngle(ELBOW_AXIS_LOCAL, this.forceElbowDeg * DEG);
        lower.quaternion.copy(this.qLocal);
      }

      upper.updateWorldMatrix(true, false);
      lower.updateWorldMatrix(true, false);

      upper.getWorldPosition(this.hip);
      lower.getWorldPosition(this.knee);
      hand.getWorldPosition(this.ankle);

      // 铰链轴 = 上臂局部 Y 在世界空间里的方向
      this.axisWorld.copy(ELBOW_AXIS_LOCAL).applyQuaternion(
        upper.getWorldQuaternion(new Quaternion()),
      );
      this.axisWorld.normalize();

      const raw = this.hingeAngle();
      const sign = side === 'left' ? -1 : 1;
      const flex = sign * raw;
      this.elbowAngles.push(flex);
      if (!Number.isFinite(flex)) continue;
      if (!this.enabled) continue;
      // flex 正 = 屈。合法区间 [−3°（轻微超伸）, +150°（最大屈曲）]。
      // 别把膝那套「正 = 反关节」的区间照抄过来——那会让正常屈肘全被当成越界
      // （实测过：待机时 14°/16° 的轻微屈肘被判越界，两只肘一直在被掰）。
      if (flex >= -ELBOW_EXT_MAX_DEG && flex <= ELBOW_FLEX_MAX_DEG) continue;
      const clampedFlex = Math.max(-ELBOW_EXT_MAX_DEG, Math.min(ELBOW_FLEX_MAX_DEG, flex));
      const allowed = sign * clampedFlex;
      this.target.copy(this.v.applyAxisAngle(this.axisWorld, (allowed - raw) * DEG));
      this.qWorld.setFromUnitVectors(
        this.v.copy(this.ankle).sub(this.knee).normalize(),
        this.target,
      );

      const parent = lower.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(this.qParent);
      this.qParentInv.copy(this.qParent).invert();
      const delta = this.qParentInv.clone().multiply(this.qWorld).multiply(this.qParent);
      lower.quaternion.premultiply(delta);
      lower.updateWorldMatrix(true, false);

      this.clampedArms += 1;
    }
  }
}
