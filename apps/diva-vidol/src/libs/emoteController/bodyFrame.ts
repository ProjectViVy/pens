import type { VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { Vector3 } from 'three';

const tmpLeft = new Vector3();
const tmpRight = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * 身体坐标轴：右方向与前方（世界空间）。
 *
 * **不要读髋骨（或任何骨骼）的局部轴**。VRM0 与 VRM1 的模型在静止姿势里髋骨的朝向可以差 180°
 * ——VRoid 出品的 VRM0 与某些 VRM1 管线（比如从 Unity/Blender 转出来的）恰好相反。
 * 把髋骨局部 +X 当「身体侧向轴」、局部 +Z 当「前方」，在另一种规范上就得到反方向：
 *
 *   - 膝关节限位：正常屈膝被读成「反关节」，于是被掰直甚至掰到身后；
 *   - 足底 IK：极点落到身体后方，膝盖解成反关节。
 *
 * 两条大腿的**世界位置**是规范无关的：右腿减左腿就是角色的右方向，右方向叉上方向就是前方。
 * 只用相对位置，不碰骨骼旋转，所以模型静止朝向怎么歪都不影响。
 *
 * 成功时把结果写进传入的向量并返回 true；取不到骨骼（或两条腿在水平面上重合）时返回 false，
 * 让调用方自己决定回退。
 */
export function updateBodyFrame(vrm: VRM, right: Vector3, forward: Vector3): boolean {
  const humanoid = vrm.humanoid;
  const leftLeg = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperLeg);
  const rightLeg = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperLeg);
  if (!leftLeg || !rightLeg) return false;

  leftLeg.getWorldPosition(tmpLeft);
  rightLeg.getWorldPosition(tmpRight);
  right.copy(tmpRight).sub(tmpLeft);
  // 只取水平分量：弯腿、跨步时大腿会前后倾，竖直分量不该进侧向轴
  right.y = 0;
  if (right.lengthSq() < 1e-8) return false;
  right.normalize();

  forward.crossVectors(WORLD_UP, right).normalize();
  return true;
}
