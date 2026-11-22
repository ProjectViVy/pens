import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { Box3, Object3D, Vector3 } from 'three';

/**
 * 贴地 —— 让脚踩在房间地板上，而不是浮着或者陷进去。
 *
 * 动画片段是按**测量 rig 的髋高**做的，换到别的模型上，同一段待机会整体偏高或偏低
 * 几厘米；坐下、弯腰这些姿势里差异更大。Hanami 用完整的腿部 IK 逐条腿求解，这里
 * 先用更便宜也更稳的一招：整具模型沿 Y 平移，让**较低的那只脚**落在地面高度上。
 *
 * 局限要写清楚：它不解决「脚尖朝上/脚穿进地面」这类姿态问题，也不做左右腿分别求解
 * —— 走路时两条腿轮换支撑，不会各按各的。它解决的是最刺眼的那一件事：
 * 人悬在半空，或者半截小腿埋进地板。
 */

/** 每秒最多平移这么多米，避免地面修正把画面拽得一顿一顿 */
const MAX_SPEED = 3;
/** 单次最多修正这么多米；再多就说明是姿势问题，不是高度问题 */
const MAX_CORRECTION = 0.35;
/** 髋部高出座面的量：坐骨压在座面上，髋关节点在它上方一点 */
const HIP_ABOVE_SEAT = 0.075;

/** 坐着时如果要把人往下拽超过这个量，说明脚本来就是够不着地的（正常），就别拽 */
const SEATED_MAX_DROP = 0.15;

export class StageGround {
  public enabled = true;
  /** 地面高度（房间 sidecar 的 room.ground） */
  public groundY = 0;
  /** 是否坐着：坐着时改用「髋 → 座面」对齐，而不是脚 */
  public seated = false;
  /** 当前座位的座面高度（米），坐着时必须给 */
  public seatY?: number;

  private current = 0;
  private hips?: Object3D;
  private leftFoot?: Object3D;
  private rightFoot?: Object3D;
  private tmp = new Vector3();

  /**
   * 脚踝关节点到**鞋底**的竖直距离（米），量一次就固定。
   *
   * 之前这里直接把「较低的脚踝」对齐到地面，于是整个脚掌（从踝关节到鞋底那 6~8 厘米）
   * 全都埋进了地板——也就是「脚嵌进地面」。踝关节不在脚底上，得先量出这段落差。
   */
  private soleDrop = 0;
  private soleMeasured = false;

  constructor(private vrm: VRM) {
    this.hips = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? undefined;
    this.leftFoot = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftFoot) ?? undefined;
    this.rightFoot = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightFoot) ?? undefined;
  }

  /** 需要在 vrm.update() 之后调用（此时骨骼的世界矩阵才反映本帧姿势） */
  public update(delta: number) {
    if (!this.enabled) {
      // 交还给逐腿 IK 之前，先把自己之前压出来的位移收回去
      if (this.current !== 0) {
        this.current = 0;
        this.vrm.scene.position.y = 0;
      }
      return;
    }

    const scene = this.vrm.scene;
    scene.updateMatrixWorld(true);
    this.measureSole();

    // 正的 err = 偏高；负的 = 偏低
    let err: number;
    if (this.seated && this.hips && this.seatY != null) {
      // 坐着：按「髋高点落在座面之上一点点」对齐。按脚对齐是错的——
      // 座面比小腿短的时候脚本来就悬空，硬拽只会把人塞进椅子里。
      const hipsY = this.hips.getWorldPosition(this.tmp).y;
      err = hipsY - (this.seatY + HIP_ABOVE_SEAT);
    } else {
      if (!this.leftFoot || !this.rightFoot) return;
      const left = this.leftFoot.getWorldPosition(this.tmp).y;
      const right = this.rightFoot.getWorldPosition(this.tmp).y;
      const lowest = Math.min(left, right);
      // 正的 err = 悬空；负的 = 陷进地面。对齐的是**鞋底**，不是踝关节
      err = lowest - this.soleDrop - this.groundY;
      if (this.seated && err > SEATED_MAX_DROP) return;
    }
    err = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, err));

    const step = Math.max(-MAX_SPEED * delta, Math.min(MAX_SPEED * delta, err));
    // 目标 = 当前值减掉这次测到的误差；再按速度上限逼近
    const target = this.current - err;
    const deltaToTarget = target - this.current;
    this.current += Math.max(-step, Math.min(step, deltaToTarget));

    scene.position.y = this.current;
  }

  /** 换模型/换房间时归零 */
  public reset() {
    this.current = 0;
    this.soleDrop = 0;
    this.soleMeasured = false;
    if (this.vrm.scene) this.vrm.scene.position.y = 0;
  }

  /**
   * 量一次「踝关节 → 最低点」的竖直距离。
   *
   * 用整具模型的包围盒最低点当鞋底：只有在接近站立/走路时才量，量到明显不合理的值
   * （比如蹲着、坐着，或者包围盒被裙摆/头发拖低）就放弃，等下一帧再来。
   */
  private measureSole() {
    if (this.soleMeasured || !this.leftFoot || !this.rightFoot) return;
    const box = new Box3().setFromObject(this.vrm.scene);
    if (!Number.isFinite(box.min.y)) return;
    const lowestFoot = Math.min(
      this.leftFoot.getWorldPosition(new Vector3()).y,
      this.rightFoot.getWorldPosition(new Vector3()).y,
    );
    const drop = lowestFoot - box.min.y;
    // 人脚踝到鞋底 3~15 厘米；超出这个范围说明当前姿势不标准，下次再量
    if (drop > 0.02 && drop < 0.16) {
      this.soleDrop = drop;
      this.soleMeasured = true;
    }
  }
}




