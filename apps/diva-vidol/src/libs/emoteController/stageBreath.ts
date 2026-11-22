import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { MathUtils, Quaternion, Euler } from 'three';

/**
 * 呼吸 —— 站着的静止画面里唯一真正的「活着」信号。
 *
 * Hanami 的 idle 层是「底 + 偏移」：每帧先撤掉自己上一帧加的偏移，让 mixer 写片段
 * 姿势，再叠回来。不这么做的话，没被片段驱动的骨骼会一帧一帧累加，人会慢慢变形。
 *
 * 幅度刻意小：胸口 0.9°、脖子反向 0.5°，周期 3.6 秒（0.28 Hz，安静坐着的成年人
 * 呼吸频率）。看得见的是肩膀和胸口在动，说不出是哪里在动，这就对了。
 */

const BREATH_HZ = 0.28;
const CHEST_DEG = 0.9;
const NECK_DEG = -0.5;

const BONES = [VRMHumanBoneName.Chest, VRMHumanBoneName.Neck] as const;

export class StageBreath {
  private t = 0;
  private bases = new Map<VRMHumanBoneName, Quaternion>();

  constructor(private vrm: VRM) {}

  /** 撤掉上一帧的偏移（在 mixer.update 之前） */
  public restore() {
    for (const [bone, base] of this.bases) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone);
      if (node) node.quaternion.copy(base);
    }
  }

  public update(delta: number) {
    this.t += delta;
    const phase = Math.sin(this.t * Math.PI * 2 * BREATH_HZ);

    for (const bone of BONES) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      const deg = bone === VRMHumanBoneName.Chest ? CHEST_DEG : NECK_DEG;
      if (!this.bases.has(bone)) this.bases.set(bone, new Quaternion());
      this.bases.get(bone)!.copy(node.quaternion);
      const rad = MathUtils.degToRad(deg) * phase;
      node.quaternion.multiply(new Quaternion().setFromEuler(new Euler(rad, 0, 0, 'YXZ')));
    }
  }
}
