import type { VRM } from '@pixiv/three-vrm';
import { Quaternion, Vector3 } from 'three';

/**
 * 手指的静息姿势。
 *
 * VRM 加载进来手指是**完全伸直**的：每节指骨都是单位四元数，看着像橱窗假人的手。
 * 而最常看的那几个片段（`idle`、`world-walk`、`world-sit-idle*`）里没有任何手指轨道，
 * 所以这个状态会一直挂着。
 *
 * Hanami 的做法是在建 mixer **之前**把静息姿势写进骨架：three 在第一次激活某个动作时
 * 会把当时的骨骼值当「原值」缓存下来，没有任何轨道驱动的骨头就一直保持；片段的轨道
 * 权重满时覆盖它；淡入淡出期间按权重补回来。零每帧开销，而且有手指轨道的片段自然赢。
 * 这里照这个思路做。
 *
 * 弯曲方向不靠猜：把每节骨头朝两个方向各转一次，哪个让指尖离掌心更近就用哪个。
 * 转轴用「骨头指向 × 手掌法线」，手掌法线由手腕到食指根 / 小指根叉乘得到——这样
 * 换成朝下、朝里或者其他手型的模型也不会解到反方向。
 */
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;
const SEGMENTS = ['Proximal', 'Intermediate', 'Distal'] as const;
const THUMB_SEGMENTS = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'] as const;

/** 每节指骨的弯曲角（弧度）：近节最大，越到指尖越小，像自然放松的手 */
const CURL: Record<string, number> = {
  Proximal: 0.62,
  Intermediate: 0.78,
  Distal: 0.42,
  ThumbMetacarpal: 0.08,
  ThumbProximal: 0.18,
  ThumbDistal: 0.22,
};

interface BoneLike {
  quaternion: Quaternion;
  parent: { getWorldQuaternion: (t: Quaternion) => Quaternion; children: BoneLike[] } | null;
  children: BoneLike[];
  getWorldPosition: (t: Vector3) => Vector3;
}

export class StageHands {
  constructor(private vrm: VRM) {}

  /** 必须在任何动作开始播放之前调用（mixer 缓存原值的那一刻） */
  public applyRestPose() {
    // 联调开关：?nohands=1 关掉，用来做前后对照
    if (window.location.search.includes('nohands')) return;
    this.vrm.scene.updateMatrixWorld(true);

    for (const side of ['left', 'right'] as const) {
      const hand = this.vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);
      if (!hand) continue;
      const handPos = hand.getWorldPosition(new Vector3());
      // 手掌法线整个手只算一次：用「掌心 → 食指根」和「掌心 → 小指根」叉乘。
      // 每节指骨自己算的话，父节点只是上一节骨头，叉出来的方向全是垃圾（上一版就是这个错）。
      const palmNormal = this.palmNormalOf(side, handPos);

      const targets: Array<[string, number]> = [];
      for (const finger of FINGERS) {
        for (const segment of SEGMENTS) {
          targets.push([`${side}${finger}${segment}`, CURL[segment] ?? 0.3]);
        }
      }
      for (const name of THUMB_SEGMENTS) {
        targets.push([`${side}${name}`, CURL[name] ?? 0.15]);
      }

      for (const [boneName, angle] of targets) {
        const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName as never) as
          | BoneLike
          | null
          | undefined;
        if (!bone || bone.children.length === 0) continue;

        const axis = palmNormal ? this.flexionAxis(bone, handPos, palmNormal) : null;
        if (!axis) continue;

        const before = bone.quaternion.clone();
        const tipBefore = this.tipDistance(bone, handPos);

        // 世界空间的轴换成父空间的轴：bone.quaternion 是在父空间里解释的
        const parentWorld = new Quaternion();
        bone.parent?.getWorldQuaternion(parentWorld);
        const localAxis = axis.clone().applyQuaternion(parentWorld.clone().invert()).normalize();

        let best: Quaternion | null = null;
        let bestDist = tipBefore;

        for (const sign of [1, -1]) {
          const q = before
            .clone()
            .multiply(new Quaternion().setFromAxisAngle(localAxis, angle * sign));
          bone.quaternion.copy(q);
          this.vrm.scene.updateMatrixWorld(true);
          const dist = this.tipDistance(bone, handPos);
          if (dist < bestDist - 1e-5) {
            bestDist = dist;
            best = q.clone();
          }
        }

        bone.quaternion.copy(best ?? before);
        this.vrm.scene.updateMatrixWorld(true);
      }
    }
  }

  private tipDistance(bone: BoneLike, handPos: Vector3) {
    let node: BoneLike = bone;
    let guard = 0;
    while (node.children.length > 0 && guard < 6) {
      node = node.children[0];
      guard += 1;
    }
    return node.getWorldPosition(new Vector3()).distanceTo(handPos);
  }

  /** 手掌法线：掌心 → 食指根 与 掌心 → 小指根 的叉乘（世界空间） */
  private palmNormalOf(side: 'left' | 'right', handPos: Vector3): Vector3 | null {
    const indexRoot = this.vrm.humanoid.getNormalizedBoneNode(`${side}IndexProximal` as never) as BoneLike | null;
    const pinkyRoot = this.vrm.humanoid.getNormalizedBoneNode(`${side}LittleProximal` as never) as BoneLike | null;

    if (!indexRoot || !pinkyRoot) return null;

    const a = new Vector3().subVectors(indexRoot.getWorldPosition(new Vector3()), handPos);
    const b = new Vector3().subVectors(pinkyRoot.getWorldPosition(new Vector3()), handPos);
    const normal = new Vector3().crossVectors(a, b);
    return normal.lengthSq() < 1e-8 ? null : normal.normalize();
  }

  /** 屈曲轴：骨头指向 × 手掌法线（世界空间、已归一化） */
  private flexionAxis(bone: BoneLike, handPos: Vector3, palmNormal: Vector3): Vector3 | null {
    const fingerDir = new Vector3().subVectors(bone.getWorldPosition(new Vector3()), handPos);
    if (fingerDir.lengthSq() < 1e-8) return null;
    const axis = new Vector3().crossVectors(fingerDir.normalize(), palmNormal);
    return axis.lengthSq() < 1e-8 ? null : axis.normalize();
  }
}


