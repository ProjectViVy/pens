import { VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { freezeStaticEnvironment, mergeStaticEnvironment } from './staticMerge';

export { freezeStaticEnvironment };
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 3D 房间（Hanami 环境素材）
 *
 * 一个房间 = 三个文件：
 *   `<id>.glb`        模型
 *   `<id>.json`       放置 sidecar（scale / rotationY / spawn / exposure），可缺
 *   `<id>.scene.json` 导入时量出来的房间数据（可行走网格、座位、地面高度），可缺
 *
 * `.scene.json` 的坐标系就是「放好之后」的场景坐标：原点在角色脚下（y=0），
 * 米为单位，+Y 向上，角色朝 +Z。所以里面的数字可以原样用。
 */

export interface EnvironmentSeat {
  id: string;
  /** 座面高度（米） */
  y: number;
  /** 座面中心 [x, z] */
  center: [number, number];
  bounds: [number, number, number, number];
  area: number;
  headroom: number;
  /** 坐下时角色的朝向（度） */
  yaw: number;
  back: boolean;
  approach?: [number, number] | null;
}

export interface EnvironmentGrid {
  /** 格边长（米） */
  cell: number;
  origin: [number, number];
  cols: number;
  rows: number;
  levels: string[];
  legend: string;
  /** 每行一个字符串；字符 '.' 无地板、'#' 有地板但被挡、'~' 够不着，其余为可走 */
  map: string[];
}

export interface EnvironmentScene {
  format: 'hanami-scene';
  version: number;
  placement: { scale: number; rotationY: number | null; spawn: [number, number, number] };
  frame?: { units: string; up: string; forward: string; origin: string };
  room: {
    modelBounds: number[];
    walkBounds: [number, number, number, number];
    walkArea: number;
    ground: number;
    ceiling: number;
  };
  body: { height: number; radius: number; step: number; seatRange: [number, number] };
  /**
   * 取景数据：`clearance` 是 16 个方向（每 22.5°）上从角色到墙的距离。
   * 只要镜头落在这个半径内，就保证进不了墙里——所以随便选哪个方向都安全。
   */
  camera?: { eye: number; clearance: number[] };
  grid: EnvironmentGrid;
  seats: EnvironmentSeat[];
}

export interface EnvironmentRoomMeta {
  id: string;
  label: string;
  glb: string;
  scene: string | null;
  placement: { scale: number; rotationY: number | null; spawn: number[] | null } | null;
  walkArea: number | null;
  seats: number;
  ceiling: number | null;
  sizeMB: number;
}

let manifestCache: Promise<EnvironmentRoomMeta[]> | null = null;

/**
 * 房间中文名
 *
 * 清单里 `label` 是导入时从素材抄来的英文原名（"Anime Classroom"），
 * 但界面是中文的，直接把英文塞进菜单会很突兀。这里补一层映射，
 * 认不出的房间退回原名，不会因为加了新房间就显示空白。
 */
const ROOM_LABEL_ZH: Record<string, string> = {
  'anime-classroom': '动漫教室',
  'apartment-floorplan': '公寓户型',
  'cozy-loft-room': '温馨阁楼',
  'japanese-classroom': '日本教室',
  'lowpoly-restaurant': '低多边形餐厅',
  'rustic-bedroom': '乡村卧室',
  'small-cafe': '小咖啡馆',
};

export function roomLabel(room: { id: string; label: string }): string {
  return ROOM_LABEL_ZH[room.id] ?? room.label;
}


export function loadEnvironmentManifest(): Promise<EnvironmentRoomMeta[]> {
  if (!manifestCache) {
    manifestCache = fetch('/environments/manifest.json')
      .then((res) => {
        if (!res.ok) throw new Error(`房间清单加载失败: ${res.status}`);
        return res.json();
      })
      .then((data: { rooms: EnvironmentRoomMeta[] }) => data.rooms)
      .catch((error) => {
        manifestCache = null;
        throw error;
      });
  }
  return manifestCache;
}

export async function loadEnvironmentScene(url?: string | null): Promise<EnvironmentScene | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as EnvironmentScene;
  } catch {
    return null;
  }
}

