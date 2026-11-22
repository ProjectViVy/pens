import { Mesh, MeshBasicMaterial, Object3D, RingGeometry, Vector3 } from 'three';

/**
 * 点击标记 —— 房间里一次点击的唯一视觉回执。
 *
 * Hanami 实测过的教训：7480 次点击里有 5343 次什么都没发生，也没说话；
 * 而拒绝其实 39 次里对 38 次（墙、桌面、地图外、人已经在走）。
 * 所以问题不在判定，在沉默 —— 点完没反应，用户读到的不是「不行」，是「坏了」。
 *
 * 于是两个标记，同一套视觉语言，只靠大小、颜色、时长区分：
 *   接受  主题强调色  17 → 27 cm  ≈0.6 s
 *   拒绝  同一环去饱和  10 → 13 cm  ≈0.34 s
 *
 * 不弹跳、不脉动、不响：环以满不透明度凭空出现（回执必须立刻），
 * 一边扩张一边淡出。
 */

export type ClickMarkKind = 'accept' | 'refuse';

interface Mark {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  bornAt: number;
  durationS: number;
  fromRadius: number;
  toRadius: number;
}

const ACCEPT = { durationS: 0.6, fromRadius: 0.17, toRadius: 0.27, color: 0x1677ff };
const REFUSE = { durationS: 0.34, fromRadius: 0.1, toRadius: 0.13, color: 0x8a8f98 };

/** 环的几何体半径固定为 1，实际大小靠 scale（省得每次重建几何） */
const RING_GEOMETRY = new RingGeometry(0.82, 1, 48);

export class ClickMarks {
  private marks: Mark[] = [];

  constructor(private parent: Object3D) {}

  public show(point: { x: number; z: number; y?: number }, kind: ClickMarkKind) {
    const spec = kind === 'accept' ? ACCEPT : REFUSE;
    const material = new MeshBasicMaterial({
      color: spec.color,
      depthWrite: false,
      opacity: 1,
      transparent: true,
    });
    const mesh = new Mesh(RING_GEOMETRY, material);
    mesh.rotation.x = -Math.PI / 2;
    // 稍微离地，免得和地板共面打架
    mesh.position.set(point.x, (point.y ?? 0) + 0.012, point.z);
    mesh.scale.setScalar(spec.fromRadius);
    mesh.renderOrder = 2;

    this.parent.add(mesh);
    this.marks.push({
      mesh,
      bornAt: performance.now() / 1000,
      durationS: spec.durationS,
      fromRadius: spec.fromRadius,
      toRadius: spec.toRadius,
    });
  }

  public update(now: number) {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mark = this.marks[i];
      const age = now - mark.bornAt;
      const t = age / mark.durationS;

      if (t >= 1) {
        this.parent.remove(mark.mesh);
        mark.mesh.material.dispose();
        this.marks.splice(i, 1);
        continue;
      }

      // 扩张用 easeOut，透明度直接线性落到底
      const eased = 1 - (1 - t) * (1 - t);
      const radius = mark.fromRadius + (mark.toRadius - mark.fromRadius) * eased;
      mark.mesh.scale.setScalar(radius);
      mark.mesh.material.opacity = 1 - t;
    }
  }

  /** 环境更换/卸载时清干净 */
  public clear() {
    for (const mark of this.marks) {
      this.parent.remove(mark.mesh);
      mark.mesh.material.dispose();
    }
    this.marks = [];
  }
}

/** 落点处的地板高度：房间地面就是 y=0（.scene.json 的坐标系约定） */
export const FLOOR_Y = new Vector3(0, 0, 0).y;


