import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 静态场景合并（对应 Hanami 的 `envMerge`）。
 *
 * 一个房间加载进来是几十上百个各自独立的 mesh：日本教室 62 套桌椅、
 * 公寓平面图 28 个功能块，每个 mesh 一次 draw call。房间**摆好之后再也不动**，
 * 所以按材质把能合的合掉，并把矩阵冻住——省的是每帧的绘制调用和矩阵遍历。
 *
 * 三个明确的**不合**（合了会出错，不是因为麻烦才跳过）：
 *   - 半透明材质（玻璃、窗帘、瓶子）：合进一个 mesh 后深度排序从「逐个排」
 *     变成「整块一起排」，透明的东西会前后乱穿；
 *   - 多材质 mesh（用了 groups）：合并不保留材质分组；
 *   - 世界矩阵行列式为负（镜像）：烘焙进去会把面法线翻过来。
 *
 * 蒙皮/形变网格也跳过——那是会动的，冻住它就是把它钉死。
 */

/** 合并结果的统计，给联调看 */
export interface MergeStats {
  /** 被合并掉的原始 mesh 数 */
  sources: number;
  /** 合并后产生的 mesh 数 */
  groups: number;
  /** 因为透明/多材质/镜像/蒙皮被跳过的 mesh 数 */
  skipped: number;
}

function signatureOf(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort();
  const itemSizes = names.map((name) => geometry.attributes[name].itemSize);
  const interleaved = names.some(
    (name) =>
      (geometry.attributes[name] as { isInterleavedBufferAttribute?: boolean })
        .isInterleavedBufferAttribute === true,
  );
  return JSON.stringify({ names, itemSizes, interleaved });
}

export function mergeStaticEnvironment(root: THREE.Object3D): MergeStats {
  const stats: MergeStats = { sources: 0, groups: 0, skipped: 0 };

  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  /** 材质 uuid + 属性签名 → 待合并的几何体（已烘焙到 root 局部空间） */
  const buckets = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();
  const consumed: THREE.Object3D[] = [];

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    if ((object as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length) {
      stats.skipped += 1;
      return;
    }
    if (Array.isArray(mesh.material) || !mesh.material || mesh.material.transparent) {
      stats.skipped += 1;
      return;
    }

    const world = mesh.matrixWorld.clone();
    if (world.determinant() < 0) {
      stats.skipped += 1;
      return;
    }

    const geometry = mesh.geometry.clone();
    // 烘焙到 root 的局部空间：合出来的 mesh 挂在 root 下，矩阵就是单位阵
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, world));

    const key = `${mesh.material.uuid}|${signatureOf(geometry)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.geometries.push(geometry);
    else buckets.set(key, { material: mesh.material, geometries: [geometry] });

    stats.sources += 1;
    consumed.push(mesh);
  });

  for (const mesh of consumed) mesh.parent?.remove(mesh);

  for (const { material, geometries } of buckets.values()) {
    const merged = mergeGeometries(geometries, false);
    if (!merged) {
      for (const geometry of geometries) geometry.dispose();
      stats.skipped += geometries.length;
      continue;
    }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.frustumCulled = false;
    root.add(mesh);
    for (const geometry of geometries) geometry.dispose();
    stats.groups += 1;
  }

  return stats;
}

/**
 * 冻结矩阵。必须**在摆位之后**调用：`alignEnvironment` 还要改 group 的 position，
 * 冻早了那次摆位就不生效。
 */
export function freezeStaticEnvironment(root: THREE.Object3D) {
  root.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });
  root.updateMatrixWorld(true);
}