const gltfLoader = new GLTFLoader();

/** 载入房间模型并应用 sidecar 的缩放与朝向 */
export async function loadEnvironmentModel(
  url: string,
  placement?: { scale?: number; rotationY?: number | null } | null,
): Promise<THREE.Group> {
  const gltf = await gltfLoader.loadAsync(url);
  const root = new THREE.Group();
  root.name = 'environment';
  root.add(gltf.scene);

  const scale = placement?.scale ?? 1;
  if (scale !== 1) root.scale.setScalar(scale);
  if (placement?.rotationY) root.rotation.y = THREE.MathUtils.degToRad(placement.rotationY);

  // 房间是静态的：先按材质把能合的合掉，再统一设标志位。
  // 合并在摆位之前做（几何体烘焙到 root 局部空间），冻结要等摆位之后。
  // ?dev=1&nomerge=1 关掉合并，做前后对照用（怀疑合并改坏法线/拾取时一眼能看出来）。
  const search = window.location.search;
  const skipMerge = search.includes('dev=1') && search.includes('nomerge=1');
  const mergeStats = skipMerge
    ? { sources: 0, groups: 0, skipped: 0 }
    : mergeStaticEnvironment(root);

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    }
  });

  root.userData.mergeStats = mergeStats;

  return root;
}

/**
 * 这一格能不能走。
 *
 * legend：'.' 无地板、'#' 有地板但被挡、'~' 够不着，其余字符是 `levels` 的下标，
 * 表示「有地板、没有障碍、走得到」。
 */
export function isWalkable(scene: EnvironmentScene, x: number, z: number): boolean {
  const { grid } = scene;
  const col = Math.floor((x - grid.origin[0]) / grid.cell);
  const row = Math.floor((z - grid.origin[1]) / grid.cell);
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return false;
  const line = grid.map[row];
  if (!line) return false;
  const ch = line[col];
  return ch !== undefined && ch !== '.' && ch !== '#' && ch !== '~' && ch !== ' ';
}

/**
 * 把房间摆到角色脚下。
 *
 * 这是 `.scene.json` 的坐标契约：**动的是房间，不是角色**。
 * 数据集里的网格、座位、相机 clearance 都是「房间已摆好、原点在角色脚下」的
 * 场景坐标，所以只要把房间按 `-spawn` 平移、把地面抬到 y=0，角色留在原点，
 * 那些数字就能直接用，不用再换算坐标系。
 */
export function alignEnvironment(root: THREE.Object3D, spawn: [number, number, number] | null): void {
  const box = new THREE.Box3().setFromObject(root);
  const [sx, sy, sz] = spawn ?? [0, 0, 0];
  root.position.set(-sx, -(box.min.y + sy), -sz);
  root.updateMatrixWorld(true);
}

/** 离目标最近的可走格中心；找不到就返回 undefined */
export function nearestWalkable(
  scene: EnvironmentScene,
  x: number,
  z: number,
  maxRadius = 1.2,
): { x: number; z: number } | undefined {
  if (isWalkable(scene, x, z)) return { x, z };
  const { grid } = scene;
  let best: { x: number; z: number } | undefined;
  let bestDist = maxRadius;
  const ring = Math.ceil(maxRadius / grid.cell);
  const col = Math.floor((x - grid.origin[0]) / grid.cell);
  const row = Math.floor((z - grid.origin[1]) / grid.cell);

  for (let dr = -ring; dr <= ring; dr++) {
    for (let dc = -ring; dc <= ring; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue;
      const cx = grid.origin[0] + (c + 0.5) * grid.cell;
      const cz = grid.origin[1] + (r + 0.5) * grid.cell;
      if (!isWalkable(scene, cx, cz)) continue;
      const dist = Math.hypot(cx - x, cz - z);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: cx, z: cz };
      }
    }
  }
  return best;
}

