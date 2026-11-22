import { VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * 姿势预设：纯程序化骨骼姿势，不依赖任何 vrma / fbx / vmd 素材文件。
 *
 * ## 坐标系约定
 *
 * 下面的角度写在 VRM 1.0 的 normalized humanoid 空间里（人物朝 +Z）：
 *
 * - `+Y` 向上、`+Z` 向前（人物面朝的方向）、`+X` 是人物自己的左边；
 * - 静止 T-pose 时 `leftUpperArm` 指向 +X、`rightUpperArm` 指向 -X、腿指向 -Y、
 *   脚指向 `(0, -0.5, 0.87)`（前下方，脚底贴地）；
 * - 所以上臂「平举」就是静止状态：左上臂绕 **Z 正方向**转是把手臂放下、
 *   绕 **Z 负方向**转是把手臂举起来；右上臂反过来（举手要绕 Z 负方向）。
 *   腿绕 **X 负方向**转是向前抬腿，小腿绕 **X 正方向**转是屈膝（脚跟往后）。
 *   手臂绕 **Y** 屈肘（肘关节的铰链轴跟着上臂一起转，T-pose 时它正好是 Y）。
 *
 * normalized 骨骼的旋转是「相对 T-pose 的增量」，跟模型自己的骨骼局部轴无关，
 * 所以同一份数字在不同 VRM 模型上朝向一致（只有比例差异）。写 rawBoneNode 做不到这点。
 *
 * > 本项目的 7 个模型都是 VRM 0.x（glTF 里朝 -Z、左手在 -X），
 * > `EmoteController.applyPosture` 会把这里的 (x, y, z) 按 180° 绕 Y 共轭成
 * > `(-x, y, -z)` 再写进 normalized 骨骼，见该方法的注释。
 *
 * 角度单位是弧度，通过 `Object3D.rotation.set(x, y, z)`（three.js 默认 XYZ 顺序）写入。
 * 每个姿势的注释里写了该姿势推导出来的肢体方向，方便渲染后对照微调。
 */

/** 单根骨骼的欧拉角（弧度），与 three.js 默认 XYZ 顺序一致 */
export interface PostureBoneRotation {
  x: number;
  y: number;
  z: number;
}

export interface PosturePreset {
  id: string;
  /** 中文 + 英文混排，直接显示在卡片上 */
  name: string;
  /** 只写需要摆的骨骼；没写的骨骼会归零 */
  bones?: Partial<Record<VRMHumanBoneName, PostureBoneRotation>>;
  /**
   * 髋部（重心）位移，单位米，[x, y, z]，按 0.9m 髋高的角色标定。
   * 坐下 / 蹲下要靠它把重心降下来，否则腿弯了但人还悬在半空。
   * 应用时会按模型自己的髋高等比缩放。
   */
  hipsPosition?: [number, number, number];
}

/**
 * 姿势会接管（并负责还原）的骨骼。
 *
 * 切换姿势时，在这个列表里但没出现在 preset.bones 中的骨骼会被插值回 0 旋转，
 * 所以从「坐下」切到「站立」时腿会自己站直。手指骨骼不在这里，保持模型的自然状态。
 */
export const POSTURE_BONE_NAMES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
];

