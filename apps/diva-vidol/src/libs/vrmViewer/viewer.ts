import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { Parser } from 'mmd-parser';
import * as THREE from 'three';
import {
  Audio,
  Box3,
  BoxGeometry,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';

import { VRM_TO_MMD_SCALE } from '@/constants/common';
import { loadVMDCamera } from '@/libs/VMDAnimation/loadVMDCamera';
import {
  alignEnvironment,
  EnvironmentScene,
  loadEnvironmentModel,
  loadEnvironmentScene,
  freezeStaticEnvironment,
} from '@/libs/environment';
import { MotionFileType } from '@/libs/emoteController/type';
import { StageNavigator } from '@/libs/stageNav';
import { HoverArrow, type ArrowTarget } from '@/libs/stageNav/hoverArrow';
import { TouchAreaEnum } from '@/types/touch';

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadPMXStage } from '../PMXAssets/loadPMXStage';
import { frameCapFor, paintTiming, shouldPaint } from './frameBudget';
import { Model } from './model';

/**
 * 「聚焦人物」时画面上下要装下的真实高度（米）。
 *
 * Hanami 那边是 fov 30 + head.y×1.4 的系数；这边相机 fov 是 45，
 * 照抄系数会变成全身像，所以改成按「想看清多高一截」反算距离：
 * 1.05 m ≈ 她胸口到头顶再留一点空。
 */
const FOCUS_VIEW_HEIGHT = 1.05;

/**
 * 帧率策略
 *
 * 舞台大部分时间只有呼吸、眨眼、头发在动，按显示器刷新率满帧跑等于白烧电。
 * 具体档位与判断都在 `./frameBudget`（纯函数，可单测），这里只负责按它的结论排帧。
 */

/**
 * 单帧最大步进（秒）
 *
 * 循环被暂停（设置面板 / 切后台 / 断点）之后恢复时，`Clock.getDelta()` 会
 * 一次给出几秒的间隔；直接喂给 mixer / 弹簧骨骼，头发会甩飞、走位会瞬移。
 */
const MAX_DELTA = 0.1;

/**
 * 渲染分辨率上限
 *
 * 4K 屏 DPR=2 时像素量是 1080p 的 4 倍，舞台这种画面在上面看不出区别，
 * 但每一帧的填充成本是实打实的。
 */
const MAX_PIXEL_RATIO = 2;

export class Viewer {
  public isReady: boolean;
  public model?: Model;

  private _renderer?: THREE.WebGLRenderer;
  /** 房间用的环境贴图（PMREM 预处理过的室内环境），只给 PBR 材质当反射与补光 */
  private _roomEnv?: THREE.Texture;
  /** 房间的世界包围盒：镜头出界的硬边界（墙是死的，clearance 表是按出生点量的） */
  private _stageBounds?: THREE.Box3;
  /** 走完之后重新取景：跟随时镜头只平移，走到墙边会贴上或看空 */
  private _walkTrack = { lastX: 0, lastZ: 0, travel: 0, restS: 0, armed: false };
  /** 联调用：上一次是谁改了镜头 */
  public camSetBy = '-';
  private _clock: THREE.Clock;

  /** rAF 句柄；0 表示当前没有排下一帧（循环已停） */
  private _rafId = 0;
  /** 画布挂上了、循环应该跑 */
  private _wantLoop = false;
  /** 页面在后台（切标签/最小化）：连 rAF 都不排 */
  private _hidden = false;
  /** 浏览器窗口不在前台（她用别的程序）：再降一档，别在没人看的时候满负荷 */
  private _unfocused = false;
  /** 上一次真正出帧的时间戳；-1 = 还没画过（见 frameBudget.paintTiming） */
  private _lastPaint = -1;
  /** 被交互叫醒到什么时候（时间戳，毫秒）：这段时间按满帧跑 */
  private _wakeUntil = 0;
  private _resizeObserver?: ResizeObserver;
  /** 上一次的注视点：画布被卸下再挂回来（打开/关闭设置）时用它复位镜头 */
  private _savedTarget?: THREE.Vector3;
  /** 正在下载的人物：同一个人重复请求时复用这一次，别再下一遍 */
  private _pendingVrm?: { characterId?: string; promise: Promise<void> };
  /** 座位悬停/点击复用同一个投射器，不要每个指针事件都 new 一个 */
  private _seatRaycaster = new THREE.Raycaster();
  /** 当前台上人物 id：画布被重新挂上时据此跳过重复下载（见 CharacterViewer） */
  public loadedCharacterId?: string;
  /** 真正画过多少帧：性能取证用（?perfprobe=1），不是 rAF 次数 */
  public frameCount = 0;
  private _scene: THREE.Scene;
  private _sound?: Audio;
  private _cameraHelper?: THREE.CameraHelper;
  private _camera?: THREE.PerspectiveCamera;
  private _cameraControls?: OrbitControls;
  private _gridHelper?: THREE.GridHelper;
  private _axesHelper?: THREE.AxesHelper;
  private _mouse: THREE.Vector2;
  private _canvas?: HTMLCanvasElement;
  private _boundHandleClick: (event: MouseEvent) => void;
  /** 鼠标悬停座位时冒出来的「坐这里」箭头 */
  private _hoverArrow?: HoverArrow;
  private _boundHandlePointerMove: (event: PointerEvent) => void;
  private _boundHandlePointerLeave: () => void;
  /** 指针移动的节流：每帧最多做一次射线 */
  private _hoverPending = false;
  private _hoverEvent?: { clientX: number; clientY: number };
  /** 只有 ?hover= 联调进来的悬停才打日志，正常人用鼠标不会刷控制台 */
  private _hoverDebug = false;
  /**
   * 身体被点中时的回调。返回 true 表示「这一下有设定好的动作，已经接手了」，
   * 调用方就不该再播默认反应（两套同时开只会互相盖掉）。
   */
  private _onBodyTouch?: (area: TouchAreaEnum) => boolean | void;
  private _isDancing: boolean = false;
  private _cameraMixer?: THREE.AnimationMixer;
  private _cameraAction?: THREE.AnimationAction;
  private _currentStage?: THREE.Group;
  /** 当前房间（含导入时量好的可行走网格与座位），没房间时为 undefined */
  /** 联调用：最近一次点击的判定结果 */
  public lastPick = '-';

  /** 联调用：打开后每次点击都说明「打到了什么、判成哪个部位」 */
  public touchDebug = false;

  /**
   * 移动锁
   *
   * 打开后：点地面不走、悬停桌椅不出箭头、点座面不坐下、导航那边的闲逛也不启动。
   * 点身体仍然算触摸反应（那是「看她被碰到怎么反应」，不是挪她）。
   * 由操作条那颗锁按钮经 `setMovementLocked` 同步过来，这里也兜一份，
   * 免得导航/取景那条链上还留着没判锁的入口。
   */
  public movementLocked = false;

  public setMovementLocked(locked: boolean) {
    this.movementLocked = locked;
    if (this.navigator) {
      this.navigator.movementLocked = locked;
      // 锁上时她可能正走到一半：把这一趟收掉，否则「锁了还在往前走」
      if (locked) this.navigator.haltAndStand();
    }
    // 锁上立刻收掉已经浮在半空的那颗箭头，否则会「锁了还能点箭头」
    if (locked) this._hoverArrow?.hide();
    this.wake(600);
  }

  /** 联调用：最近一次取景投影算出来的中间值 */
  public camProbe = '-';

  /** 联调用：最近一次取景投影有没有打到房间壳（false = 那个方向是开口，镜头会飞出去） */
  private camShellHit = false;

  /** 房间加载令牌：只有最新一次 `loadEnvironment` 的结果可以进场（见那边的注释） */
  private envLoadToken = 0;

  /** 最近一次投影里「壳」离镜头的距离差（正数 = 壳在镜头后面还有余量） */
  private camShellGap = 0;

  /** 联调用：房间包围盒（判断「镜头是不是被允许跑到屋外」用） */
  public get boundsInfo() {
    const box = this._stageBounds;
    if (!box || box.isEmpty()) return 'none';
    return (
      box.min.x.toFixed(1) +
      '..' +
      box.max.x.toFixed(1) +
      ',' +
      box.min.z.toFixed(1) +
      '..' +
      box.max.z.toFixed(1)
    );
  }

  public currentEnvironment?: { id: string; scene: EnvironmentScene | null };

  /** 联调用：这一帧的绘制调用数 / 合并统计 */
  public get stageStats() {
    const stats = this._currentStage?.userData?.mergeStats as
      | { sources: number; groups: number; skipped: number }
      | undefined;
    return {
      calls: this._renderer?.info.render.calls ?? 0,
      merge: stats ? `${stats.sources}->${stats.groups} (skip ${stats.skipped})` : '-',
    };
  }
  /** 场景导航：点地面走、点座位坐、自动闲逛 */
  public navigator?: StageNavigator;

  constructor() {
    this.isReady = false;
    // scene
    const scene = new THREE.Scene();
    this._scene = scene;

    // 方向光
    const directionalLight = new THREE.DirectionalLight(0xff_ff_ff, Math.PI);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    // 环光
    // const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    // scene.add(ambientLight);

    // 渐变光
    // const HemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444);
    // HemisphereLight.position.set(0, 20, 0);
    // scene.add(HemisphereLight);

    // animate
    this._clock = new THREE.Clock();
    this._clock.start();
    this._mouse = new THREE.Vector2();

    // 在构造函数中绑定 handleClick 方法
    this._boundHandleClick = this.handleClick.bind(this);
    this._boundHandlePointerMove = this.handlePointerMove.bind(this);
    this._boundHandlePointerLeave = this.handlePointerLeave.bind(this);
  }

