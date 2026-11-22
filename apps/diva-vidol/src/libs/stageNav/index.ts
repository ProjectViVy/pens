import { Object3D, Vector3 } from 'three';

import { MotionFileType } from '@/libs/emoteController/type';
import { toStageEmotion } from '@/libs/emoteController/stageExpression';
import {
  EnvironmentScene,
  EnvironmentSeat,
  findPath,
  isWalkable,
  nearestWalkable,
} from '@/libs/environment';
import { loadMotionIndex, MotionClipMeta } from '@/libs/motionLibrary';
import type { Model } from '@/libs/vrmViewer/model';

import { ClickMarks } from './clickMark';

/**
 * 场景导航 —— 让角色在房间里自己活着的那一层。
 *
 * 素材里的移动片段全是「原地循环」，水平位移必须由代码推；`world.json` 量过每个
 * 步态片段描绘的速度（以测量 rig 的髋高 1.0167 m 为基准），换到真实模型上要按
 * `髋高 / 1.0167` 缩放，否则会滑步。
 *
 * 一次移动由三段拼起来：起步 → 步态循环 → 收步。单播循环会从半空中开始迈腿，
 * 收步片段又让停下的瞬间有个落脚的余韵。
 */

interface ClipUrls {
  walkStart: string;
  walkStop: string;
  sitEnter: string;
  sitIdle: string;
  sitExit: string;
  nod: string;
}

const CLIPS: ClipUrls = {
  walkStart: '/vrma/world-walk-start.vrma',
  walkStop: '/vrma/world-walk-stop.vrma',
  sitEnter: '/vrma/world-sit-enter.vrma',
  sitIdle: '/vrma/world-sit-idle.vrma',
  sitExit: '/vrma/world-sit-exit.vrma',
  nod: '/vrma/nod.vrma',
};

/** 戳她的反应：头/手/身体各一个 */
const RESPONSE = { nod: 'nod-2', shake: 'shake', wave: 'raise-hand' };

/**
 * 坐着时的反应池（Hanami 的 seatedReactionPositive / Negative 那一族）。
 * 只挑坐姿片段——站姿片段放进坐姿里会把人从椅子上拉起来。
 */
const SEATED_RESPONSE = {
  head: ['world-sit-nod', 'world-sit-nod-2', 'world-sit-ack'],
  arm: ['world-sit-raise-hand', 'world-sit-raise-hand-2', 'world-sit-cheer'],
  body: ['world-sit-shake', 'world-sit-dismiss', 'world-sit-sad'],
} as const;

/** 步态片段 id（按路程挑） */
/** 转身角速度上限（弧度/秒，约 150°/s） */
const TURN_RATE = 2.6;
/** 需要超过这个角度（约 50°）才插转身步；小角度不值得动脚 */
const TURN_CLIP_MIN_RAD = 0.87;

/** 坐着时偶尔插一段的一次性小动作（Hanami 的 seatedFidgeting 那一族） */
const SEATED_FIDGET_IDS = [
  'world-sit-fidget',
  'world-sit-look',
  'world-sit-lookfidget',
  'world-sit-lean',
  'world-sit-legs',
] as const;

const GAIT_IDS = ['world-walk', 'world-jog', 'world-run'] as const;
/** 距离阈值（米）：走 / 小跑 / 跑 */
/**
 * 步态分级（按直线距离，米）。
 *
 * 原来写的是 [3, 7]：走 3.5 米就切 `world-jog`，结果她在房间里随便挪一下都在小跑
 * （实测闲逛 3.5 米全程 jog）。Hanami 的闲逛本来就是走，跑只在真要走很远时才合理，
 * 所以门槛抬高到 8 / 18 米——一般房间里几乎永远是走路。
 */
const GAIT_BREAKS = [8, 18] as const;
/** 兜底速度（m/s），正常都从 index.json 读 */
const FALLBACK_SPEEDS: Record<string, number> = {
  'world-jog': 2.6,
  'world-run': 4.2,
  'world-walk': 1.421,
};

/** 测量 rig 的髋高（world.json 的 rigDeMesure） */
const RIG_HIPS_M = 1.0167;
const ARRIVE_EPS = 0.08;
const SEAT_PICK_RADIUS = 0.95;
/** 座面面积超过这个就当成「桌面」：坐上去要挪到边沿，而不是坐在正中间 */
const TABLE_TOP_AREA = 0.45;
/** 坐在桌沿时，往桌子里收多少（太小屁股悬空、太大整个人压在桌面上） */
const TABLE_EDGE_INSET = 0.14;
/**
 * 防卡死：人还在桌面/家具上时，连点地面这么多次就强制落地。
 *
 * 正常情况第一下点地面就已经「起身 + 走开」了，够不到这个数；只有当离座的
 * 落点本身落在障碍格里（桌子贴墙、桌沿卡在柜子后面）时，才会一直点都动不了。
 * 这时候不再靠寻路，直接把她放到点的那块地面上，状态全部清空。
 */
const SEAT_ESCAPE_CLICKS = 5;

export interface NavOptions {
  /** 点地面走过去 */
  clickMove: boolean;
  /** 点座位坐下去 */
  clickSit: boolean;
  /** 待机一阵子自己走两步 */
  wander: boolean;
}

type WalkJob = {
  target: Vector3;
  speed: number;
  onArrive?: () => void;
};

export class StageNavigator {
  public environment?: EnvironmentScene;
  /**
   * 默认值：
   * - `clickMove` 肯开：点地面就走过去，这是最基本的手感。
   * - `clickSit` 暂时关掉：坐姿那一整套（走到座位、坐姿循环、坐姿小动作）接线还在，
   *   但走路本身还没调好，先把坐下的入口摘掉，避免注意力被坐姿bug带偏。
   *   恢复时把这里改回 true 即可（代码路径没删）。
   * - `wander` 开着：没人管的时候她自己会走两步、看看房间，不会像立牌。
   */
  public options: NavOptions = { clickMove: true, clickSit: false, wander: true };
  /** 两次闲逛之间的等待区间（秒），Hanami 的节奏是 45~120 */
  // 闲逛节奏。Hanami 原本的节奏是 45~120 秒一次，那是给「一直开着的陪伴窗口」用的；
  // 现在要先看清她走得对不对，间隔缩短到 12~35 秒，一眼能看到她动起来。
  public wanderMinS = 12;
  public wanderMaxS = 35;
  /**
   * 移动锁（由操作条那颗锁按钮同步过来）。
   *
   * 锁上之后：不接点地面的指令、不自己起身闲逛、不坐下。已经坐着的也不会被拽起来——
   * 锁只管「从现在起到解锁前不要再换个位置」，不是「立刻回位」。
   */
  public movementLocked = false;
  /** 联调日志出口：?walkdiag=1 挂上去，看闲逛到底选了走还是选了活动 */
  public debugLog: ((msg: string) => void) | null = null;
  /** 联调试开关：?noik=1 真把逐腿 IK 关掉（钩子改这里，不要在外面调 setFootPlanting） */
  public ikDisabled = false;

