import {
  Camera,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Vector2,
} from 'three';

/**
 * 座位箭头 —— 「这里能坐」的唯一回复。
 *
 * 点地面那套已经有一个环（ClickMarks），但它只回答「我收到了这一下」。
 * 这一件回答的是另一件事：**鼠标停在这个表面上，说明它是可以坐的**。
 * 所以它必须常驻、必须比环显眼，还要能被点中——用户是先看见箭头才决定点的。
 *
 * 视觉语言跟着点击环走（同一个强调色、同一套不透明度过场），只是形态换成朝下的箭头，
 * 悬在座面上方上下浮动，浮动幅度很小（±3 厘米），不做旋转、不做脉动。
 */

const ACCENT = 0x1677ff;
/** 箭头悬在座面上方这么高：矮一点才像「指着这个座面」，太高会飘到窗框上去 */
const HOVER_HEIGHT = 0.17;
/** 上下浮动的幅度与周期 */
const BOB = 0.015;
const BOB_PERIOD_S = 1.6;

/** 箭头本体：朝下的锥体 */
const CONE_GEOMETRY = new ConeGeometry(0.075, 0.17, 20);
/** 座面上的落点环，说明「会坐到这个圈里」 */
const RING_GEOMETRY = new RingGeometry(0.11, 0.13, 32);
/** 看不见的大号点击热区：箭头本身太细，按几何去点几乎点不中 */
const PAD_GEOMETRY = new SphereGeometry(0.16, 12, 8);

export interface ArrowTarget {
  id: string;
  /** 座面中心 */
  x: number;
  z: number;
  /** 座面高度（射线打到的真实表面） */
  y: number;
  /** 鼠标实际点到的位置：桌面是个大面，坐哪儿该以点的位置为准，不能靠包围盒去算 */
  px?: number;
  pz?: number;
}

export class HoverArrow {
  private group = new Group();
  private cone: Mesh<ConeGeometry, MeshBasicMaterial>;
  private ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private pad: Mesh<SphereGeometry, MeshBasicMaterial>;
  private raycaster = new Raycaster();

  /** 当前悬停的座位（点箭头时用它） */
  public target: ArrowTarget | null = null;

  constructor(private parent: Object3D) {
    this.cone = new Mesh(
      CONE_GEOMETRY,
      // depthTest 保持开着：穿透挡在前面的桌子/墙看起来像 UI 画错了地方
      new MeshBasicMaterial({ color: new Color(ACCENT), depthWrite: false }),
    );
    // ConeGeometry 默认尖朝上，转过来就是尖朝下
    this.cone.rotation.x = Math.PI;
    this.cone.renderOrder = 3;

    this.ring = new Mesh(
      RING_GEOMETRY,
      new MeshBasicMaterial({
        color: new Color(ACCENT),
        depthWrite: false,
        opacity: 0.85,
        transparent: true,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 2;

    // 完全透明但仍然参与射线：只负责把点击范围撑大
    this.pad = new Mesh(
      PAD_GEOMETRY,
      new MeshBasicMaterial({ color: new Color(ACCENT), depthWrite: false, opacity: 0, transparent: true }),
    );

    this.group.visible = false;
    this.group.add(this.cone, this.ring, this.pad);
    this.parent.add(this.group);
  }

  public show(target: ArrowTarget) {
    // 同一个座位就别重置动画了，否则鼠标抖一下箭头就跳一下
    if (this.target?.id === target.id && this.group.visible) return;
    this.target = target;
    this.group.position.set(target.x, target.y, target.z);
    this.group.visible = true;
  }

  public hide() {
    if (!this.group.visible && !this.target) return;
    this.group.visible = false;
    this.target = null;
  }

  public get visible() {
    return this.group.visible;
  }

  /** 箭头本体的世界坐标（联调时要把屏幕坐标算出来，好用真的点击通路验命中） */
  public get anchor(): { x: number; y: number; z: number } | null {
    if (!this.target) return null;
    return { x: this.target.x, y: this.target.y + HOVER_HEIGHT, z: this.target.z };
  }

  public update(now: number) {
    if (!this.group.visible) return;
    // 箭头上下浮动，环贴着座面不动
    const phase = (now / BOB_PERIOD_S) * Math.PI * 2;
    this.cone.position.y = HOVER_HEIGHT + Math.sin(phase) * BOB;
    this.pad.position.y = HOVER_HEIGHT;
    this.ring.position.y = 0.012;
  }

  /** 箭头的屏幕命中：点它就算点座位，不要掉到地板上变成走位 */
  public hit(mouse: Vector2, camera: Camera) {
    if (!this.group.visible) return false;
    this.raycaster.setFromCamera(mouse, camera);
    return this.raycaster.intersectObjects([this.cone, this.ring, this.pad], false).length > 0;
  }

  public dispose() {
    this.parent.remove(this.group);
    this.cone.material.dispose();
    this.ring.material.dispose();
    this.pad.material.dispose();
  }
}