  /**
   * 播放舞蹈，以音乐文件的播放作为结束标志。
   */
  public async dance(srcUrl: string, audioUrl: string, cameraUrl?: string) {
    if (!this._sound || !this.model) {
      console.error('音频对象或模型对象不存在');
      return null;
    }

    // 1. 关闭当前舞蹈, 设置环境
    this._sound.stop();
    this._isDancing = true;
    // 舞蹈是主动演出：循环必须活着（冻结状态下也要被拉起来）
    this.wake(1000);

    // 2. 加载文件

    // 加载音乐文件
    const audioLoader = new THREE.AudioLoader();
    const audioPromise = audioLoader.loadAsync(audioUrl).then((buffer) => {
      if (this._sound) {
        this._sound.setBuffer(buffer);
        this._sound.setVolume(0.5);
        // 监听音频播放结束事件
        this._sound.onEnded = () => {
          this.handleDanceEnd();
        };
      }
    });

    // 加载摄像机动画
    let cameraPromise = null;
    if (cameraUrl && this._camera) {
      const scale = this.calculateVRMScale();
      cameraPromise = loadVMDCamera(cameraUrl, this._camera, scale).then((cameraAnimation) => {
        if (this._camera && cameraAnimation) {
          this._cameraMixer = new THREE.AnimationMixer(this._camera);
          this._cameraAction = this._cameraMixer.clipAction(cameraAnimation);
        }
      });
    }

    // 并行加载
    await Promise.all([audioPromise, cameraPromise]);

    // 3. 加载舞蹈
    await this.model?.playMotionUrl(MotionFileType.VMD, srcUrl, false);

    // 开始播放
    this._sound.play();
    if (cameraUrl) this.playCameraAnimation();
    // 将 canvas 全屏加载
    this.requestFullScreen();
  }

  public resetToIdle() {
    this._sound?.stop();
    this._isDancing = false;
    this.model?.loadIdleAnimation();
    // 停止镜头动画
    this.stopCameraAnimation();
    // 重置镜头
    this.resetCamera();
    this.wake(1600);
  }