  private marks: ClickMarks;
  private walk?: WalkJob;
  /** 闲逛活动的取消令牌：她走位/坐下/被戳之后，正在排队的活动要作废 */
  private activityToken = 0;
  /** 当前这段路的路点（世界坐标），走完最后一个才算到 */
  private path?: { x: number; z: number }[];
  /** 是否正坐着（镜头取景要看这个） */
  public sitting = false;
  /** 正坐在哪个座位上（箭头要避免对同一个座位再喊一次） */
  public sittingSeatId?: string;
  /** 坐下时站过的那个点：起身时把她挪回这里，才走得出桌子 */
  private sitExitPoint?: { x: number; z: number };
  /** 防卡死：连续几次点地面都没能让她离开座位那块地方 */
  private escapeClicks = 0;
  /** 上一次坐着点地面就被拒了：之后每次仍没走成，都算在同一个卡死序列里 */
  private seatStuck = false;
  /** 想要的朝向（弧度）；实际朝向按 TURN_RATE 追上去 */
  private targetYaw = 0;
  /** 转身步片段播到什么时候（播放期间不再重复触发） */
  private turnClipUntil = 0;
  private busyUntil = 0;
  private restCountdown = 0;
  /** 待机轮换：Hanami 的 idle 有 5 个版本，轮着播才不像定格 */
  public idleVariety = true;
  private idleIds = ['idle', 'idle-2', 'idle-3', 'idle-4', 'idle-7'];
  /** 坐着时的待机也有 5 个版本 */
  private seatedIdleIds = ['world-sit-idle', 'world-sit-idle-2', 'world-sit-idle-3', 'world-sit-idle-4', 'world-sit-idle-5'];
  private idleCountdown = 22;
  private currentIdle = 'idle';

  private index?: MotionClipMeta[];
  private indexLoading?: Promise<void>;

  constructor(
    private model: Model,
    parent: Object3D,
  ) {
    this.marks = new ClickMarks(parent);
  }

  public setEnvironment(environment?: EnvironmentScene) {
    this.environment = environment;
    this.sitting = false;
    this.walk = undefined;
    this.path = undefined;
    this.restCountdown = 0;
    this.marks.clear();
  }

  public get isWalking() {
    return Boolean(this.walk);
  }

  public get isSitting() {
    return this.sitting;
  }

  private get root(): Object3D | undefined {
    // 走位操作外壳（承载位置与朝向）；模型本体里还留着 180° 的朝向修正
    return this.model.navRoot ?? this.model.vrm?.scene ?? undefined;
  }

  private ensureIndex(): Promise<void> {
    if (!this.indexLoading) {
      this.indexLoading = loadMotionIndex()
        .then((data) => {
          this.index = data.clips;
        })
        .catch(() => {
          this.index = [];
        });
    }
    return this.indexLoading;
  }

  private clipOf(id: string) {
    return this.index?.find((clip) => clip.id === id);
  }

  private durationOf(id: string, fallback = 0.6) {
    return this.clipOf(id)?.durationS ?? fallback;
  }

  /** 片段速度按真实髋高缩放 */
  private gaitSpeed(speedMS: number) {
    const hips = this.model.hipsHeight();
    return speedMS * (hips > 0 ? hips / RIG_HIPS_M : 1);
  }

  /** 按路程挑选步态 */
  private pickGait(distance: number) {
    const level = distance <= GAIT_BREAKS[0] ? 0 : distance <= GAIT_BREAKS[1] ? 1 : 2;
    const id = GAIT_IDS[level];
    const meta = this.clipOf(id);
    return {
      id,
      speed: this.gaitSpeed(meta?.speedMS ?? FALLBACK_SPEEDS[id] ?? 1.4),
      url: meta?.file ?? `/vrma/${id}.vrma`,
    };
  }

  /**
   * 转身不要瞬移。
   *
   * Hanami 那边转身是单独的 `world-turn-left/right` 片段 + 过渡时长；这里先做更朴素
   * 但同样必要的一半：朝向按有限角速度逼近目标，而不是每帧直接赋值。
   * 150°/s 大约是一个人不着急时的转身速度；超过 240°/s 会看着像抽帧。
   */
  /** 当前朝向与目标朝向（弧度），联调徽章用 */
  public get facingInfo() {
    const current = this.root?.rotation.y ?? 0;
    return current.toFixed(2) + '->' + this.targetYaw.toFixed(2);
  }