export const posturePresetMap: Record<string, PosturePreset> = {
  /**
   * 待机（重置）：没有任何骨骼数据。
   * `applyPosture` 遇到空姿势会直接转成 `clearPosture()`：骨骼归零 + 重新播放 idle 动作，
   * 也就是面板上的「恢复」按钮。
   */
  idle: {
    id: 'idle',
    name: '待机 Idle',
  },

  /**
   * 站立：自然垂手站姿（静态，不会呼吸，和「待机」的区别就是待机会播 idle 动画）。
   * 上臂方向 (0.16, -0.99, 0.06)：几乎垂直向下，略微外展、略微向前；
   * 小臂再向前 10°（屈肘 0.18），脚尖外八 7°。
   */
  stand: {
    id: 'stand',
    name: '站立 Stand',
    bones: {
      [VRMHumanBoneName.LeftUpperArm]: { x: -0.062, y: 0.008, z: -1.409 },
      [VRMHumanBoneName.LeftLowerArm]: { x: 0, y: -0.181, z: 0 },
      [VRMHumanBoneName.RightUpperArm]: { x: -0.062, y: -0.008, z: 1.409 },
      [VRMHumanBoneName.RightLowerArm]: { x: 0, y: 0.181, z: 0 },
      [VRMHumanBoneName.LeftFoot]: { x: 0, y: 0.12, z: 0 },
      [VRMHumanBoneName.RightFoot]: { x: 0, y: -0.12, z: 0 },
    },
  },

  /**
   * 叉腰：肘向外、手落在腰上。
   * 上臂方向 (0.62, -0.78, 0.05)：外展约 38°，略向前；
   * 小臂方向 (-0.78, -0.55, 0.29)：向内下方、略向前，屈肘约 92°；
   * 手心朝后内侧（手背朝前），也就是手贴腰、指向前。
   * 上臂那两个分量（x 1.105 / y -0.86）主要是把肩关节旋内，让肘关节的弯折平面朝向腰部；
   * 单独只转 Z 是把手放下，但肘会弯到侧面去。
   */
  handsOnHips: {
    id: 'handsOnHips',
    name: '叉腰 Hands on hips',
    bones: {
      [VRMHumanBoneName.LeftUpperArm]: { x: 1.105, y: -0.86, z: -0.311 },
      [VRMHumanBoneName.LeftLowerArm]: { x: 0, y: -1.611, z: 0 },
      [VRMHumanBoneName.RightUpperArm]: { x: 1.105, y: 0.86, z: 0.311 },
      [VRMHumanBoneName.RightLowerArm]: { x: 0, y: 1.611, z: 0 },
      [VRMHumanBoneName.LeftFoot]: { x: 0, y: 0.1, z: 0 },
      [VRMHumanBoneName.RightFoot]: { x: 0, y: -0.1, z: 0 },
    },
  },

  /**
   * 抱胸：上臂垂在身前、肘贴着肋部，两条小臂在胸前交叠（左小臂在前、略高）。
   * 左上臂方向 (0.32, -0.87, 0.38)，左小臂方向 (-0.91, 0.22, 0.36)：屈肘约 110°；
   * 右上臂方向 (-0.34, -0.89, 0.30)，右小臂方向 (0.96, -0.05, 0.29)：屈肘约 101°。
   * 两侧小臂在 z 方向错开约 6cm，避免完全重合互相穿模。
   */
  armsCrossed: {
    id: 'armsCrossed',
    name: '抱胸 Arms crossed',
    bones: {
      [VRMHumanBoneName.Spine]: { x: -0.04, y: 0, z: 0 },
      [VRMHumanBoneName.LeftUpperArm]: { x: 0.212, y: -1.017, z: -0.913 },
      [VRMHumanBoneName.LeftLowerArm]: { x: 0, y: -1.925, z: 0 },
      [VRMHumanBoneName.RightUpperArm]: { x: 0.608, y: 1.133, z: 0.634 },
      [VRMHumanBoneName.RightLowerArm]: { x: 0, y: 1.766, z: 0 },
      [VRMHumanBoneName.LeftFoot]: { x: 0, y: 0.08, z: 0 },
      [VRMHumanBoneName.RightFoot]: { x: 0, y: -0.08, z: 0 },
    },
  },

  /**
   * 举手：右手举到头侧上方（掌心朝前），左手自然下垂，头微微抬起并侧向举起的手。
   * 右上臂方向 (-0.42, 0.88, 0.20)：抬高约 62°，略向外、略向前；
   * 右小臂方向 (-0.26, 0.92, 0.31)：再往上 11°，手在头顶右上方；
   * 掌法通过上臂旋内/旋外微调成掌心朝前（(0, 0, 1) 方向），像一个打招呼/举手的姿势。
   */
  raiseHand: {
    id: 'raiseHand',
    name: '举手 Raise hand',
    bones: {
      [VRMHumanBoneName.Head]: { x: -0.05, y: 0, z: 0.05 },
      [VRMHumanBoneName.LeftUpperArm]: { x: -0.062, y: 0.008, z: -1.409 },
      [VRMHumanBoneName.LeftLowerArm]: { x: 0, y: -0.181, z: 0 },
      [VRMHumanBoneName.RightUpperArm]: { x: -0.438, y: 0.922, z: -0.797 },
      [VRMHumanBoneName.RightLowerArm]: { x: 0, y: 0.2, z: 0 },
      [VRMHumanBoneName.LeftFoot]: { x: 0, y: 0.1, z: 0 },
      [VRMHumanBoneName.RightFoot]: { x: 0, y: -0.1, z: 0 },
    },
  },

  /**
   * 坐下：大腿前抬近水平、小腿前屈成 90°、脚掌压平，重心下移。
   * upperLeg = -1.45（大腿方向 (0, -0.12, 0.99)，几乎水平向前）；
   * lowerLeg = +1.40（小腿叠加后 -0.05，方向 (0, -1.0, 0.05)，几乎垂直向下）；
   * foot = +0.05：把小腿的旋转补回来，脚底保持水平（脚骨静止方向是 (0, -0.5, 0.87)）。
   * hipsPosition 的 y = -0.36 是按 0.9m 髋高算的：腿这样摆完，脚踝比站立时高约 0.35m，
   * 重心同步下降这么多，脚才还落在地面上（髋高 0.9 的模型算出来 0.356，取 -0.36）。
   * z = -0.12 是把髋部往后挪一点，看起来像往后靠坐着。
   * 姿态本身没有椅子，所以是「坐在看不见的凳子上」的悬空坐姿。
   */
  sit: {
    id: 'sit',
    name: '坐下 Sit',
    hipsPosition: [0, -0.36, -0.12],
    bones: {
      [VRMHumanBoneName.Spine]: { x: -0.06, y: 0, z: 0 },
      [VRMHumanBoneName.LeftUpperArm]: { x: -0.23, y: -0.382, z: -1.353 },
      [VRMHumanBoneName.LeftLowerArm]: { x: 0, y: -0.255, z: 0 },
      [VRMHumanBoneName.RightUpperArm]: { x: -0.23, y: 0.382, z: 1.353 },
      [VRMHumanBoneName.RightLowerArm]: { x: 0, y: 0.255, z: 0 },
      [VRMHumanBoneName.LeftUpperLeg]: { x: -1.45, y: 0, z: 0 },
      [VRMHumanBoneName.LeftLowerLeg]: { x: 1.4, y: 0, z: 0 },
      [VRMHumanBoneName.LeftFoot]: { x: 0.05, y: 0, z: 0 },
      [VRMHumanBoneName.RightUpperLeg]: { x: -1.45, y: 0, z: 0 },
      [VRMHumanBoneName.RightLowerLeg]: { x: 1.4, y: 0, z: 0 },
      [VRMHumanBoneName.RightFoot]: { x: 0.05, y: 0, z: 0 },
    },
  },

  /**
   * 蹲下：深蹲，脚掌压平、上身前倾、双手向前伸维持平衡。
   * upperLeg = -1.30（大腿方向 (0, -0.27, 0.96)，向前上方）；
   * lowerLeg = +2.05（小腿叠加后 +0.75，方向 (0, -0.73, -0.68)，向后下方，膝盖超过脚尖）；
   * foot = -0.75：把大腿 + 小腿的 +0.75 抵消掉，脚掌保持水平贴地；
   * 上身前倾 spine +0.28 / chest +0.10，脖子再回抬 -0.18 让人看前面；
   * hipsPosition y = -0.43（同样是 0.9m 髋高的标定值，按模型髋高等比缩放）；
   * 手臂向前伸（上臂方向 (0.25, -0.72, 0.65)、小臂 (0.14, -0.20, 0.97)）。
   */
  squat: {
    id: 'squat',
    name: '蹲下 Squat',
    hipsPosition: [0, -0.43, 0],
    bones: {
      [VRMHumanBoneName.Spine]: { x: 0.28, y: 0, z: 0 },
      [VRMHumanBoneName.Chest]: { x: 0.1, y: 0, z: 0 },
      [VRMHumanBoneName.Neck]: { x: -0.18, y: 0, z: 0 },
      [VRMHumanBoneName.LeftUpperArm]: { x: -0.707, y: -0.105, z: -1.317 },
      [VRMHumanBoneName.LeftLowerArm]: { x: 0, y: -0.63, z: 0 },
      [VRMHumanBoneName.RightUpperArm]: { x: -0.707, y: 0.105, z: 1.317 },
      [VRMHumanBoneName.RightLowerArm]: { x: 0, y: 0.63, z: 0 },
      [VRMHumanBoneName.LeftUpperLeg]: { x: -1.3, y: 0, z: 0 },
      [VRMHumanBoneName.LeftLowerLeg]: { x: 2.05, y: 0, z: 0 },
      [VRMHumanBoneName.LeftFoot]: { x: -0.75, y: 0, z: 0 },
      [VRMHumanBoneName.RightUpperLeg]: { x: -1.3, y: 0, z: 0 },
      [VRMHumanBoneName.RightLowerLeg]: { x: 2.05, y: 0, z: 0 },
      [VRMHumanBoneName.RightFoot]: { x: -0.75, y: 0, z: 0 },
    },
  },
};

/** 面板里按 Object.values 的顺序展示：待机 / 站立 / 叉腰 / 抱胸 / 举手 / 坐下 / 蹲下 */
export const posturePresets: PosturePreset[] = Object.values(posturePresetMap);