  public removeStage() {
    // 卸载当前舞台
    if (this._currentStage) {
      this._scene.remove(this._currentStage);
      this._currentStage.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!material) continue;
            // material.dispose() 不会释放贴图：房间一换，上一间的贴图（几 MB 到几十 MB）
            // 就永远留在显存里了。把材质上挂的贴图一并释放。
            for (const value of Object.values(material)) {
              if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
            }
            material.dispose();
          }
        }
      });
      this._currentStage = undefined;
    }
  }

  /**
   * 加载舞台
   */
  public async loadStage(stageUrl: string) {
    if (!stageUrl) return;
    this.removeStage();
    // 舞台上场同样作废还在下载的房间请求（房间和舞台互斥）
    this.envLoadToken++;
    // 加载新舞台
    const stageGroup = await loadPMXStage(stageUrl);
    if (stageGroup) {
      this._currentStage = stageGroup;
      this._scene.add(this._currentStage);
    }
  }

  /**
   * 加载 3D 房间（Hanami 环境素材：glb + 可选 sidecar + 量好的 .scene.json）
   *
   * 与 `loadStage`（PMX 舞台）互斥：房间和舞台同时只留一个。
   *
   * 这里有个必须挡住的竞态：页面刚打开、默认房间还在下载，用户就去菜单点了另一间——
   * 两次加载同时在跑，先发起的那次反而后完成，于是它把**自己**的房间和机位写了进来，
   * 后发起的那间就被顶掉（实测：切到温馨阁楼后镜头钻进后脑勺的头发里，整屏发黑）。
   * 用一个自增 token 认「我是不是最新的那次请求」，过期的请求直接退出。
   */
  public async loadEnvironment(room: {
    id: string;
    glb: string;
    scene?: string | null;
    placement?: { scale: number; rotationY: number | null; spawn: number[] | null } | null;
  }): Promise<EnvironmentScene | null> {
    const token = ++this.envLoadToken;
    this.removeStage();
    this.currentEnvironment = undefined;

    const scene = await loadEnvironmentScene(room.scene);
    if (token !== this.envLoadToken) return null;

    const placement = scene?.placement ?? room.placement ?? null;
    const group = await loadEnvironmentModel(room.glb, placement);
    // 已经有人换了别的房间（或清了舞台）：这间就别再进场了
    if (token !== this.envLoadToken) return null;

    // 坐标契约：动房间，不动角色。摆好之后网格/座位就是世界坐标，原点在角色脚下。
    const spawn = (scene?.placement?.spawn ?? room.placement?.spawn ?? [0, 0, 0]) as [
      number,
      number,
      number,
    ];
    alignEnvironment(group, spawn);

    // 摆位完成、房间从此不再动：冻住矩阵，之后每帧不再遍历这棵子树
    // （静态网格的按材质合并在 loadEnvironmentModel 里、摆位之前就做完了）
    freezeStaticEnvironment(group);
    this._stageBounds = new THREE.Box3().setFromObject(group);

    this._currentStage = group;
    // 房间以外的空白不该是页面白：Hanami 那边由环境贴图兜住，这里用中性深灰。
    // 小房间是「从屋里切出来的一块」，背面没有墙，白色会看着像渲染坏了。
    this._scene.background = new THREE.Color(0x2a2c31);

    // 只加一盏方向光的话，背光面是死黑的、玻璃和金属没有反射——看着像平面贴图。
    // 这里补一张程序化的室内环境贴图给 PBR 材质当反射和补光（Hanami 的 envMerge 在那边
    // 用的是 HDR，我们手上没有 HDR 素材，用 three 自带的室内环境等效替代）。
    this.ensureRoomEnvironment();
    this._scene.add(group);
    this.disableGrid();

    // 座位箭头是房间的附属物：换房间时旧的箭头和旧座位一起作废
    this._hoverArrow?.dispose();
    this._hoverArrow = new HoverArrow(this._scene);

    // 角色留在世界原点
    (this.model?.navRoot ?? this.model?.vrm?.scene)?.position.set(0, 0, 0);
    this.model?.vrm?.scene.updateMatrixWorld(true);

    if (this._camera && this._cameraControls) {
      this._camera.position.set(0.7, 1.45, 2.6);
      this._cameraControls.target.set(0, 1.0, 0);
      this._cameraControls.update();
    }

    this.currentEnvironment = { id: room.id, scene };
    this.navigator?.setEnvironment(scene ?? undefined);
    // 地面高度来自房间数据，贴地层靠它对脚
    this.model?.setGroundY(scene?.room.ground ?? 0);
    // 先按模型摆正（resetCamera 把镜头拉到胸口高度），再按房间取景，后者覆盖前者
    this.resetCamera();
    this.frameToRoom(scene ?? undefined);
    // 进房间先让她面向镜头，否则一进来就是背影
    this.navigator?.faceDirection(0.34);

    this.wake(2400);

    return scene;
  }

  /**
   * 按房间数据取景。
   *
   * .scene.json 的 camera.clearance 给了 16 个方向上「角色到墙」的距离，
   * 所以只要镜头落在这个半径内，就保证不会穿墙——取景因此可以按房间自适应，
   * 不再是写死的一组坐标。eye 是观众眼睛的高度，body.height 用来定视线落点。
   */
  public frameToRoom(scene?: EnvironmentScene, yaw = 0.34) {
    const camera = this._camera;
    const controls = this._cameraControls;
    if (!camera || !controls) return;

    const data = scene?.camera;
    const clearance = data?.clearance ?? [];

    // 取景永远以「她现在站/坐的地方」为锚，而不是世界原点——
    // 否则她一坐下（座位可能在几米外），镜头就留在原地看空桌子。
    const root = (this.model?.navRoot ?? this.model?.vrm?.scene)?.position ?? new THREE.Vector3();
    const chest = this.model?.vrm?.humanoid.getNormalizedBoneNode('chest');
    const chestOffset = chest
      ? chest.getWorldPosition(new THREE.Vector3()).y - root.y
      : (scene?.body.height ?? 1.6) * 0.62;
    const chestY = root.y + chestOffset;
    const eyeY = Math.max(chestY + 0.12, data?.eye ?? 1.35);
    // 坐着的时候视线要从**头**穿过去，不能从胸口——
    // 桌子正好挡在胸口高度上，拿胸口打射线一律被桌面挡住，
    // 镜头只好一路收到 1 m 出头，变成贴脸看（实测过）。
    const seatedNow = Boolean(this.navigator?.sitting);
    const sightY = seatedNow ? root.y + chestOffset + 0.38 : chestY;

    if (clearance.length === 0) {
    this.camSetBy = 'frame';
      controls.target.set(root.x, chestY, root.z);
      controls.update();
      return;
    }

    // 从她右前方看过去（约 19°），能同时看见脸和屋子
    const count = clearance.length;
    const index = ((Math.round((yaw / (Math.PI * 2)) * count) % count) + count) % count;
    const wall = clearance[index] || 2.5;
    // 墙远不代表视线通（教室里全是桌椅），所以距离收个上限，
    // 只让房间的宽窄在小范围里影响构图
    // 墙距小就靠近：1.67 m² 的卧室里硬撑 2.2 m 会把镜头推到墙外面去
    // 大房间 2.3 m 左右；小房间按墙距靠近，但不低于 1.25 m
    // 45° 视角下，1.6 m 的人要占满画面上下的 3/4，镜头至少得退到 2 m 出头；
    // 再近就变成半身像了，所以下限给 1.6 m（小房间只能认）。
    const wanted = Math.min(Math.max(wall * 0.45, 1.6), 2.6);

    // 取景候选：先按常规机位，被家具挡住就一步步抬高俯角。
    // 3.3 m² 的 loft 里平视怎么放都在柜子里，只能「往上抬、往下看」。
    //
    // 还有一个坑：小房间是从屋里「切出来的一块」，有些方向根本**没有墙**
    // （门口、切面）。镜头一旦飞进那种缺口，看到的是一堆背面剔除后的空洞，
    // 画面就是一片深灰。所以判定标准不是「有没有被挡住」，而是
    // **这个方向打得到壳**：打到壳说明镜头还在屋里，打不到说明它已经出去了。
    //
    // 试过「绕一圈方向、取退得最远的那个」，卧室和公寓的初始取景都变差了
    // （人还在画面里，但背景变成一堵墙），所以保持单方向 + 抬俯角。
    const anchor = new THREE.Vector3(root.x, sightY, root.z);
    const candidates: { dist: number; pitch: number }[] = [
      { dist: wanted, pitch: 0.1 },
      { dist: wanted, pitch: 0.3 },
      { dist: Math.max(wanted * 0.85, 1.2), pitch: 0.5 },
      { dist: Math.max(wanted * 0.7, 1.0), pitch: 0.7 },
      { dist: 0.9, pitch: 0.9 },
    ];

    let chosen: THREE.Vector3 | undefined;
    let anyShellHit = false;
    for (const candidate of candidates) {
      // 俯角越高，水平退的距离越短，但相机总高度抬起来
      const horizontal = candidate.dist * Math.cos(candidate.pitch);
      const desired = new THREE.Vector3(
        root.x + Math.sin(yaw) * horizontal,
        Math.max(eyeY, chestY + candidate.dist * Math.sin(candidate.pitch) + 0.15),
        root.z + Math.cos(yaw) * horizontal,
      );
      const projected = this.projectCamera(desired, anchor);
      const reached = projected.distanceTo(anchor);
      // 收回来之后还有 1.3 m（半身到全身的距离）就接受这个平视机位，
      // 只有真的挤到 1.3 m 以内才换成更高的角度。
      const blocked = reached < Math.min(candidate.dist * 0.85, 1.3);
      if (this.camShellHit) anyShellHit = true;
      if (this.camShellHit && !blocked) {
        chosen = projected;
        break;
      }
      if (!chosen || !this.camShellHit) chosen = projected;
    }

    // 每个方向都打不到壳（户型图式公寓/卧室这种「切开的一块」，开口特别多）：
    // 以前退到 0.8 m + 抬头 1.2 m 的贴脸俯拍，实际是从头顶看她。改成
    // 「抬到台面之上、约 20° 俯角，并把机位夹进房间包围盒」：不靠墙，也不会飞出去。
    if (!anyShellHit) {
      const pitch = 0.35;
      const horizontal = wanted * Math.cos(pitch);
      chosen = this.clampToStage(
        new THREE.Vector3(
          root.x + Math.sin(yaw) * horizontal,
          Math.max(eyeY, chestY + wanted * Math.sin(pitch) + 0.15),
          root.z + Math.cos(yaw) * horizontal,
        ),
      );
    }

    camera.position.copy(chosen ?? new THREE.Vector3(root.x, eyeY, root.z + wanted));
    controls.target.set(root.x, chestY, root.z);
    controls.update();
  }

  /**
   * 聚焦人物：镜头切到「半身取景」，站在她正前方。
   *
   * 移植自 Hanami 的 `frameCamera`（那边是双击人物触发，见 vrmStage.ts）：
   * - 目标点是**头**、镜头高度比头低 12 cm —— 对胸口取景会把她拍成矮胖半身；
   * - 距离不写死：按「画面上下的可用高度」和相机 fov 反算，fov 改了构图也不会歪
   *   （Hanami 是 fov 30 配 head.y×1.4，这边 fov 45，所以不能照抄那个系数）；
   * - 站到她**正面**去，不沿用用户绕到的角度 —— 「聚焦」要的是一眼看清她；
   * - Hanami 有支沿视线探墙的探针（reculDegage），这里用 projectCamera，规则一样，
   *   而且连家具一起算；
   * - 下限 0.375 身高：房间再小也不给鼻孔特写。
   *
   * 返回 false 表示还没有人物可聚焦（按钮那边不用管，按了没反应就是了）。
   */
  public focusCharacter(): boolean {
    const camera = this._camera;
    const controls = this._cameraControls;
    const vrm = this.model?.vrm;
    if (!camera || !controls || !vrm) return false;

    const rootObject = this.model?.navRoot ?? vrm.scene;
    const rootX = rootObject?.position.x ?? 0;
    const rootY = rootObject?.position.y ?? 0;
    const rootZ = rootObject?.position.z ?? 0;
    const height = this.currentEnvironment?.scene?.body.height ?? 1.6;

    // 头的位置；模型没有 head 骨就按身高折一个（和 Hanami 的兜底同一个比例）
    const headPos = new THREE.Vector3(rootX, rootY + height * (1.35 / 1.6), rootZ);
    const headNode = vrm.humanoid.getNormalizedBoneNode('head');
    if (headNode) headNode.getWorldPosition(headPos);

    // 视线落点：头下面 12 cm（Hanami 的 headPos.y - 0.12）
    const target = new THREE.Vector3(headPos.x, headPos.y - 0.12, headPos.z);

    // 画面上下要装得下的真实高度：1.05 m 大约是「胸口到头顶再留一点空」
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const wanted = FOCUS_VIEW_HEIGHT / (2 * Math.tan(halfFov));
    const distance = Math.min(height * 2.5, Math.max(height * 0.375, wanted));

    // 站到她正面，偏 14° 取个三分之四角度（正对显得像证件照）
    const facing = rootObject?.rotation.y ?? 0;
    const yaw = facing + 0.25;
    const desired = new THREE.Vector3(
      target.x + Math.sin(yaw) * distance,
      target.y,
      target.z + Math.cos(yaw) * distance,
    );

    // 打一条射线：撞墙/家具就停在撞点前面（和取景、跟随用的是同一支探针）
    const placed = this.projectCamera(desired, target);

    // 被墙顶回来也不要贴脸
    const floorDistance = height * 0.375;
    const dx = placed.x - target.x;
    const dz = placed.z - target.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > 1e-3 && horizontal < floorDistance) {
      const k = floorDistance / horizontal;
      placed.x = target.x + dx * k;
      placed.z = target.z + dz * k;
    }

    camera.position.copy(placed);
    controls.target.copy(target);
    controls.update();
    this.camSetBy = 'focus';
    return true;
  }

  /** 把机位夹进房间包围盒（离墙留一点，别把镜头贴在墙面上） */
  private clampToStage(point: THREE.Vector3): THREE.Vector3 {    const bounds = this._stageBounds;
    if (!bounds || bounds.isEmpty()) return point;
    const margin = 0.3;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    return new THREE.Vector3(
      clamp(point.x, bounds.min.x + margin, bounds.max.x - margin),
      clamp(point.y, bounds.min.y + 0.35, bounds.max.y - 0.25),
      clamp(point.z, bounds.min.z + margin, bounds.max.z - margin),
    );
  }

  /**
   * 从 target 往 desired 打一条射线，撞到房间就停在撞点前面一点。
   * 房间没加载 / 没打到东西时原样返回 desired。
   *
   * 注意：房间是从盒子拼出来的，站在屋里往外打，打到的是墙的**内表面**——
   * 那是背面，Raycaster 默认只认正面，于是永远打不到东西，镜头就穿墙出去了
   * （loft 里一坐下镜头直接飞到屋外，画面上只剩几个家具的残片）。
   * 所以打之前先把房间材质临时改成双面，打完立刻还原。
   */
  private projectCamera(desired: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const stage = this._currentStage;
    if (!stage) return desired;

    const dir = desired.clone().sub(target);
    const dist = dir.length();
    if (dist < 1e-3) return desired;
    dir.divideScalar(dist);

    const sides: { material: THREE.Material; side: THREE.Side }[] = [];
    stage.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        sides.push({ material, side: material.side });
        material.side = THREE.DoubleSide;
      }
    });

    let limit = dist;
    let info = 'open';
    // 射线要打到底（不是只打到镜头位置）：只有「这一路上有没有墙」的信息才能区分
    // 「镜头在屋里、墙在更远处」和「这个方向根本没有墙」。只打到 dist 的话，
    // 墙在 2.5 m、镜头在 1.6 m 也会被误判成开口。
    const probeRange = Math.max(dist + 6, 8);
    let where = '';
    try {
      const raycaster = new THREE.Raycaster(target, dir, 0.05, probeRange);
      const hits = raycaster.intersectObject(stage, true);
      if (hits.length > 0) {
        const hit = hits[0].distance;
        this.camShellHit = true;
        this.camShellGap = hit - dist;
        info = hit.toFixed(2) + (hit < dist ? 'blocked' : 'beyond') + ' gap=' + (hit - dist).toFixed(2);
        // 打到的那个面是谁、在哪、法线朝哪——「镜头贴着一面看不见的墙」时只能靠这个认出来
        const point = hits[0].point;
        const normal = hits[0].face
          ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
          : new THREE.Vector3();
        where =
          ' at ' +
          point.x.toFixed(1) +
          ',' +
          point.y.toFixed(1) +
          ',' +
          point.z.toFixed(1) +
          ' n=' +
          normal.x.toFixed(1) +
          ',' +
          normal.y.toFixed(1) +
          ',' +
          normal.z.toFixed(1) +
          ' ' +
          (hits[0].object.name || hits[0].object.type);
        // 「没被挡」还不够：镜头正好贴在某个面上（哪怕在它前面 1 cm），
        // 那个面会以极近距离横贯整个画面（loft 里就是一片深灰）。
        // 所以要求镜头和这个面上留出 CAMERA_MARGIN 的余量。
        const margin = 0.35;
        if (hit < dist + margin) {
          limit = Math.max(Math.min(hit - margin, dist), 0.4);
        }
      } else {
        this.camShellHit = false;
      }
    } finally {
      for (const { material, side } of sides) material.side = side;
    }

    // 兜底：房间包围盒的出口距离。家具再密也不会让她把镜头留在屋外。
    const run = this.boundsRun(target.x, target.z, dir.x, dir.z);
    if (run !== undefined) limit = Math.min(limit, Math.max(run - 0.25, 0.4));
    this.camProbe = `want=${dist.toFixed(2)} ${info}${where} run=${run?.toFixed(2) ?? '-'} -> ${limit.toFixed(2)}`;

    return target.clone().addScaledVector(dir, limit);
  }
  /** 卸下房间，回到空舞台 */
  public unloadEnvironment() {
    // 让还在下载的那次加载作废，否则它下载完会把房间重新盖回来
    this.envLoadToken++;
    this._hoverArrow?.dispose();
    this._hoverArrow = undefined;
    this._scene.environment = null;
    this._scene.background = null;
    this.removeStage();
    this.currentEnvironment = undefined;
    this.navigator?.setEnvironment(undefined);
    (this.model?.navRoot ?? this.model?.vrm?.scene)?.position.set(0, 0, 0);
    this.enableGrid();
    this.resetCamera();
    this.wake(1200);
  }

  /**
   * 台上换人
   *
   * `characterId` 只用于「画布重新挂上时要不要重新下载」：同一个人再挂一次时，
   * 她已经站在台上了，再下载解析一遍模型纯属浪费（模型几十 MB，解析还要吃 CPU）。
   *
   * 同一个人正在下载时再叫一次（打开设置会卸掉画布、关掉又会挂回来），
   * 直接等同一个 promise，不会再下一遍——两个并发加载会各自往场景里塞一份人。
   */
  public async loadVrm(url: string, characterId?: string) {
    const pending = this._pendingVrm;
    if (pending && pending.characterId === characterId) return pending.promise;

    const promise = this.doLoadVrm(url, characterId).finally(() => {
      if (this._pendingVrm?.promise === promise) this._pendingVrm = undefined;
    });
    this._pendingVrm = { characterId, promise };
    return promise;
  }

  private async doLoadVrm(url: string, characterId?: string) {
    // 只卸模型，不动画布与事件监听器：那些归 setup / detachRenderer 管
    this.unloadModel();

    // gltf and vrm
    this.model = new Model(this._camera || new THREE.Object3D());
    await this.model.loadVRM(url);

    if (!this.model?.vrm) {
      return;
    }

    // Disable frustum culling
    this.model.vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    // 头发这类 BLEND 材质默认不写深度，排序一变整片黑（VRoid 头发内层翻到外层前面）。
    // 实测强行开 depthWrite 会更糟（头发把整个人挡住），所以保持引擎默认，别动。

    // 加的是外壳，不是 vrm.scene 本身（外壳里还套着模型的 180° 朝向修正）
    this._scene.add(this.model.navRoot ?? this.model.vrm.scene);
    this.navigator = new StageNavigator(this.model, this._scene);
    // 新导航接手时把当前的锁状态带过去：锁是在挂载时同步的，房间可能比它晚加载
    this.navigator.movementLocked = this.movementLocked;
    this.navigator.setEnvironment(this.currentEnvironment?.scene ?? undefined);
    await this.model.loadIdleAnimation();

    // HACK: アニメーションの原点がずれているの再生後にカメラ位置を調整する
    requestAnimationFrame(() => {
      this.resetCamera();
    });

    this.loadedCharacterId = characterId;

    // 如果没有加载舞台，那么开启网格
    if (!this._currentStage) this.enableGrid();

    // 刚换完人：让循环醒一会儿，把镜头归位、待机动作的起手演出来
    this.wake(2400);
  }

  public unloadVRM(): void {
    if (this.model?.vrm) {
      this._scene.remove(this.model.navRoot ?? this.model.vrm.scene);
      this.model.unLoadVrm();
    }
  }

  /** 卸下台上的人物（画布、监听器、房间都保留） */
  private unloadModel() {
    this.unloadVRM();
    this.model = undefined;
    this.navigator = undefined;
    this.loadedCharacterId = undefined;
    // 箭头是房间的附属物（loadEnvironment 建、unloadEnvironment 删），这里只收起
    this._hoverArrow?.hide();
  }

  /**
   * 挂上画布
   *
   * 这个函数会被调用不止一次：React 的 ref 回调在父组件重渲染时会重跑
   * （比如切一下「触摸交互」），旧实现每次都新建一个 WebGLRenderer、
   * 再起一条 rAF 循环——于是同一块画布上同时有两条渲染循环，
   * 帧率看着没变，CPU/GPU 却翻倍，监听器也越积越多。
   * 现在同一块画布重复调用只做「确保循环在跑」。
   */
  public setup(
    canvas: HTMLCanvasElement,
    onBodyTouch?: (area: TouchAreaEnum) => boolean | void,
  ) {
    this._onBodyTouch = onBodyTouch;
    if (this._renderer && this._canvas === canvas) {
      this.start();
      return;
    }
    this.detachRenderer();
    this.attachRenderer(canvas);
  }

  /** 舞台卸载 / 切到设置页：停循环、删监听器、放掉 GL 上下文 */
  public teardown() {
    this.detachRenderer();
  }

  private attachRenderer(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    const parentElement = canvas.parentElement;
    const width = Math.max(parentElement?.clientWidth || canvas.width || 1, 1);
    const height = Math.max(parentElement?.clientHeight || canvas.height || 1, 1);

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    this._renderer = new THREE.WebGLRenderer({
      alpha: true,
      // 高 DPI 屏（2x）上像素本身已经够密，再叠 4x MSAA 只是多付一份带宽；
      // 1080p/1x 屏保留 MSAA，不然人物边缘会明显发锯齿。
      antialias: dpr < 2,
      // 截图走 captureImage()：读之前先同步画一帧，
      // 比让浏览器每帧都保留一份绘制缓冲便宜得多（大分辨率下差 10~30%）
      preserveDrawingBuffer: false,
      // 舞台没有用模板缓冲（不做裁剪/描边遮罩），关掉省一块显存
      stencil: false,
      powerPreference: 'high-performance',
      canvas,
    });
    this._renderer.setSize(width, height);
    this._renderer.setPixelRatio(dpr);

    // 相机：重挂画布时保留原来的机位，只更新宽高比
    if (!this._camera) {
      this._camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      this._camera.position.set(0, 1.5, 2.0);
    } else {
      this._camera.aspect = width / height;
      this._camera.updateProjectionMatrix();
    }

    // camera 控制：沿用上一份的注视点，避免重挂时镜头跳一下
    const previousTarget = this._cameraControls?.target.clone() ?? this._savedTarget?.clone();
    this._cameraControls?.dispose();
    const controls = new OrbitControls(this._camera, this._renderer.domElement);
    controls.screenSpacePanning = true;
    controls.target.copy(previousTarget ?? new THREE.Vector3(0, 1.0, 0));
    // this._cameraControls.minDistance = 1.0; // 设置最小距离
    // this._cameraControls.maxDistance = 5.0; // 设置最大距离
    // this._cameraControls.maxPolarAngle = Math.PI * 0.75; // 限制相机俯仰角度
    controls.update();
    this._cameraControls = controls;

    // Audio：只建一次，挂在相机上跟着镜头走
    if (!this._sound) {
      const listener = new THREE.AudioListener();
      this._camera.add(listener);
      this._sound = new THREE.Audio(listener);
    }

    this._resizeObserver?.disconnect();
    this._resizeObserver = new ResizeObserver(() => {
      // 放到下一个宏任务：ResizeObserver 回调里改画布尺寸会触发 loop 警告
      window.setTimeout(() => this.resize(), 0);
    });
    if (parentElement) this._resizeObserver.observe(parentElement);

    canvas.addEventListener('click', this._boundHandleClick, false);
    canvas.addEventListener('pointermove', this._boundHandlePointerMove, false);
    canvas.addEventListener('pointerleave', this._boundHandlePointerLeave, false);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focus', this.handleWindowFocus);

    this.isReady = true;

    // 环境贴图是渲染目标纹理，旧的那份随上一个 GL 上下文一起作废了，重建
    if (this.currentEnvironment) this.ensureRoomEnvironment();

    this._lastPaint = -1;
    this._clock.getDelta();
    this.start();
    this.wake(800);
  }

  private detachRenderer() {
    this.stop();

    if (this._canvas) {
      this._canvas.removeEventListener('click', this._boundHandleClick, false);
      this._canvas.removeEventListener('pointermove', this._boundHandlePointerMove, false);
      this._canvas.removeEventListener('pointerleave', this._boundHandlePointerLeave, false);
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('focus', this.handleWindowFocus);

    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;

    // 注视点记下来：舞台上被卸掉再挂回来（打开/关闭设置）时镜头不能跳
    this._savedTarget = this._cameraControls?.target.clone();
    this._cameraControls?.dispose();
    this._cameraControls = undefined;

    if (this._cameraHelper) {
      this._scene.remove(this._cameraHelper);
      this._cameraHelper = undefined;
    }

    // 环境贴图是 PMREM 生成的渲染目标纹理：GL 上下文一丢就作废，留着就是脏数据
    this._roomEnv?.dispose();
    this._roomEnv = undefined;
    this._scene.environment = null;

    const renderer = this._renderer;
    this._renderer = undefined;
    this._canvas = undefined;
    this.isReady = false;

    if (renderer) {
      renderer.dispose();
      // 显式丢掉 GL 上下文：切到设置页时把显存（几十 MB 的贴图）也还回去，
      // 不然舞台「看不见了」还占着 GPU 内存
      renderer.forceContextLoss();
    }
  }

  /**
   * 启动渲染循环（可重复调用）
   */
  public start() {
    this._wantLoop = true;
    this.pump();
  }

  /**
   * 停掉渲染循环（可重复调用）
   */
  public stop() {
    this._wantLoop = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  /**
   * 叫醒：接下来这段时间按满帧跑（鼠标移动、换房、换人、设置面板里点了什么）。
   * 循环已经停掉（页面在后台/画布卸下）时不会硬拉起，等它自己能画了再说。
   */
  public wake(ms = 1200) {
    this._wakeUntil = Math.max(this._wakeUntil, performance.now() + ms);
    this.pump();
  }

  /**
   * 立刻画一帧
   *
   * 注意：设置面板打开时舞台根本不存在（Stage 会把 CharacterViewer 整个卸掉，
   * 见 features/Stage/index.tsx），所以这里只用于「循环在但这一帧还没到点」的场合。
   */
  public requestFrame() {
    if (!this._renderer || !this._camera) return;
    this.renderFrame();
  }

  /**
   * 截图（工具栏用）
   *
   * 关了 `preserveDrawingBuffer` 之后，必须在同一个任务里「先渲染、后读」，
   * 否则读到的是空画布。
   */
  public captureImage(type = 'image/png'): string | null {
    const canvas = this._renderer?.domElement;
    if (!canvas) return null;
    this.renderFrame();
    return canvas.toDataURL(type);
  }

  /** 现在该不该继续排下一帧 */
  private canPaint(): boolean {
    return shouldPaint({
      hidden: this._hidden,
      rendererReady: Boolean(this._renderer),
      wantLoop: this._wantLoop,
    });
  }

  /** 排下一帧（已经在排就不重复排） */
  private pump() {
    if (this._rafId) return;
    if (!this.canPaint()) return;
    this._rafId = requestAnimationFrame(this.update);
  }

  /** 当前该按多少帧跑 */
  private frameCapFor(now: number): number {
    return frameCapFor({
      dancing: Boolean(this._isDancing),
      now,
      oneShot: Boolean(this.model?.emoteController?.isOneShotPlaying),
      unfocused: this._unfocused,
      wakeUntil: this._wakeUntil,
      walking: Boolean(this.navigator?.isWalking),
    });
  }

  private handleVisibilityChange = () => {
    this._hidden = document.hidden;
    if (this._hidden) {
      this.stop();
    } else {
      this.start();
      this.wake(600);
    }
  };

  /**
   * 性能读数（给 `?perfprobe=1` 的取证脚本用，不影响渲染）
   *
   * `frameCount` 是真正调用过 `renderer.render` 的次数——不是 rAF 次数，
   * 所以它能直接回答「舞台到底还在不在画」。
   */
  public perfStats() {
    const info = this._renderer?.info;
    return {
      frameCount: this.frameCount,
      isReady: this.isReady,
      loopActive: this._rafId !== 0,
      pixelRatio: this._renderer?.getPixelRatio() ?? 0,
      renderCalls: info?.render.calls ?? 0,
      sceneChildren: this._scene.children.length,
      triangles: info?.render.triangles ?? 0,
      unfocused: this._unfocused,
      wantLoop: this._wantLoop,
    };
  }

  /**
   * 窗口失焦 / 回到前台
   *
   * 浏览器只在「标签页被切走」时给 visibilitychange；她平时是跟别的程序并排摆着的，
   * 那种情况下标签页还「可见」，但根本没人看。失焦时降到 15 帧，回来先满帧一小段。
   */
  private handleWindowBlur = () => {
    this._unfocused = true;
  };

  private handleWindowFocus = () => {
    this._unfocused = false;
    this.wake(600);
  };

  public toggleCameraHelper() {
    if (this._cameraHelper) {
      this._scene.remove(this._cameraHelper);
      this._cameraHelper = undefined;
    } else {
      if (!this._camera) return;
      this._cameraHelper = new THREE.CameraHelper(this._camera);
      this._scene.add(this._cameraHelper);
    }
  }

  public toggleCameraControls() {
    if (!this._cameraControls) return;
    this._cameraControls.enabled = !this._cameraControls.enabled;
  }

  public toggleGrid() {
    if (this._gridHelper) {
      this.disableGrid();
    } else {
      this.enableGrid();
    }
  }

  public enableGrid() {
    if (!this._gridHelper) {
      this._gridHelper = new GridHelper(50, 100, 0xaa_aa_aa, 0xaa_aa_aa);
      this._scene.add(this._gridHelper);
    }
  }

  public disableGrid() {
    if (this._gridHelper) {
      this._scene.remove(this._gridHelper);
      this._gridHelper = undefined;
    }
  }

  public requestFullScreen() {
    // 将 canvas 全屏加载
    if (this._canvas) {
      // 将 canvas 背景设置为黑色
      this._canvas.style.backgroundColor = 'black';
      this._canvas.requestFullscreen();
      // 添加全屏变化事件监听器
      document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    }
  }

  public exitFullScreen() {
    if (this._canvas) {
      // 将 canvas 背景设置为透明
      this._canvas.style.backgroundColor = 'transparent';
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch((err) => {
        console.warn('退出全屏失败:', err);
      });
    }
    // 无论是否成功退出全屏，都移除事件监听器
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
  }

  public toggleFullScreen() {
    if (document.fullscreenElement) {
      this.exitFullScreen();
    } else {
      this.requestFullScreen();
    }
  }

  public toggleAxes() {
    if (this._axesHelper) {
      this._scene.remove(this._axesHelper);
      this._axesHelper = undefined;
    } else {
      this._axesHelper = new THREE.AxesHelper(5);
      this._scene.add(this._axesHelper);

      // 添加 xyz 标识
      const axisLabels = ['X', 'Y', 'Z'];
      const colors = [0xff0000, 0x00ff00, 0x0000ff];

      axisLabels.forEach((label, index) => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.createTextTexture(label),
            color: colors[index],
          }),
        );
        sprite.position.setComponent(index, 0.5); // 将位置设置为0.5，使标记更靠近原点
        sprite.scale.set(0.2, 0.2, 0.2); // 缩小标记尺寸，使其更适合靠近原点的位置
        this._axesHelper?.add(sprite);
      });
    }
  }

  public resize() {
    if (!this._renderer || !this._camera) return;

    const parentElement = this._renderer.domElement.parentElement;
    if (!parentElement) return;

    const width = document.fullscreenElement ? window.innerWidth : parentElement.clientWidth;
    const height = document.fullscreenElement ? window.innerHeight : parentElement.clientHeight;

    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.resizeRenderer(width, height);
  }

  /**
   * 重新对镜头（把相机高度对到胸口）
   * @param pullBack 额外把相机沿视线方向后退多少米，用于坐下/蹲下这类压低重心的姿势
   */
  public resetCamera(pullBack = 0) {
    const chestNode = this.model?.vrm?.humanoid.getNormalizedBoneNode('chest');
    const camera = this._camera;
    const controls = this._cameraControls;
    if (!chestNode || !camera || !controls) return;

    const chestWPos = chestNode.getWorldPosition(new THREE.Vector3());

    // 镜头不能和目标点几乎重合：半径趋近 0 时 OrbitControls 的方向是退化的，
    // update() 会把它甩到任意位置（实测会掉到 0.2 m 高，正对桌腿）。
    const horiz = Math.hypot(camera.position.x - chestWPos.x, camera.position.z - chestWPos.z);
    const MIN_HORIZ = 1.4;
    if (horiz < MIN_HORIZ) {
      const angle = Math.atan2(camera.position.x - chestWPos.x, camera.position.z - chestWPos.z);
      const dirX = horiz > 1e-3 ? Math.sin(angle) : Math.sin(0.34);
      const dirZ = horiz > 1e-3 ? Math.cos(angle) : Math.cos(0.34);
      camera.position.x = chestWPos.x + dirX * MIN_HORIZ;
      camera.position.z = chestWPos.z + dirZ * MIN_HORIZ;
    }

    camera.position.y = Math.max(chestWPos.y + 0.12, 1.0);
    controls.target.set(chestWPos.x, chestWPos.y, chestWPos.z);

    if (pullBack > 0) {
      const direction = camera.position.clone().sub(controls.target).setLength(pullBack);
      camera.position.add(direction);
    }

    controls.update();
  }

  /**
   * 渲染循环的节拍
   *
   * 一帧只做两件事：判断「现在该不该画」，以及「离上一帧够不够久」。
   * - 画布卸下（打开设置 / 切到 /settings）、页面切到后台：循环彻底停，回调不再排；
   * - 待机 30 帧、演出 60 帧、窗口失焦 15 帧，靠 `_lastPaint` 控制节拍；
   * - 被跳过的时间不会丢：delta 由 `Clock` 给出，只落在真正出的那一帧上。
   */
  public update = () => {
    this._rafId = 0;
    const now = performance.now();
    if (!this.canPaint()) return;

    // 先把下一帧排上：本帧就算抛错，循环也不会断
    this._rafId = requestAnimationFrame(this.update);

    const timing = paintTiming(now, this._lastPaint, this.frameCapFor(now));
    if (!timing.due) return;
    this._lastPaint = timing.nextLastPaint;

    this.renderFrame();
  };

  /** 出这一帧：推进所有动画层，然后交给 GPU */
  private renderFrame() {
    // 暂停后恢复时 Clock 会给出「停顿了几秒」的间隔；截断，否则物理/走位会瞬移
    const delta = Math.min(this._clock.getDelta(), MAX_DELTA);
    // update vrm components
    if (this.model) {
      this.model.update(delta);
    }
    // 走位/闲逛：必须在模型更新之后，否则这一帧的位置会被上一步覆盖
    this.navigator?.update(delta);
    // 座位箭头：每帧最多一次射线（指针移动事件只记位置），再让它自己飘
    this.updateHoverArrow();
    this._hoverArrow?.update(performance.now() / 1000);
    // 镜头跟着她走：只在 x/z 上平移，用户自己调过的角度和距离保持不变
    this.followModel();
    // 走完一段之后重新取景（坐下那条规则管不到走路）
    this.reframeAfterWalk(delta);
    // 走完停下来的时候让她转向镜头。
    // 她头发很长，背对镜头时整屏都是后脑勺的头发（小房间里画面几乎是黑的），
    // 而且「进屋先面向镜头」本来就是这个观感，站着发呆时也该保持。
    const walking = Boolean(this.navigator?.isWalking);
    if (walking !== this.lastWalking) {
      this.lastWalking = walking;
      const root = this.model?.navRoot ?? this.model?.vrm?.scene;
      if (!walking && root && this._camera) {
        const dx = this._camera.position.x - root.position.x;
        const dz = this._camera.position.z - root.position.z;
        if (Math.hypot(dx, dz) > 0.2) this.navigator?.faceDirection(Math.atan2(dx, dz));
      }
    }
    // 她坐下/站起来的时候重新取景：座位常在几米外，旧构图会只剩桌面
    const sitting = Boolean(this.navigator?.sitting);
    if (sitting !== this.lastSitting) {
      this.lastSitting = sitting;
      const facing = (this.model?.navRoot ?? this.model?.vrm?.scene)?.rotation.y ?? 0;
      // 外壳的 yaw 就是朝向，所以镜头放在正前方就是 facing 本身（+0.6 只是别正对）
      this.frameToRoom(this.currentEnvironment?.scene, facing + 0.6);
    }
    // 更新镜头动画
    if (this._isDancing && this._cameraMixer) {
      this._cameraMixer.update(delta);
      // 确保相机的世界矩阵被更新
      this._camera?.updateMatrixWorld(true);
    }
    if (this._cameraHelper) {
      this._cameraHelper.update();
    }

    if (this._renderer && this._camera) {
      this._renderer.render(this._scene, this._camera);
      this.frameCount++;
    }
  }

  /** 上一帧她是不是在走路（用来抓「刚停下」这个瞬间） */
  private lastWalking = false;

  /** 模型走动后镜头跟着平移（不动角度、不动距离） */
  private lastSitting = false;
  private lastFollowX = 0;
  private lastFollowZ = 0;

  /** 惰性生成一次室内环境贴图，房间模式下常驻 */
  private ensureRoomEnvironment() {
    if (this._roomEnv || !this._renderer) return;
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    this._roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this._scene.environment = this._roomEnv;
    // 环境贴图只当补光用：给满强度会把房间烤成灰白
    this._scene.environmentIntensity = 0.55;
  }

  /** .scene.json 的 camera.clearance：每 22.5° 一个「角色到墙」的距离 */
  /**
   * 从 (x, z) 沿 (dirX, dirZ) 走到房间包围盒边缘的距离。
   * 包围盒是墙的硬边界，比按出生点量出来的 clearance 表可靠——人走开了以后，
   * 表里那个方向还剩多少墙根本不准。
   */
  /** 联调用：镜头位置 */
  public get cameraInfo() {
    const p = this._camera?.position;
    const t = this._cameraControls?.target;
    if (!p) return '-';
    return `c=${p.x.toFixed(1)}/${p.y.toFixed(2)}/${p.z.toFixed(1)} t=${t ? t.x.toFixed(1) + '/' + t.y.toFixed(2) + '/' + t.z.toFixed(1) : '-'}`;
  }

  /**
   * 联调用：把取景目标压到脚上、并把距离拉远一点。
   *
   * 正常取景对准胸口，脚正好落在画面外——要判断「脚有没有踩进地板」只能专门看一眼。
   */
  public setDebugCamera(targetY = 0.5, dist = 3) {
    if (!this._camera || !this._cameraControls) return;
    const t = this._cameraControls.target;
    const p = this._camera.position;
    const dir = p.clone().sub(t);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this._cameraControls.target.set(t.x, targetY, t.z);
    p.copy(dir.multiplyScalar(dist)).add(this._cameraControls.target);
    p.y = targetY + 0.35;
    this._cameraControls.update();
  }
  private boundsRun(x: number, z: number, dirX: number, dirZ: number): number | undefined {
    const bounds = this._stageBounds;
    if (!bounds || bounds.isEmpty()) return undefined;
    let best = Number.POSITIVE_INFINITY;
    if (Math.abs(dirX) > 1e-6) {
      const edge = dirX > 0 ? bounds.max.x : bounds.min.x;
      const t = (edge - x) / dirX;
      if (t > 0) best = Math.min(best, t);
    }
    if (Math.abs(dirZ) > 1e-6) {
      const edge = dirZ > 0 ? bounds.max.z : bounds.min.z;
      const t = (edge - z) / dirZ;
      if (t > 0) best = Math.min(best, t);
    }
    return Number.isFinite(best) ? best : undefined;
  }

  private clearanceAt(angle: number): number | undefined {
    const clearance = this.currentEnvironment?.scene?.camera?.clearance;
    if (!clearance || clearance.length === 0) return undefined;
    const count = clearance.length;
    const index = ((Math.round((angle / (Math.PI * 2)) * count) % count) + count) % count;
    const value = clearance[index];
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  /**
   * 走完一段路之后把镜头重新摆回房间该有的取景。
   *
   * 跟随只是平移，她走到墙边/桌椅堆里时镜头会贴上去或者对着空地；
   * 停下 0.45 s 且这段路走了 0.3 m 以上才重摆，避免每帧抖。
   * 重摆时保留用户当前的水平视线方向，只修距离和高度。
   */
  private reframeAfterWalk(delta: number) {
    const root = this.model?.navRoot ?? this.model?.vrm?.scene;
    const camera = this._camera;
    if (!root || !camera) return;

    // 小房间（可行走面积只有几平米）里走两步不重新构图：
    // 平移跟随已经够了，在这个尺度上换机位只会把镜头塞进柜子/墙里。
    // 教室这种大房间才需要在走完之后重新构图，否则会一直盯着空桌子。
    const clearances = this.currentEnvironment?.scene?.camera?.clearance ?? [];
    const span = clearances.length > 0 ? Math.max(...clearances) : 0;
    if (clearances.length > 0 && span < 3.5) return;

    const track = this._walkTrack;
    const moved = Math.hypot(root.position.x - track.lastX, root.position.z - track.lastZ);
    if (moved > 1e-3) {
      track.lastX = root.position.x;
      track.lastZ = root.position.z;
      track.travel += moved;
      track.restS = 0;
      track.armed = true;
      return;
    }

    if (!track.armed) return;
    track.restS += delta;
    if (track.restS < 0.45) return;

    const travelled = track.travel;
    track.armed = false;
    track.travel = 0;
    if (travelled < 0.3) return;

    const yaw = Math.atan2(camera.position.x - root.position.x, camera.position.z - root.position.z);
    this.frameToRoom(this.currentEnvironment?.scene, yaw);
  }

  private followModel() {
    const position = (this.model?.navRoot ?? this.model?.vrm?.scene)?.position;
    const camera = this._camera;
    const controls = this._cameraControls;
    if (!position || !camera || !controls) return;

    const dx = position.x - this.lastFollowX;
    const dz = position.z - this.lastFollowZ;
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;

    camera.position.x += dx;
    camera.position.z += dz;
    controls.target.x += dx;
    controls.target.z += dz;

    // 跟到这里可能已经贴到墙边了：按落点方向上的墙距把镜头收回来。
    // 教室够大看不出来，小房间（1.67 m² 的卧室）不收就会穿墙看黑。
    const offX = camera.position.x - position.x;
    const offZ = camera.position.z - position.z;
    const dist = Math.hypot(offX, offZ);
    if (dist > 0.05) {
      const wall = this.clearanceAt(Math.atan2(offX, offZ));
      const run = this.boundsRun(position.x, position.z, offX / dist, offZ / dist);
      // 两个约束取严的：出生点的墙距表和当前实际到包围盒边缘的距离。
      const limits: number[] = [];
      if (wall !== undefined) limits.push(wall * 0.62);
      if (run !== undefined) limits.push(run - 0.35);
      const allowed =
        limits.length === 0 ? undefined : Math.max(Math.min(...limits), 0.45);
      if (allowed !== undefined && dist > allowed) {
        const k = allowed / dist;
        camera.position.x = position.x + offX * k;
        camera.position.z = position.z + offZ * k;
        controls.target.x = position.x;
        controls.target.z = position.z;
      }
    }

    controls.update();

    this.lastFollowX = position.x;
    this.lastFollowZ = position.z;
  }

  /**
   * 鼠标悬停：鼠标停在椅子/桌面上时冒出一个箭头，点箭头才是「坐上去」。
   *
   * 为什么不是直接点椅子坐下：点地面走位已经是「点了就走」，同一块地方如果点了
   * 既可能走又可能坐，就只能靠判定半径去猜。分成两步——悬停先给答复、箭头才是承诺——
   * 用户看得见自己要点的是什么。
   *
   * 指针事件很密，这里只记下最后一个位置，真正的射线放到 update() 里每帧最多一次。
   */
  private handlePointerMove = (event: PointerEvent) => {
    if (this._isDancing || !this.model || !this.navigator) return;
    this._hoverEvent = { clientX: event.clientX, clientY: event.clientY };
    this._hoverPending = true;
    // 指针在动 = 用户在看，这一小段时间按满帧跑（冻结状态下也会被叫醒）
    this.wake(900);
  };

  /** 鼠标离开画面：箭头必须收起来，否则会一直挂在某个座位上 */
  private handlePointerLeave = () => {
    this._hoverPending = false;
    this._hoverArrow?.hide();
  };

  /**
   * 鼠标这一条射线打到的是不是某块「能坐的面」。
   *
   * 悬停和点击共用这一份判定：不然两边各写一套，很容易出现「箭头冒出来了但点不动」。
   */
  private pickSeatAt(mouse: THREE.Vector2): ArrowTarget | null {
    if (!this._camera || !this._currentStage || !this.navigator) return null;
    // 复用同一个投射器：悬停判定每帧最多一次，但这是热路径，别每次都 new
    const raycaster = this._seatRaycaster;
    raycaster.setFromCamera(mouse, this._camera);
    const hit = raycaster.intersectObject(this._currentStage, true)[0];
    if (!hit) return null;

    // 竖直面（墙、桌腿）不是「能坐的面」
    if (hit.face) {
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(normal.y) < 0.55) return null;
    }

    const seat = this.navigator.seatAtSurface(hit.point.x, hit.point.y, hit.point.z);
    if (!seat) return null;
    if (this._hoverDebug) {
      console.error(
        `[hover] p=${hit.point.x.toFixed(2)}/${hit.point.y.toFixed(2)}/${hit.point.z.toFixed(2)} ` +
          `seat=${seat.id}/${seat.y}`,
      );
    }
    // 用**射线打到的真实表面高度**，不用座位表里的 y：
    // 表里的 y 是椅子座面高度，桌面那一条常常差几厘米，箭头会浮在桌面上方、人坐上去也悬空。
    return {
      id: seat.id,
      x: seat.center[0],
      z: seat.center[1],
      y: hit.point.y,
      px: hit.point.x,
      pz: hit.point.z,
    };
  }

  private updateHoverArrow() {
    if (!this._hoverPending) return;
    this._hoverPending = false;

    // 移动锁：不再招呼她坐下，箭头直接不出现（锁上还能看到箭头 = 说到做不到）
    if (this.movementLocked) {
      this._hoverArrow?.hide();
      return;
    }

    const event = this._hoverEvent;
    if (!event || !this._renderer || !this._camera || !this._currentStage || !this.navigator) {
      this._hoverArrow?.hide();
      return;
    }

    const rect = this._renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // 箭头自己不能被当成「房间表面」，否则鼠标一停在箭头上它就闪掉
    if (this._hoverArrow?.hit(this._mouse, this._camera)) return;

    const target = this.pickSeatAt(this._mouse);
    if (!target) {
      this._hoverArrow?.hide();
      return;
    }

    // 已经坐在这一块上就别再招呼她坐了
    if (this.navigator.sitting && this.navigator.sittingSeatId === target.id) {
      this._hoverArrow?.hide();
      return;
    }

    this._hoverArrow?.show(target);
  }

  /** 联调用：假装鼠标停在某个屏幕坐标上（箭头/座位判定的验收要靠它） */
  public debugHover(clientX: number, clientY: number) {
    this._hoverEvent = { clientX, clientY };
    this._hoverPending = true;
    this._hoverDebug = true;
  }

  /** 联调用：在某个屏幕坐标上补一次点击（走的是同一条 handleClick 通路） */
  public debugClick(clientX: number, clientY: number) {
    this.handleClick({ clientX, clientY } as MouseEvent);
  }

  /**
   * 联调用：把七个触摸部位各自的代表骨骼投影成屏幕坐标。
   *
   * 「点身体有没有接上」这件事没法靠肉眼点准——腿常被椅子挡住、头一动就跑，
   * 所以先让骨骼自己指出该点哪儿，再在那个坐标上走一次真实点击。
   *
   * 骨头的投影点不一定落在**她的网格**上（脚踝可能正好被椅子挡住、骨盆在裙子
   * 里面），所以每个点先在原地打一次射线，打不到她的网格就在附近螺旋找落点，
   * 找不到就标 `miss`——这种「点了但没打到人」必须能从日志里读出来，不能算通过。
   */
  public debugTouchScreens(): { area: string; hit: boolean; x: number; y: number }[] {
    const vrm = this.model?.vrm;
    const camera = this._camera;
    const canvas = this._renderer?.domElement;
    if (!vrm || !camera || !canvas) return [];
    const rect = canvas.getBoundingClientRect();

    const spots: { area: TouchAreaEnum; bone: VRMHumanBoneName }[] = [
      { area: TouchAreaEnum.Head, bone: VRMHumanBoneName.Head },
      { area: TouchAreaEnum.Chest, bone: VRMHumanBoneName.UpperChest },
      { area: TouchAreaEnum.Belly, bone: VRMHumanBoneName.Spine },
      { area: TouchAreaEnum.Arm, bone: VRMHumanBoneName.LeftLowerArm },
      { area: TouchAreaEnum.Leg, bone: VRMHumanBoneName.LeftLowerLeg },
      { area: TouchAreaEnum.Foot, bone: VRMHumanBoneName.LeftFoot },
      { area: TouchAreaEnum.Buttocks, bone: VRMHumanBoneName.Hips },
    ];

    const raycaster = new THREE.Raycaster();
    const probe = (x: number, y: number) => {
      const ndc = new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        -((y - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(vrm.scene, true).length > 0;
    };

    // 螺旋采样：先原地，再按 8 个方向、半径 8/16/26 px 找
    const offsets: [number, number][] = [[0, 0]];
    for (const radius of [8, 16, 26]) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
    }

    const out: { area: string; hit: boolean; x: number; y: number }[] = [];
    for (const spot of spots) {
      const node = vrm.humanoid.getNormalizedBoneNode(spot.bone);
      if (!node) continue;
      const world = node.getWorldPosition(new THREE.Vector3());
      const v = world.project(camera);
      const baseX = rect.left + ((v.x + 1) / 2) * rect.width;
      const baseY = rect.top + ((1 - v.y) / 2) * rect.height;

      let hit = { x: baseX, y: baseY, ok: false };
      for (const [dx, dy] of offsets) {
        if (probe(baseX + dx, baseY + dy)) {
          hit = { x: baseX + dx, y: baseY + dy, ok: true };
          break;
        }
      }
      out.push({ area: spot.area, hit: hit.ok, x: hit.x, y: hit.y });
    }
    return out;
  }

  /**
   * 联调用：把箭头本体投影成屏幕坐标，再在那里点一下。
   *
   * 箭头是画在座位中心的，和鼠标悬停的位置不是同一点（悬停在桌沿、箭头在桌面中间），
   * 所以「点箭头」这件事必须按箭头的真实屏幕位置去验，不然测的是「点那片地板」。
   */
  public debugClickArrow() {
    const anchor = this._hoverArrow?.anchor;
    if (!anchor || !this._camera || !this._renderer) {
      console.error('[click] no arrow');
      return;
    }
    const v = new THREE.Vector3(anchor.x, anchor.y, anchor.z).project(this._camera);
    const rect = this._renderer.domElement.getBoundingClientRect();
    const x = rect.left + ((v.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - v.y) / 2) * rect.height;
    if (this._hoverDebug) console.error(`[click] arrow@${x.toFixed(0)},${y.toFixed(0)}`);
    this.debugClick(x, y);
  }

  /**
   * 「去这张座位坐下」的唯一出口。
   *
   * 走不过去的时候必须留个回执：静默失败会被读成「这个箭头是坏的」，
   * 和 Hanami 那边 7480 次点击 5343 次没反应的教训是同一件事。
   */
  private goSit(seatId?: string, surfaceY?: number, at?: { x: number; z: number }) {
    if (!seatId || !this.navigator) return;
    // 移动锁：所有「去坐下」的入口都收在这一处，锁在这里就够挡住点击/箭头两条路
    if (this.movementLocked) {
      this.lastPick = 'locked:seat';
      if (this.touchDebug) console.error('[click] locked → 不坐下');
      return;
    }
    const arrowTarget = this._hoverArrow?.target ?? null;
    this.lastPick = 'seat:' + seatId;
    this._hoverArrow?.hide();
    void this.navigator.sitAtSeatId(seatId, surfaceY, at).then((ok) => {
      if (!ok) {
        this.lastPick = 'seat-fail:' + seatId;
        if (arrowTarget) this.navigator?.showClickFeedback(arrowTarget, 'refuse');
      }
    });
  }

  /**
   * 联调用：在画面上扫一遍网格，返回第一个「能坐的面」的屏幕坐标。
   *
   * 换房间验收时没法手抄每张椅子的像素位置，扫一遍最省事；
   * 拿到的坐标再走真实的 hover → click 通路，验的就不是特例。
   */
  public debugFindSeat(step = 40): { id: string; x: number; y: number } | null {
    if (!this._renderer || !this._camera) return null;
    const rect = this._renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    for (let py = rect.top + step; py < rect.bottom - step; py += step) {
      for (let px = rect.left + step; px < rect.right - step; px += step) {
        mouse.x = ((px - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((py - rect.top) / rect.height) * 2 + 1;
        const seat = this.pickSeatAt(mouse);
        if (seat) return { id: seat.id, x: px, y: py };
      }
    }
    return null;
  }

  private handleClick = (event: MouseEvent) => {
    if (this._isDancing || !this.model || !this._camera || !this._renderer || this.model.speaking)
      return;

    const rect = this._renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // 移动锁：只剩「点她=触摸反应」这条。点地面/桌椅一律不动，
    // 连 refuse 标记都不打——锁上了还闪一个红叉，会被读成「按钮没生效」。
    if (this.movementLocked) {
      const touched = this.tryBodyTouch();
      this.lastPick = touched ? 'locked:body' : 'locked';
      if (this.touchDebug) console.error(`[click] locked → ${touched ? 'body' : 'ignore'}`);
      return;
    }

    // 点到箭头 = 「去坐下」。必须排在身体的射线判定前面：箭头飘在座面上方，
    // 再往上就是她自己的身体，顺序反了就变成戳她一下而不是坐下。
    if (this._hoverArrow?.hit(this._mouse, this._camera)) {
      const target = this._hoverArrow.target;
      if (this._hoverDebug) console.error('[click] arrow → seat:' + target?.id);
      this.goSit(target?.id, target?.y, target?.px !== undefined && target?.pz !== undefined ? { x: target.px, z: target.pz } : undefined);
      return;
    }

    // 箭头就在这张座位的上方，点它脚下这块面同样算数。
    // 用户实际的点击点落在桌面/椅面上，而不是那个十几厘米的小锥体上，
    // 只认锥体的话就成了「看得见、点不动」。
    if (this._hoverArrow?.visible) {
      const seat = this.pickSeatAt(this._mouse);
      if (seat && seat.id === this._hoverArrow.target?.id) {
        if (this._hoverDebug) console.error('[click] seat-surface → seat:' + seat.id);
        this.goSit(seat.id, seat.y, seat.px !== undefined && seat.pz !== undefined ? { x: seat.px, z: seat.pz } : undefined);
        return;
      }
    }

    const intersects = this.model.handleRaycasterIntersection(this._mouse, this._camera);
    // intersectObject 没命中时返回的是空数组（truthy），必须看长度
    if (!intersects || intersects.length === 0) {
      this.lastPick = 'floor';
      if (this.touchDebug) console.error('[click] floor（射线没打到她）');
      this.handleFloorClick();
      return;
    }

    this.tryBodyTouch(intersects);
  };

  /**
   * 点到她身上：报部位、交给触摸设定，再退回世界这套的固定反应。
   *
   * 抽出来是因为「移动锁」也要走这一小段（锁了只留触摸，没有位移入口）。
   *
   * @returns 这一下是真打在她身上了（false = 射线打了空）
   */
  private tryBodyTouch(intersects?: THREE.Intersection[]): boolean {
    if (!this.model || !this._camera) return false;

    const hits = intersects ?? this.model.handleRaycasterIntersection(this._mouse, this._camera);
    if (!hits || hits.length === 0) return false;

    const touchArea = this.model.handleClick(hits);
    this.lastPick = 'body:' + String(touchArea);
    if (this.touchDebug) {
      console.error(
        `[click] body=${touchArea ?? 'null'} hits=${hits.length} obj=${
          (hits[0]?.object as THREE.Object3D | undefined)?.type ?? '-'
        }`,
      );
    }

    // 触摸设定优先：这个部位配了动作就演那个，没配才退回世界这套固定反应。
    // （以前房间模式下这里直接 return，触摸设定在有房间时完全没接线。）
    if (touchArea && this._onBodyTouch) {
      const handled = this._onBodyTouch(touchArea);
      if (handled) return true;
    }

    // 房间模式下她由世界这套回答（点头/举手/摇头）；舞台模式下还是原来那套
    // 触摸剧本。两套同时开会变成「先播一个、再被另一个盖掉」的双重过渡。
    if (this._currentStage && this.navigator) {
      void this.navigator.react(touchArea ?? undefined);
      return true;
    }

    return true;
  }

  /**
   * 联调用：从**镜头**往外打 5 条射线（中心 + 四角方向），把打到的网格点名。
   *
   * `projectCamera` 只检查「人到镜头」这条线有没有被挡，挡不住「贴着镜头侧面站着的大块几何」——
   * 那种东西不挡这条线，却能把半个画面糊死。loft 里那团黑就是这么来的：
   * 把模型 `visible=false` 之后黑块原样还在，说明是房间几何，不是她变黑。
   */
  public probeOccluders(): string {
    const stage = this._currentStage;
    const camera = this._camera;
    if (!stage || !camera) return '-';

    camera.updateMatrixWorld();
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    const dirs: { label: string; dir: THREE.Vector3 }[] = [
      { label: 'c', dir: forward.clone() },
      { label: 'l', dir: forward.clone().addScaledVector(right, -0.55).normalize() },
      { label: 'r', dir: forward.clone().addScaledVector(right, 0.55).normalize() },
      { label: 'u', dir: forward.clone().addScaledVector(up, 0.55).normalize() },
      { label: 'd', dir: forward.clone().addScaledVector(up, -0.55).normalize() },
    ];

    const sides: { material: THREE.Material; side: THREE.Side }[] = [];
    stage.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        sides.push({ material, side: material.side });
        material.side = THREE.DoubleSide;
      }
    });

    const parts: string[] = [];
    try {
      for (const { label, dir } of dirs) {
        const raycaster = new THREE.Raycaster(camera.position.clone(), dir, 0.02, 6);
        const hits = raycaster.intersectObject(stage, true);
        const first = hits[0];
        parts.push(
          first
            ? `${label}:${first.distance.toFixed(2)}@${(first.object.name || first.object.parent?.name || '?').slice(0, 22)}`
            : `${label}:open`,
        );
      }
    } finally {
      for (const { material, side } of sides) material.side = side;
    }
    return parts.join(' ');
  }

  /** 把鼠标射线打到房间上，拿到地面落点交给导航 */
  private handleFloorClick() {
    if (!this._currentStage || !this._camera || !this.navigator) return;
    // 移动锁：点地面这件事在这里也断一次（点击入口已挡，这防的是别的调用方）
    if (this.movementLocked) {
      this.lastPick = 'locked:floor';
      return;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this._mouse, this._camera);

    const hits = raycaster.intersectObject(this._currentStage, true);
    this.lastPick = 'hits:' + hits.length;

    if (hits.length === 0) return;
    const hit = hits[0];

    // 只认站得住的落点（地板、座面），忽略墙面。
    // 用绝对值：双面材质的楼板法线可能是朝下的，按「朝上」判定会把整块地板拒掉。
    // 拒绝的时候也要留下原因，否则徽章停在 hits:1，看不出是「打中了但不让走」还是「压根没打中」。
    if (hit.face) {
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(normal.y) < 0.55) {
        this.lastPick =
          'steep:' + normal.y.toFixed(2) + '@' + hit.point.x.toFixed(1) + ',' + hit.point.z.toFixed(1);
        return;
      }
    }

    void this.navigator.handleFloorPoint({ x: hit.point.x, z: hit.point.z }).then((reason) => {
      this.lastPick = reason;
    });
  }

  public stopCameraAnimation(): void {
    if (this._cameraAction) {
      this._cameraAction.stop();
      this._cameraAction = undefined;
    }
    if (this._cameraMixer) {
      this._cameraMixer.stopAllAction();
    }
    // 重新启用 OrbitControls
    if (this._cameraControls) {
      this._cameraControls.enabled = true;
    }
  }

  public playCameraAnimation(): void {
    if (this._cameraAction) {
      this._cameraAction.play();
      this._cameraAction.clampWhenFinished = false;
      // 禁用 OrbitControls
      if (this._cameraControls) {
        this._cameraControls.enabled = false;
      }
    }
  }

  private createTextTexture(label: string): THREE.Texture {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = '24px Arial';
      context.fillStyle = 'white';
      context.fillText(label, 0, 24);
    }
    return new THREE.CanvasTexture(canvas);
  }

  // 在 Viewer 类中添加一个新的方法
  private handleFullscreenChange = () => {
    if (document.fullscreenElement) {
      // 进入全屏模式
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.resizeRenderer(width, height);
    } else {
      // 退出全屏模式
      const parentElement = this._canvas?.parentElement;
      if (parentElement) {
        const width = parentElement.clientWidth;
        const height = parentElement.clientHeight;
        this.resizeRenderer(width, height);
      }
      // 手动触发结束逻辑
      this.handleDanceEnd();
    }
  };

  // 新增方法,处理舞蹈结束逻辑
  private handleDanceEnd = () => {
    if (this._isDancing) {
      this._sound?.stop();
      this.exitFullScreen();
      this._isDancing = false;
      this.resetToIdle();
      // 关闭网格
      this.disableGrid();
    }
  };

  // 添加一个新的方法来调整渲染器大小
  private resizeRenderer(width: number, height: number) {
    if (this._renderer && this._camera) {
      this._renderer.setSize(width, height);
      this._camera.aspect = width / height;
      this._camera.updateProjectionMatrix();
    }
  }

  /**
   * 计算当前加载的 VRM 模型的缩放比例
   * @returns 基于模型高度计算的缩放比例
   */
  private calculateVRMScale(): number {
    if (!this.model?.vrm) {
      return VRM_TO_MMD_SCALE;
    }

    const boundingBox = new Box3().setFromObject(this.model.vrm.scene);
    const size = new Vector3();
    boundingBox.getSize(size);
    const vrmHeight = size.y;

    // MMD 标准模型高度约为 20 单位
    const MMD_STANDARD_HEIGHT = 20;
    return vrmHeight / MMD_STANDARD_HEIGHT;
  }
}