  /**
   * 走路读数：脚下位置、这一步的速度、还剩多远、朝向差。
   *
   * 「走路走不对」这种描述没法直接调试，得先能看见数字：位置不动、速度和应该的不一样、
   * 朝向和移动方向不一致，是三种完全不同的病。
   */
  public get walkInfo() {
    const root = this.root;
    if (!root) return '-';
    const pos = `${root.position.x.toFixed(2)},${root.position.z.toFixed(2)}`;
    if (!this.walk) return `still@${pos}`;
    // 注意：朝向误差要拿**当前路点**（path[0]）算，不是最终目标。
    // 拿最终目标算会得出「一直在斜着走」的假读数——弯道天然差 45°，得出来的数字没意义。
    const aim = this.path?.[0] ?? this.walk.target;
    const dx = aim.x - root.position.x;
    const dz = aim.z - root.position.z;
    const remain = Math.hypot(dx, dz);
    const moveYaw = Math.atan2(dx, dz);
    const dYaw = Math.abs(((moveYaw - root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    return (
      `walk@${pos} v=${this.walk.speed.toFixed(2)} remain=${remain.toFixed(2)} ` +
      `yawErr=${((dYaw * 180) / Math.PI).toFixed(0)}° ` +
      `aim=${this.walk.target.x === undefined ? '?' : ''}${(this.path?.[0] ?? this.walk.target).x.toFixed(2)},` +
      `${(this.path?.[0] ?? this.walk.target).z.toFixed(2)} path=${this.path?.length ?? 0}`
    );
  }

  /** 面向世界方向 theta（弧度，+Z 为 0），房间载入后让她看向镜头用 */
  public faceDirection(theta: number) {
    // 外壳的 rotation.y 就是朝向（模型里面的 π 已经抵消掉片段的 -Z 朝向了）
    this.startTurnClip(theta);
    this.targetYaw = theta;
  }

  /**
   * 大角度转身时插一段转身步。
   *
   * 实测（scratch/probe-turn-clip.mjs 读 vrma 的 Hips rotation 轨道）：
   * `world-turn-left/right` 首尾 yaw 差 0.0°，整段跨度只有 9.8°/4.8°——
   * 也就是说**片段本身不转身**，只做重心转移和踏步，朝向由代码给。
   * 所以这里可以放心叠：放片段 + 照旧平滑转 rotation.y，两者不冲突，
   * 观感从「原地平移着转」变成「踏步转身」。
   */
  private startTurnClip(targetYaw: number) {
    const root = this.root;
    if (!root || this.sitting || this.walk) return;
    const diff = Math.atan2(
      Math.sin(targetYaw - root.rotation.y),
      Math.cos(targetYaw - root.rotation.y),
    );
    if (Math.abs(diff) < TURN_CLIP_MIN_RAD) return;
    const now = performance.now() / 1000;
    if (now < this.turnClipUntil) return;
    // 正角度 = 绕 +Y 逆时针 = 朝她的左手边转
    const side = diff > 0 ? 'left' : 'right';
    const meta = this.clipOf(`world-turn-${side}`);
    this.turnClipUntil = now + (meta?.durationS ?? 1.1);
    void this.model.playMotionUrl(MotionFileType.VRMA, `/vrma/world-turn-${side}.vrma`, false);
  }

  private faceToward(x: number, z: number) {
    const root = this.root;
    if (!root) return;
    const dx = x - root.position.x;
    const dz = z - root.position.z;
    if (Math.hypot(dx, dz) < 1e-4) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  /** 每帧把朝向往目标转一点（走位和待机都用这条） */
  private turnToward(delta: number) {
    const root = this.root;
    if (!root) return;
    const diff = Math.atan2(
      Math.sin(this.targetYaw - root.rotation.y),
      Math.cos(this.targetYaw - root.rotation.y),
    );
    const maxStep = TURN_RATE * delta;
    root.rotation.y += Math.max(-maxStep, Math.min(maxStep, diff));
  }

  /** 走过去。返回的 Promise 在到达时兑现。 */
  public async walkTo(x: number, z: number): Promise<boolean> {
    const root = this.root;
    if (!root) return false;
    // 移动锁：走位的总入口，点地面 / 闲逛 / 外部指令最终都会到这里
    if (this.movementLocked) {
      this.debugLog?.('[lock] walkTo refused');
      return false;
    }
    await this.ensureIndex();
    // 坐着要先离开座位（并把落点挪回桌外），否则从障碍格里寻路会直接失败
    if (this.sitting) this.leaveSeatInstant();

    // 落点在地板外就取最近的可走格：点到桌面、墙脚时不至于原地不动
    let target = { x, z };
    let path: { x: number; z: number }[] | undefined;
    if (this.environment) {
      const snapped = nearestWalkable(this.environment, x, z, 1.4);
      if (!snapped) return false;
      target = snapped;
      // 绕开桌椅：走不到就干脆不动，也不穿墙
      path = findPath(this.environment, root.position.x, root.position.z, target.x, target.z);
      if (!path || path.length === 0) return false;
    } else {
      path = [target];
    }

    const first = path[0] ?? target;
    let distance = 0;
    for (let i = 0; i < path.length; i++) {
      const prev = i === 0 ? root.position : path[i - 1];
      distance += Math.hypot(path[i].x - prev.x, path[i].z - prev.z);
    }
    const gait = this.pickGait(distance);

    // 起步：先转身，播一次起步片段，过了它的时长才切循环并开始位移
    this.faceToward(first.x, first.z);
    this.activityToken += 1;  // 走位打断正在进行的闲逛活动
    // 接力期间不许「一次性片段播完就回待机」：起步片段收尾时会把循环顶掉
    this.model.emoteController?.setWalkHold(true);
    await this.model.playMotionUrl(MotionFileType.VRMA, CLIPS.walkStart, false);
    const startS = Math.max(this.durationOf('world-walk-start', 0.6) - 0.08, 0.2);
    this.busyUntil = performance.now() + startS * 1000;

    // 起步片段没有时长元数据时兜底 0.6 s
    window.setTimeout(
      () => {
        if (!this.walk) return;
        void this.model.playMotionUrl(MotionFileType.VRMA, gait.url, true);
      },
      startS * 1000,
    );

    return new Promise<boolean>((resolve) => {
      this.path = path;
      this.walk = {
        target: new Vector3(target.x, root.position.y, target.z),
        speed: gait.speed,
        onArrive: () => resolve(true),
      };
    });
  }

  /**
   * 走到最近的椅子坐下。
   *
   * 和 `nearestSeat(x, z)` 的区别：那个只找**脚下 0.95 m 内**的椅子（点击用，
   * 点在哪就把椅子找在哪），这个不限距离——本意是给联调钩子 `?sit=nearest` 用。
   * 之前钩子只在自己脚边找椅子，她只要没站在椅子边上就永远找不到，
   * 于是「?sit 偶发失败」看上去像随机故障，其实是搜索半径的问题。
   */
  public async sitAtNearestSeat(): Promise<boolean> {
    if (this.sitting) return true;
    if (this.isWalking) return false;
    const root = this.root;
    if (!root) return false;
    const seat = this.nearestSeat(root.position.x, root.position.z, Number.POSITIVE_INFINITY);
    if (!seat) return false;
    await this.sitAt(seat);
    return true;
  }

  /**
   * 坐下：走到座面前方，转身，播坐下 → 坐姿循环。
   *
   * `at` 是鼠标实际点到的那个表面位置。桌面这种大面，用包围盒算边沿会算错——
   * 圆桌的包围盒比桌面大一圈，算出来的「边沿」落在桌面外面，人就悬在空气里。
   * 用户点的那个点本来就在桌面上，直接以它为准最省事。
   */
  public async sitAt(seat: EnvironmentSeat, at?: { x: number; z: number }) {
    if (this.movementLocked && !this.sitting) {
      this.debugLog?.('[lock] sit refused');
      return false;
    }
    this.activityToken += 1;
    const root = this.root;
    if (!root) return false;

    const [sx, sz] = seat.center;
    const yaw = (seat.yaw * Math.PI) / 180;
    // 座位中心通常是「够不着的座面」，所以站到它前面再坐下
    const standX = sx - Math.sin(yaw) * 0.4;
    const standZ = sz - Math.cos(yaw) * 0.4;
    let approach = seat.approach ?? [standX, standZ];

    // 桌面这种大面，坐到**正中心**会变成盘腿浮在桌子中间：腿没处放，还整个人压在桌面上。
    // 真人的坐法是坐在边沿、让小腿垂到桌子外面去。
    // 判定沿用「像不像桌子」：面积大的是桌面（nearestSeat 用同一个门槛把桌面排除在椅子外）。
    let seatX = sx;
    let seatZ = sz;
    let sitYaw = yaw;
    const isTabletop = seat.area > TABLE_TOP_AREA;
    if (isTabletop) {
      const [bx0, bz0, bx1, bz1] = seat.bounds;
      const halfX = Math.abs(bx1 - bx0) / 2;
      const halfZ = Math.abs(bz1 - bz0) / 2;

      // 点到了桌面上就用点的位置；没点（程序触发）才退回包围盒估算
      let outwardX: number;
      let outwardZ: number;
      if (at) {
        outwardX = at.x - sx;
        outwardZ = at.z - sz;
        // 往里收一点，让屁股压在桌沿上而不是悬在沿外
        const d = Math.hypot(outwardX, outwardZ);
        const pull = d > 0.02 ? Math.max(0, d - TABLE_EDGE_INSET) / d : 0;
        seatX = sx + outwardX * pull;
        seatZ = sz + outwardZ * pull;
      } else {
        // 朝「她走过来的一侧」坐下：从座面中心指向 approach 的方向
        let ux = approach[0] - sx;
        let uz = approach[1] - sz;
        const len = Math.hypot(ux, uz);
        if (len > 0.05) {
          ux /= len;
          uz /= len;
        } else {
          ux = Math.sin(yaw);
          uz = Math.cos(yaw);
        }
        const tx = Math.abs(ux) > 1e-4 ? halfX / Math.abs(ux) : Number.POSITIVE_INFINITY;
        const tz = Math.abs(uz) > 1e-4 ? halfZ / Math.abs(uz) : Number.POSITIVE_INFINITY;
        const reach = Math.min(tx, tz, 0.9);
        seatX = sx + ux * Math.max(0.06, reach - TABLE_EDGE_INSET);
        seatZ = sz + uz * Math.max(0.06, reach - TABLE_EDGE_INSET);
        outwardX = ux;
        outwardZ = uz;
      }

      // 背对桌面、面朝走道：腿才能挂在桌面外
      const outLen = Math.hypot(outwardX, outwardZ);
      if (outLen > 0.05) {
        outwardX /= outLen;
        outwardZ /= outLen;
        sitYaw = Math.atan2(outwardX, outwardZ);

        // 但「朝走过来的那一侧」不一定开阔：公寓的岛台只离柜门 1.2 m，
        // 坐在那儿就是面对着柜子（镜头也只好贴着脸）。这种狭窄的情况下
        // 把朝向拧到房间最开阔的一面——人坐台阶上也会挑有景的一面。
        const gaps = this.environment?.camera?.clearance ?? [];
        if (gaps.length > 0) {
          const gapAt = (a: number) => {
            const n = gaps.length;
            return gaps[(((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n)] ?? 0;
          };
          let bestYaw = sitYaw;
          let bestGap = gapAt(sitYaw);
          // 只在「这一面本身就很窄」时才拧方向：教室课桌朝走道有 3 m 开阔，
          // 扭到最开阔的窗那边反而变成背对镜头（实测过）。
          if (bestGap < 1.6) {
            for (let i = 1; i < 8; i++) {
              const a = sitYaw + (i * Math.PI) / 4;
              const gap = gapAt(a);
              if (gap > bestGap + 0.4) {
                bestGap = gap;
                bestYaw = a;
              }
            }
          }
          if (bestYaw !== sitYaw) {
            sitYaw = bestYaw;
            this.debugLog?.(
              `[sit] face-open gap=${bestGap.toFixed(2)} yaw=${((sitYaw * 180) / Math.PI).toFixed(0)}`,
            );
          }
        }

        approach = [
          seatX + Math.sin(sitYaw) * 0.45,
          seatZ + Math.cos(sitYaw) * 0.45,
        ];
      }
      this.debugLog?.(
        `[sit] tabletop at=${seatX.toFixed(2)},${seatZ.toFixed(2)} yaw=${((sitYaw * 180) / Math.PI).toFixed(0)}` +
          ` src=${at ? 'click' : 'bounds'}`,
      );
    }

    const ok = await this.walkTo(approach[0], approach[1]);
    if (!ok) return false;

    // 记住「坐下之前站的那个点」：桌子上的位置在寻路网格里是障碍格，
    // 坐在那儿直接找路会一路返回 null，人就永远站不起来。
    this.sitExitPoint = { x: approach[0], z: approach[1] };

    root.position.x = seatX;
    root.position.z = seatZ;
    root.rotation.y = sitYaw;
    this.targetYaw = sitYaw;

    await this.model.playMotionUrl(MotionFileType.VRMA, CLIPS.sitEnter, false);
    this.sitting = true;
    this.sittingSeatId = seat.id;
    this.model.setSeated(true, seat.y);
    const enterS = this.durationOf('world-sit-enter', 1.3);
    this.busyUntil = performance.now() + enterS * 1000;

    window.setTimeout(() => {
      if (!this.sitting) return;
      // 坐姿的「待机落点」必须换成坐姿循环：不换的话，坐着播完一次性动作
      // 会自动回到站姿 idle，人就直接站起来了（坐着的小动作也就没法加）。
      this.currentIdle = 'world-sit-idle';
      this.model.emoteController?.setIdleUrl(CLIPS.sitIdle);
      void this.model.playMotionUrl(MotionFileType.VRMA, CLIPS.sitIdle, true);
    }, enterS * 1000);

    return true;
  }

  /**
   * 立刻离开座位，回到「坐下之前站的那个点」。
   *
   * 为什么不是播 world-sit-exit：坐在桌面上时她的坐标落在桌子那块障碍格里，
   * 从障碍格出发寻路一律失败，于是「坐在桌上点地面」看上去像没反应。
   * 所以起身这件事必须先把人**挪回桌外的地面**，再交给走路那套。
   * 用户要的是先能用，不做起身的过渡动画，切姿是瞬时的。
   */
  public leaveSeatInstant() {
    if (!this.sitting) return false;
    const root = this.root;
    this.sitting = false;
    this.sittingSeatId = undefined;
    this.model.setSeated(false);
    this.currentIdle = 'idle';
    this.model.emoteController?.setIdleUrl('/vrma/idle.vrma');
    this.busyUntil = 0;

    const exit = this.sitExitPoint;
    this.sitExitPoint = undefined;
    if (root && exit) {
      root.position.x = exit.x;
      root.position.z = exit.z;
    }
    this.debugLog?.(`[sit] leave → ${exit ? `${exit.x.toFixed(2)},${exit.z.toFixed(2)}` : 'no-exit-point'}`);
    return true;
  }

  /** 站起来，回到待机 */
  public async standUp() {
    if (!this.sitting) return;
    this.sitting = false;
    this.sittingSeatId = undefined;
    this.model.setSeated(false);
    // 站起来以后待机要回到站姿的片段，否则收步会切回坐姿循环
    this.currentIdle = 'idle';
    this.model.emoteController?.setIdleUrl('/vrma/idle.vrma');

    // 从桌面上站起来的人不能留在桌子里：那个坐标在寻路网格上是障碍格，
    // 之后任何「点地面走过去」都会在找路这一步失败。起身同时挪回桌外的地面。
    const root = this.root;
    const exit = this.sitExitPoint;
    this.sitExitPoint = undefined;
    if (root && exit) {
      root.position.x = exit.x;
      root.position.z = exit.z;
    }

    this.busyUntil = performance.now() + this.durationOf('world-sit-exit', 1.3) * 1000;
    await this.model.playMotionUrl(MotionFileType.VRMA, CLIPS.sitExit, false);
  }

  /** 公开是为了联调钩子 ?fidget=1 能单点触发它 */
  public async playSeatedFidget() {
    if (!this.sitting) return;
    if (this.model.isOneShotPlaying) return;
    const fidget = SEATED_FIDGET_IDS[Math.floor(Math.random() * SEATED_FIDGET_IDS.length)];
    this.busyUntil = performance.now() + (this.durationOf(fidget, 3) + 0.3) * 1000;
    await this.model.playMotionUrl(MotionFileType.VRMA, `/vrma/${fidget}.vrma`, false);
  }

  /**
   * 鼠标停在某个表面上时，它是不是一块「能坐的面」。
   *
   * 和 `nearestSeat` 不同：那个是「离落点最近的椅子」，会按面积/高度筛掉桌面；
   * 这里要回答的是「你指着这一块，她能不能坐上去」——所以**桌面也算**，
   * 用户明确要求桌子上面也要出箭头。判定完全靠房间 sidecar 里的座位表：
   * 水平落进 bounds、竖直贴着座面高度（±12 厘米），就算这一块。
   */
  public seatAtSurface(x: number, y: number, z: number): EnvironmentSeat | undefined {
    const seats = this.environment?.seats;
    if (!seats?.length) return undefined;

    let best: EnvironmentSeat | undefined;
    let bestDy = 0.12;
    for (const seat of seats) {
      const [x0, z0, x1, z1] = seat.bounds;
      const minX = Math.min(x0, x1) - 0.04;
      const maxX = Math.max(x0, x1) + 0.04;
      const minZ = Math.min(z0, z1) - 0.04;
      const maxZ = Math.max(z0, z1) + 0.04;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const dy = Math.abs(seat.y - y);
      if (dy > bestDy) continue;
      bestDy = dy;
      best = seat;
    }
    return best;
  }

  /**
   * 按 id 坐下。`surfaceY` 是射线打到的真实表面高度：座位表里桌面的 y 常常比真桌板
   * 高几厘米，直接用表里的值会让人坐在桌面上方悬着；`at` 是鼠标点到的表面位置。
   */
  public async sitAtSeatId(id: string, surfaceY?: number, at?: { x: number; z: number }) {
    const found = this.environment?.seats?.find((s) => s.id === id);
    const seat = found && surfaceY !== undefined && Math.abs(surfaceY - found.y) < 0.2
      ? { ...found, y: surfaceY }
      : found;
    this.debugLog?.(`[sit] id=${id} found=${Boolean(seat)} y=${seat?.y ?? '-'} approach=${seat?.approach ?? '-'}`);
    if (!seat) return false;
    this.debugLog?.(`[sit] at=${at ? `${at.x.toFixed(2)},${at.z.toFixed(2)}` : '-'}`);
    await this.sitAt(seat, at);
    this.debugLog?.(`[sit] done sitting=${this.sitting}`);
    return true;
  }

  /** 主动亮一个点击标记（面板/联调也能用） */
  public showClickFeedback(point: { x: number; y?: number; z: number }, kind: 'accept' | 'refuse') {
    this.marks.show(point, kind);
  }

  /**
   * 戳一下要有反应。
   *
   * Hanami 那边量出来的结论很直白：7480 次点击里 5343 次什么都没发生，于是被读成
   * 「坏了」。人形可以点的地方至少要有三种回答——头、手、身体，各给一个不一样的
   * 反应；同时她会看向点她的地方，这样「被碰到」这件事是有指向的。
   */
  public async react(area?: string) {
    if (performance.now() < this.busyUntil) return;

    const key = (area ?? '').toLowerCase();
    const isHead = key.includes('head') || key.includes('face');
    const isArm = key.includes('hand') || key.includes('arm');

    // 坐着的时候另有一整套反应片段（Hanami 的 seatedReaction*），
    // 用站姿的点头/挥手会让她从椅子上站起来——所以必须分开选。
    const seatedSet = isHead
      ? SEATED_RESPONSE.head
      : isArm
        ? SEATED_RESPONSE.arm
        : SEATED_RESPONSE.body;
    const pool = this.sitting ? seatedSet : undefined;
    const clip = pool
      ? pool[Math.floor(Math.random() * pool.length)]
      : isHead
        ? RESPONSE.nod
        : isArm
          ? RESPONSE.wave
          : RESPONSE.shake;

    // 表情跟身体语言对上：摸头是惊讶、举手是高兴、戳身体是不高兴
    const emotion = isHead ? 'surprised' : isArm ? 'happy' : 'angry';
    this.model.emoteController?.expression.set(emotion, 2.2);

    this.busyUntil = performance.now() + this.durationOf(clip, 1.2) * 1000;
    await this.model.playMotionUrl(MotionFileType.VRMA, `/vrma/${clip}.vrma`, false);
  }

  /**
   * 触摸设定驱动的「真实动作」：直接播动作库里的片段（`public/vrma/*.vrma`）。
   *
   * 为什么必须走这里而不是在 React 里直接 `playMotionUrl`：
   * 世界那套每隔 20~40 秒轮换待机、闲着还会自己找活动，直接播会被它当成
   * 「空闲」抢掉（实测过：片段播到一半换回待机）。`busyUntil` 就是这个看门狗，
   * 和 `react()` / 坐姿小动作共用同一把锁。
   *
   * @param clipId 动作库 id（`shake` / `world-clap-in` 这种，带不带 `/vrma/` 前缀都行）
   * @param loop   片段本身是否循环；循环片段播 `holdS` 秒后收回待机
   * @param expression 同时要盖上去的表情（触碰反应需要「表情 + 动作」对上）
   * @param holdSOverride 指定占用时长（说话要看字幕多久，按字数算，不能一律 3 秒）
   */
  public async playTouchClip(
    clipId: string,
    loop = false,
    expression?: string,
    holdSOverride?: number,
  ) {
    const id = this.normalizeClipId(clipId);
    if (!id) return;

    // 走位途中插一个原地片段 = 脚在原地滑、人还在往前挪。宁可这一下不演。
    if (this.walk) {
      this.debugLog?.('[touch] 正在走位，这一次不演');
      return;
    }

    const holdS = holdSOverride ?? (loop ? 3 : this.durationOf(id, 1.5));
    this.busyUntil = performance.now() + holdS * 1000;
    const emotion = toStageEmotion(expression);
    if (emotion) this.model.emoteController?.expression.set(emotion, 2.2);
    this.debugLog?.(`[touch] clip=${id} loop=${loop} hold=${holdS.toFixed(2)}s`);

    await this.model.playMotionUrl(MotionFileType.VRMA, `/vrma/${id}.vrma`, loop);

    // 循环片段不会自己结束，到点收回待机；期间又被别的动作占用就让位
    if (loop) {
      const token = (this.activityToken += 1);
      window.setTimeout(() => {
        if (token !== this.activityToken) return;
        if (this.walk || this.sitting) return;
        void this.model.playMotionUrl(MotionFileType.VRMA, '/vrma/idle.vrma', true);
      }, holdS * 1000);
    }
  }

  /** `world-nod` / `/vrma/world-nod.vrma` / `world-nod.vrma` 都归一成 `world-nod` */
  private normalizeClipId(clipId: string): string {
    return clipId.trim().replace(/^\/?vrma\//, '').replace(/\.vrma$/i, '');
  }

  public async nod() {
    await this.model.playMotionUrl(MotionFileType.VRMA, CLIPS.nod, false);
  }

  /**
   * 离落点最近、且**像椅子**的座位。
   *
   * 座位表里混着桌面上沿和抬高的地面块，它们的 y 也在「齐腰」这一档。
   * 只按距离挑的话，人会坐到吧台桌面上去（腿悬空晃着）。
   * 真正的椅子是：座面 0.3~0.6 m、面积 0.2 m² 上下、头顶留得下人。
   * 吧台高脚凳（0.75 m 左右）面积同样很小，所以按面积把它留下，只给它排后一点。
   */
  public nearestSeat(x: number, z: number, radius = SEAT_PICK_RADIUS): EnvironmentSeat | undefined {
    const seats = this.environment?.seats;
    if (!seats?.length) return undefined;

    let best: EnvironmentSeat | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const seat of seats) {
      // 桌面、抬高地面块：面积大，人不坐上去
      if (seat.area > 0.45) continue;
      if (seat.y < 0.28 || seat.y > 1.0) continue;
      if (seat.headroom < 0.9) continue;

      const dist = Math.hypot(seat.center[0] - x, seat.center[1] - z);
      if (dist > radius) continue;

      // 高的（吧台凳）排后面，有靠背的稍微优先
      const score = dist + (seat.y > 0.62 ? 0.3 : 0) + (seat.back ? 0 : 0.04);
      if (score < bestScore) {
        bestScore = score;
        best = seat;
      }
    }

    return best;
  }

  /**
   * 立刻停掉当前一切，让位给新的指令。
   *
   * 「点一下，她马上过来」——之前走路途中再点地面会被 `refuse-busy` 拒掉，
   * 坐着做小动作时点地面也要等动作播完才起身。新指令优先级最高，
   * 所以这里把走路、路径、一次性动作的静默期、转身片段的冷却全部清掉。
   */
  public interrupt() {
    this.path = undefined;
    this.walk = undefined;
    this.busyUntil = 0;
    this.activityToken += 1;
    this.turnClipUntil = 0;
    // 被打断时接力的下一棒不会来了，必须把保护解开，否则永远不会回待机
    this.model.emoteController?.setWalkHold(false);
  }

  /**
   * 立刻停住并回到站姿待机（移动锁按下时用）。
   *
   * 只挡住「新的移动指令」是不够的：锁上的那一刻她可能正走到半路，
   * 会带着走路片段一路滑到目的地，看上去就是「锁了还在动」。
   * 这里把走路收掉、接力保护解开，再把站姿待机顶上去。
   */
  public haltAndStand() {
    this.interrupt();
    if (this.sitting) return; // 坐着的不动：锁不是「站起来」
    this.model.emoteController?.setIdleUrl('/vrma/idle.vrma');
    void this.model.playMotionUrl(MotionFileType.VRMA, '/vrma/idle.vrma', true);
  }

  /**
   * 兜底逃生口：不再寻路，直接把她放到这块地面，并把坐姿相关的状态全部清空。
   *
   * 只在「连点 N 次都没能动」时触发。落点走 `nearestWalkable` 找最近可走格，
   * 所以哪怕点在桌肚里也不会把人塞进家具。
   */
  public escapeToGround(x: number, z: number): boolean {
    const root = this.root;
    if (!root) return false;

    // 落点候选按「离点击处由近到远」取第一个可走的：
    // 点的地方可能在桌肚里、甚至整块房间外面（联调时点到 40,40 就真飞出去了），
    // 所以既不能直接用点击坐标，也不能没有兜底。
    const exit = this.sitExitPoint;
    let target: { x: number; z: number } | undefined;
    if (this.environment) {
      target =
        nearestWalkable(this.environment, x, z, 1.4) ??
        (exit ? nearestWalkable(this.environment, exit.x, exit.z, 1.4) : undefined) ??
        nearestWalkable(this.environment, root.position.x, root.position.z, 2.5) ??
        nearestWalkable(this.environment, 0, 0, 4);
    }
    target = target ?? { x: 0, z: 0 };

    this.interrupt();
    this.sitting = false;
    this.sittingSeatId = undefined;
    this.sitExitPoint = undefined;
    this.escapeClicks = 0;
    this.seatStuck = false;
    this.model.setSeated(false);
    this.currentIdle = 'idle';
    this.model.emoteController?.setIdleUrl('/vrma/idle.vrma');
    // 只改 idleUrl 不会顶掉正在循环的坐姿片段（实测逃生后还定格在 world-sit-idle），
    // 所以这里要真的把站姿待机播起来。
    void this.model.playMotionUrl(MotionFileType.VRMA, '/vrma/idle.vrma', true);

    // 人物垂直位置由贴地/坐姿那套负责（root 的 y 一直是 0），这里只管水平落点；
    // 清掉 seated 之后贴地会把脚重新对齐到地面。
    root.position.x = target.x;
    root.position.z = target.z;
    this.debugLog?.(
      `[sit] escape(${SEAT_ESCAPE_CLICKS}) → ${target.x.toFixed(2)},${target.z.toFixed(2)}`,
    );
    return true;
  }

  /**
   * 点地面/座位的落点处理（带防卡死）。
   *
   * 正常情况点一下地面她就已经起身走过去了，计数一直是 0；只有「坐着，而且离座之后
   * 仍然寻不到路」才会开始累计。连着 `SEAT_ESCAPE_CLICKS` 次都没动，就放弃寻路，
   * 直接把她放到最后点的这块地面上（见 `escapeToGround`）。
   */
  public async handleFloorPoint(point: { x: number; z: number }): Promise<string> {
    if (this.movementLocked) {
      this.debugLog?.('[lock] floor point ignored');
      return 'refuse-locked';
    }
    const wasSeated = this.sitting;
    const result = await this.resolveFloorPoint(point);

    if (result === 'walk' || result === 'seat') {
      this.escapeClicks = 0;
      this.seatStuck = false;
      return result;
    }

    // 只有「坐着点地面 / 已经卡在同一个序列里」的拒绝才算卡死，
    // 站在地上点到走不过去的角落不会把人传送走。
    if (result.startsWith('refuse') && (wasSeated || this.seatStuck)) {
      this.seatStuck = true;
      this.escapeClicks += 1;
      this.debugLog?.(`[sit] stuck ${this.escapeClicks}/${SEAT_ESCAPE_CLICKS} (${result})`);
      if (this.escapeClicks >= SEAT_ESCAPE_CLICKS) {
        if (this.escapeToGround(point.x, point.z)) {
          this.marks.show(point, 'accept');
          return 'escape';
        }
        this.escapeClicks = 0;
        this.seatStuck = false;
      }
    }
    return result;
  }

  private async resolveFloorPoint(point: { x: number; z: number }): Promise<string> {
    const accept = () => this.marks.show(point, 'accept');
    const refuse = () => this.marks.show(point, 'refuse');

    // 新指令压过旧动作：无论在走、在坐、还是在播一次性动作，立刻让位
    this.interrupt();

    // 坐着点地面：先起身回到桌外的地面。寻路必须在离开座位之后做，
    // 因为坐姿的坐标在桌子那块障碍格上。
    if (this.sitting) this.leaveSeatInstant();

    // 落座入口暂时摘掉（见 options.clickSit）。关掉的时候点椅子**当普通地面**处理：
    // 走过去站在椅子旁边，而不是「拒绝了但不解释」。
    const seat = this.options.clickSit ? this.nearestSeat(point.x, point.z) : undefined;
    if (seat) {
      accept();
      await this.sitAt(seat);
      return 'seat';
    }

    if (!this.options.clickMove) {
      refuse();
      return 'refuse-move-off';
    }

    const root = this.root;
    if (!root) return 'refuse-no-root';

    let goal = { x: point.x, z: point.z };
    if (this.environment) {
      const snapped = nearestWalkable(this.environment, point.x, point.z, 1.4);
      if (!snapped) {
        refuse();
        return 'refuse-nowalk';
      }
      goal = snapped;
      const path = findPath(this.environment, root.position.x, root.position.z, snapped.x, snapped.z);
      if (!path || path.length === 0) {
        refuse();
        return 'refuse-nopath';
      }
    }

    accept();
    void this.walkTo(goal.x, goal.z);
    return 'walk';
  }
  public update(delta: number) {
    this.marks.update(performance.now() / 1000);

    const root = this.root;
    if (!root) return;

    // 朝向永远走这条：走位、待机、坐下之后共用同一个角速度上限
    this.turnToward(delta);

    // 站着完整解，走路只防穿地，坐着够得到地板就落下去（够不到由 IK 自己跳过）
    // `ikDisabled` 是联调开关（?noik=1）：这里每帧都会重开 IK，所以钩子必须从这个口子进，
    // 光在外面调 setFootPlanting(false) 会被下一帧覆盖。
    if (!this.ikDisabled) {
      this.model.setFootPlanting(
        true,
        Boolean(this.walk),
      );
    }
    if (this.walk) {
      const { speed, onArrive } = this.walk;
      // 起步片段还在播的时候不产生位移
      if (performance.now() < this.busyUntil) return;

      const step = speed * delta;
      while (this.path && this.path.length > 1) {
        const nextPoint = this.path[0];
        const segDist = Math.hypot(nextPoint.x - root.position.x, nextPoint.z - root.position.z);
        if (segDist > ARRIVE_EPS) break;
        this.path.shift();
      }

      const goal = this.walk.target;
      const aim = this.path?.[0] ?? goal;
      const dx = aim.x - root.position.x;
      const dz = aim.z - root.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= Math.max(step, ARRIVE_EPS)) {
        root.position.x = aim.x;
        root.position.z = aim.z;
        if (aim === goal || (this.path && this.path.length <= 1)) {
          this.path = undefined;
          this.walk = undefined;
          // 收步片段结束后要能自动回待机，所以这里把「接力保护」关掉
          this.model.emoteController?.setWalkHold(false);
          // 收步片段，播完 MotionController 自己回待机
          void this.model.playMotionUrl(MotionFileType.VRMA, CLIPS.walkStop, false);
          this.busyUntil = performance.now() + this.durationOf('world-walk-stop', 0.7) * 1000;
          onArrive?.();
        }
        return;
      }

      this.targetYaw = Math.atan2(dx, dz);

      // 朝向没对上就别往前推。
      // 之前是「边转身边平移」：拐弯的 0.5 秒里她会以 1.25 m/s 横着滑过去，
      // 上半身还朝着旧方向，看着就是走路走歪、腿跟不上身体（实测 yawErr 到 56°）。
      // 人走路会先转头再迈步，所以这里按朝向对齐程度给速度打折：
      // 对齐（0°）满速，偏 12° 开始减速，偏 50° 就完全停住，等转过来再走。
      const yawErr = Math.abs(
        Math.atan2(
          Math.sin(this.targetYaw - root.rotation.y),
          Math.cos(this.targetYaw - root.rotation.y),
        ),
      );
      const ALIGN_FULL = (12 * Math.PI) / 180;
      const ALIGN_STOP = (50 * Math.PI) / 180;
      const alignScale =
        yawErr <= ALIGN_FULL
          ? 1
          : yawErr >= ALIGN_STOP
            ? 0
            : 1 - (yawErr - ALIGN_FULL) / (ALIGN_STOP - ALIGN_FULL);

      const moveStep = step * alignScale;
      if (moveStep <= 0) return;
      root.position.x += (dx / dist) * moveStep;
      root.position.z += (dz / dist) * moveStep;
      return;
    }

    // 待机轮换：每隔 20~40 秒换一个 idle 版本，别把一次性动作掐断
    if (this.idleVariety && performance.now() >= this.busyUntil) {
      this.idleCountdown -= delta;
      if (this.idleCountdown <= 0) {
        this.idleCountdown = 20 + Math.random() * 20;
        // 坐着的时候 Hanami 有一整族 seatedFidgeting 一次性片段（抖腿、往前趴、
        // 左右看、挪屁股）。轮换里插一段这个，比一直换循环更像在等人。
        if (this.sitting && !this.model.isOneShotPlaying && Math.random() < 0.45) {
          const fidget = SEATED_FIDGET_IDS[Math.floor(Math.random() * SEATED_FIDGET_IDS.length)];
          this.busyUntil = performance.now() + (this.durationOf(fidget, 3) + 0.3) * 1000;
          void this.model.playMotionUrl(MotionFileType.VRMA, `/vrma/${fidget}.vrma`, false);
          return;
        }
        const pool = this.sitting ? this.seatedIdleIds : this.idleIds;
        const next = pool.filter((id) => id !== this.currentIdle);
        const picked = next[Math.floor(Math.random() * next.length)];
        if (picked && !this.model.isOneShotPlaying) {
          this.currentIdle = picked;
          const url = "/vrma/" + picked + ".vrma";
          this.model.emoteController?.setIdleUrl(url);
          void this.model.playMotionUrl(MotionFileType.VRMA, url, true);
        }
      }
    }

    if (!this.options.wander || this.sitting || !this.environment) return;
    // 移动锁：不自己起身走两步。站着的待机小动作照旧（那不是位移）
    if (this.movementLocked) return;
    if (performance.now() < this.busyUntil) return;

    // 待机一阵子，再自己走两步（Hanami 的节奏：45~120 秒）
    if (this.restCountdown <= 0) {
      this.restCountdown = this.wanderMinS + Math.random() * (this.wanderMaxS - this.wanderMinS);
      return;
    }
    this.restCountdown -= delta;
    if (this.restCountdown > 0) return;

    const spot = this.pickWanderSpot();
    this.restCountdown = 0;
    this.debugLog?.(`[wander] spot=${spot ? spot.x.toFixed(2) + ',' + spot.z.toFixed(2) : 'none'}`);
    // 不总是走：Hanami 的闲逛里她也会停下来干点别的，走动只是其中一种。
    // 现在以「走」为主（0.75），先把走路调到好看，再往回加站着的活动。
    if (spot && Math.random() < 0.75) void this.walkTo(spot.x, spot.z);
    else void this.runWanderActivity();
  }

  /**
   * 闲逛时「做点别的」。
   *
   * Hanami 的闲逛不只走位：她会换个站姿待一会儿，或者掏手机看一会儿再回来。
   * 这里用现成的素材拼这条弧线：enter（一次） → 循环（几秒） → exit（一次） → 待机。
   * 任何真正打断她的操作（走位、坐下、被戳）都会把令牌 +1，排队中的定时器就自动作废。
   */
  /** 公开是为了联调钩子 ?activity=1 能单点触发它 */
  public async runWanderActivity() {
    const token = (this.activityToken += 1);
    const VC = MotionFileType.VRMA;
    const stillValid = () => token === this.activityToken && !this.walk && !this.sitting;

    if (Math.random() < 0.45) {
      const alt = Math.random() < 0.5 ? 'world-idle-alt1' : 'world-idle-alt2';
      const enterS = this.durationOf(`${alt}-enter`, 0.9);
      const holdS = 6 + Math.random() * 5;
      this.busyUntil = performance.now() + (enterS + holdS) * 1000;
      await this.model.playMotionUrl(VC, `/vrma/${alt}-enter.vrma`, false);
      window.setTimeout(() => {
        if (!stillValid()) return;
        void this.model.playMotionUrl(VC, `/vrma/${alt}.vrma`, true);
      }, enterS * 1000);
      window.setTimeout(() => {
        if (!stillValid()) return;
        void this.model.playMotionUrl(VC, `/vrma/${alt}-exit.vrma`, false);
      }, (enterS + holdS) * 1000);
      return;
    }

    // 掏手机看一会儿。这个片段本身是循环的，到点直接回待机
    const holdS = 6 + Math.random() * 4;
    this.busyUntil = performance.now() + holdS * 1000;
    void this.model.playMotionUrl(VC, '/vrma/world-afk-texting.vrma', true);
    window.setTimeout(() => {
      if (!stillValid()) return;
      void this.model.playMotionUrl(VC, '/vrma/idle.vrma', true);
    }, holdS * 1000);
  }

  /**
   * 在当前点附近找一个可走的目标。
   *
   * 只撒 1~3.5 m 这一圈是不够的：教室正中间四周全是桌椅，24 次采样可能一次都落不到
   * 可走格上，于是闲逛永远退化成「原地看手机」（实测 arf=5 跑 22 秒一次都没走）。
   * 所以先近后远，最后再退一步：在大范围里随机取点、吸附到最近可走格。
   */
  private pickWanderSpot(): { x: number; z: number } | undefined {
    const root = this.root;
    const scene = this.environment;
    if (!root || !scene) return undefined;

    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.9 + Math.random() * 4.6;
      const x = root.position.x + Math.cos(angle) * radius;
      const z = root.position.z + Math.sin(angle) * radius;
      if (isWalkable(scene, x, z)) return { x, z };
    }

    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1 + Math.random() * 6;
      const x = root.position.x + Math.cos(angle) * radius;
      const z = root.position.z + Math.sin(angle) * radius;
      const snapped = nearestWalkable(scene, x, z, 1.8);
      if (!snapped) continue;
      // 贴着自己脚下就别走了，原地转个身不算闲逛
      if (Math.hypot(snapped.x - root.position.x, snapped.z - root.position.z) < 0.6) continue;
      return snapped;
    }
    return undefined;
  }
}