/**
 * 从 (sx,sz) 走到 (gx,gz) 的格子路径（8 邻域 BFS，不抄墙角）。
 *
 * 返回的是**世界坐标**的路点（不含起点），终点是传进来的落点。
 * 走不到就返回 undefined——宁可不动，也不要穿墙。
 */
export function findPath(
  scene: EnvironmentScene,
  sx: number,
  sz: number,
  gx: number,
  gz: number,
): { x: number; z: number }[] | undefined {
  const { grid } = scene;
  const toCell = (x: number, z: number) => ({
    col: Math.floor((x - grid.origin[0]) / grid.cell),
    row: Math.floor((z - grid.origin[1]) / grid.cell),
  });
  const cellX = (col: number) => grid.origin[0] + (col + 0.5) * grid.cell;
  const cellZ = (row: number) => grid.origin[1] + (row + 0.5) * grid.cell;
  const walkableCell = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < grid.cols && row < grid.rows &&
    isWalkable(scene, cellX(col), cellZ(row));

  const start = toCell(sx, sz);
  const goal = toCell(gx, gz);
  if (!walkableCell(goal.col, goal.row)) return undefined;
  if (start.col === goal.col && start.row === goal.row) return [{ x: gx, z: gz }];

  const key = (col: number, row: number) => row * grid.cols + col;
  const startKey = key(start.col, start.row);
  const goalKey = key(goal.col, goal.row);

  const cameFrom = new Map<number, number>();
  const seen = new Set<number>([startKey]);
  const queue: number[] = [startKey];
  let found = false;

  const neighbours = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ] as const;

  for (let head = 0; head < queue.length && !found; head++) {
    const current = queue[head];
    const col = current % grid.cols;
    const row = Math.floor(current / grid.cols);

    for (const [dc, dr] of neighbours) {
      const nc = col + dc;
      const nr = row + dr;
      if (!walkableCell(nc, nr)) continue;
      // 斜着走要求两条直边都通，避免从桌角穿过去
      if (dc !== 0 && dr !== 0 && (!walkableCell(col + dc, row) || !walkableCell(col, row + dr))) {
        continue;
      }
      const nk = key(nc, nr);
      if (seen.has(nk)) continue;
      seen.add(nk);
      cameFrom.set(nk, current);
      if (nk === goalKey) {
        found = true;
        break;
      }
      queue.push(nk);
    }
  }

  if (!found) return undefined;

  const cells: number[] = [goalKey];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const previous = cameFrom.get(cursor);
    if (previous === undefined) return undefined;
    cells.push(previous);
    cursor = previous;
  }
  cells.reverse();

  // 起点不出路点，终点换成真实落点
  const points = cells.slice(1).map((cell) => ({
    x: cellX(cell % grid.cols),
    z: cellZ(Math.floor(cell / grid.cols)),
  }));
  if (points.length > 0) points[points.length - 1] = { x: gx, z: gz };
  return points;
}

/** 把角色放到房间的出生点（.scene.json 的 placement.spawn 就是脚下位置） */
export function spawnPointOf(
  scene: EnvironmentScene | null,
  fallbackPlacement?: { spawn?: number[] | null } | null,
): THREE.Vector3 {
  const spawn = scene?.placement?.spawn ?? (fallbackPlacement?.spawn as number[] | undefined);
  if (spawn && spawn.length === 3) return new THREE.Vector3(spawn[0], spawn[1], spawn[2]);
  return new THREE.Vector3(0, 0, 0);
}

/** 角色的髋高（米）：世界坐标 y 就是髋高，用来把片段里的分数换算成米 */
export function hipsHeightOf(vrm?: { humanoid: { getNormalizedBoneNode: (b: VRMHumanBoneName) => THREE.Object3D | null } } | null): number {
  const hips = vrm?.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
  if (!hips) return 1;
  return hips.getWorldPosition(new THREE.Vector3()).y || 1;
}

