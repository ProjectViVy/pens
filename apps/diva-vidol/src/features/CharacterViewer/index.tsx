import { message } from 'antd';
import classNames from 'classnames';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ScreenLoading from '@/components/ScreenLoading';
import { EMPTY_ID } from '@/constants/stage';
import { toStageEmotion } from '@/libs/emoteController/stageExpression';
import { MotionFileType } from '@/libs/emoteController/type';
import { loadEnvironmentManifest } from '@/libs/environment';
import { resolveModelUrl } from '@/libs/localVrm';
import { getPreferredRoomId, setPreferredRoomId } from '@/libs/stageNav/roomPreference';
import * as THREE from 'three';
import { characterSelectors, useCharacterStore } from '@/store/character';
import { useGlobalStore } from '@/store/global';
import { configSelectors, useSettingStore } from '@/store/setting';
import { Character } from '@/types/character';
import { TouchAreaEnum } from '@/types/touch';

import Background from './Background';
import ToolBar from './ToolBar';
import { useStyles } from './style';

interface Props {
  /**
   * 上台的人物（模型 + 展示信息 + 性别）
   */
  character: Character;
  className?: string;
  height?: number | string;
  /**
   * 是否可交互
   */
  interactive?: boolean;
  style?: React.CSSProperties;
  /**
   * 是否显示工具栏
   */
  toolbar?: boolean;
  width?: number | string;
}

/** 触摸反应的无动作持续时长，到点回到待机 */
const TOUCH_REACTION_DURATION = 3000;

/**
 * 人物渲染器
 *
 * 原来叫 AgentViewer：按 agentId 去 agent 商店里找资料、再从市场拉模型。
 * agent 概念删掉后，这里直接吃一个本地 Character（模型地址是 /assets/... 的静态文件），
 * 触摸反应则从设置的全局触摸配置里按性别取。
 */
function CharacterViewer(props: Props) {
  const { className, style, height, character, width, interactive = true, toolbar = true } = props;
  const { styles } = useStyles();
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useGlobalStore((s) => s.viewer);
  const moveLocked = useCharacterStore(characterSelectors.moveLocked);
  const { t } = useTranslation('welcome');

  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  /**
   * 触摸回调的最新版本
   *
   * `viewer.setup(canvas, cb)` 只会在挂画布时调一次，而某个触摸部位的反应依赖
   * 「此刻的交互开关和触摸设定」。用 ref 转一道，画布只挂一次，回调永远读最新值。
   */
  const touchHandlerRef = useRef<(area: TouchAreaEnum) => boolean | void>(() => false);

  /**
   * 移动锁 → 3D 那一层
   *
   * 锁的状态在 store 里（操作条那颗按钮改它），这里只负责同步：
   * - viewer 管点击（点地面/箭头/座面）、悬停箭头
   * - navigator 管自己起身闲逛、坐下
   * 两处都要同步，少一处就会出现「锁了还能自己走两步」。
   */
  useEffect(() => {
    viewer?.setMovementLocked(moveLocked);
  }, [viewer, moveLocked]);

  const getTouchActions = useSettingStore(
    (s) => (area: TouchAreaEnum) =>
      configSelectors.getTouchActionsByGenderAndArea(s, character.gender, area),
  );

  /**
   * 触摸反应（读「设置 → 触摸」里按部位配的动作）
   *
   * 返回 true 表示这一下由设定接手了，viewer 就不会再播默认反应。
   * 两级来源：
   * 1. `clipId`：动作库里的真实片段（151 个 .vrma），走 navigator 播，带看门狗；
   * 2. `motion`：旧预设（17 个），走 emoteController 的预设映射。
   * 两条路都先按部位把表情盖上去，动作结束后由世界那套（或 3 秒计时）收回待机。
   */
  const handleTouchArea = (area: TouchAreaEnum): boolean => {
    if (!interactive) return false;

    const currentTouch = getTouchActions(area);
    console.error(
      `[touch] call ${area} interactive=${interactive} count=${currentTouch?.length ?? 'null'}`,
    );
    if (!currentTouch || currentTouch.length === 0) {
      console.error(`[touch] ${area} → 未配置，退回默认反应`);
      return false;
    }

    const touchAction = currentTouch[Math.floor(Math.random() * currentTouch.length)];
    if (!touchAction) return false;

    // 坐着的时候播站姿片段会把她从椅子上拉起来，这种情况交回世界那套的坐姿反应池
    if (viewer.navigator?.sitting) {
      console.error(`[touch] ${area} → 坐着，交回坐姿反应`);
      return false;
    }

    if (touchAction.clipId) {
      console.error(
        `[touch] ${area} → clip=${touchAction.clipId} loop=${Boolean(touchAction.clipLoop)}`,
      );
      if (viewer.navigator) {
        void viewer.navigator.playTouchClip(
          touchAction.clipId,
          Boolean(touchAction.clipLoop),
          touchAction.expression,
        );
      } else {
        // 没铺房间（纯舞台）时没有世界那套，直接播片段
        const emotion = toStageEmotion(touchAction.expression);
        if (emotion) viewer.model?.emoteController?.expression.set(emotion, 2.2);
        void viewer.model?.playMotionUrl(
          MotionFileType.VRMA,
          `/vrma/${touchAction.clipId}.vrma`,
          Boolean(touchAction.clipLoop),
        );
      }
      return true;
    }

    if (touchAction.motion) {
      console.error(`[touch] ${area} → preset=${touchAction.motion}`);
      viewer.model?.playScreenplay({
        expression: touchAction.expression,
        motion: touchAction.motion,
      });
      window.setTimeout(() => {
        viewer.model?.loadIdleAnimation();
      }, TOUCH_REACTION_DURATION);
      return true;
    }

    console.error(`[touch] ${area} → 动作和片段都为空，退回默认反应`);
    return false;
  };

  // 每次渲染后同步最新回调：挂画布时塞给 viewer 的是一个稳定壳子
  useEffect(() => {
    touchHandlerRef.current = handleTouchArea;
  });

  /**
   * 把人和房间铺到台上
   *
   * 画布会被重新挂载（父组件重渲染、从设置页回来、切一下「触摸交互」都会），
   * 那时候她还在台上：只复位镜头、把循环拉起来，绝不重新下载几十 MB 的模型和房间。
   */
  const preloadCharacterResources = async () => {
    // 性能取证钩子：?perfprobe=1 把 viewer 挂到 window 上，CDP 脚本读 perfStats()
    // 默认路径不会执行，也不影响任何渲染逻辑
    if (new URLSearchParams(window.location.search).has('perfprobe')) {
      (window as unknown as { __divaPerf?: unknown }).__divaPerf = {
        viewer,
        // 和点「设置」按钮走同一个 store 方法：用来验证「打开设置 → 前台立刻停」
        setPanel: (open: boolean) => useGlobalStore.getState().setChatSidebar(open),
      };
    }

    if (viewer.model && viewer.loadedCharacterId === character.id) {
      // 从设置页回来也回到「默认模式」的构图：对脸取景，而不是原来那台默认机位
      if (!viewer.focusCharacter()) viewer.resetCamera();
      viewer.start();
      return;
    }

    setLoading(true);
    setLoadingStep(1);
    try {
      // 步骤一：加载模型。仓库自带的是静态路径，导入的是 `local:<id>`（要先去库里换成 blob URL）
      const modelUrl = await resolveModelUrl(character.modelUrl);
      await viewer.loadVrm(modelUrl, character.id);

      // 铺房间：?dev=1&room=<id> 可以指定；否则铺「上次用过的房间」。
      // **没有偏好就是空舞台**（产品口径，见 roomPreference 的 DEFAULT_ROOM_ID）：
      // 想让她在房间里走位/闲逛，自己去「3D 房间」里挑一间，挑过的那间会被记住。
      const bootParams = new URLSearchParams(window.location.search);
      const roomParam = bootParams.get('dev') !== null ? bootParams.get('room') : null;
      const wantRoomId = roomParam ?? getPreferredRoomId();
      if (wantRoomId && wantRoomId !== EMPTY_ID) {
        const rooms = await loadEnvironmentManifest().catch(() => []);
        const room = rooms.find((item) => item.id === wantRoomId);
        if (room) {
          await viewer.loadEnvironment(room);
          setPreferredRoomId(room.id);
        }
      }

      // 默认模式：进来就把镜头对到她身上（Hanami 的 frameCamera / 操作条那颗聚焦按钮）。
      // 位置必须在房间之后：聚焦要按房间包围盒收镜头，房间没铺好会算出墙外的机位。
      // 后面还有一次「最终机位」——正常的启动路径会走 resetToIdle/房间取景，
      // 那两步都会动镜头；交互关掉时不会走那两步，所以这次先兜住。
      viewer.focusCharacter();

      // 联调钩子：?walk=x,z 走过去；?sit=nearest 坐到最近的座位（验交互用）
      // 这两个都必须等房间就绪：房间没进来之前 navigator 还没有 environment，
      // 直接调用会被当成「目标不可走」而静默失败（之前 ?walk 一直没生效就是这个）。
      const params = new URLSearchParams(window.location.search);
      const whenRoomReady = (cb: () => void) => {
        const tick = () => {
          if (useGlobalStore.getState().viewer?.currentEnvironment) cb();
          else window.setTimeout(tick, 250);
        };
        window.setTimeout(tick, 800);
      };

      // 联调用的 URL 钩子全部收在 ?dev=1 之后：默认进入页面时一条都不会跑。
      const devMode = params.get('dev') !== null;
      if (devMode) {
      // 联调钩子：?panel=1 把右侧设置抽屉打开，方便用脚本去点「3D 房间」里的条目
      if (params.get('panel')) {
        window.setTimeout(() => useGlobalStore.getState().setChatSidebar(true), 1500);
      }
      /** 联调用：?sit 试了几次才坐下（1 = 一次成功） */
      let sittingTries = 0;
      // 联调钩子：?hackknee=20 每帧把膝盖掰到 20°（正 = 反关节方向），验证限位是否真的在动
      // 联调钩子：?hackarm=40 每帧把肘掰到 40°（正 = 屈肘方向）
      const hackKnee = Number(params.get('hackknee'));
      const hackArm = Number(params.get('hackarm'));
      const noLimits = params.get('nolimits') !== null;
      const applyJointLimits = () => {
        const jl = useGlobalStore.getState().viewer?.model?.emoteController?.jointLimits;
        if (!jl) return false;
        if (Number.isFinite(hackKnee) && hackKnee !== 0) jl.forceKneeDeg = hackKnee;
        if (Number.isFinite(hackArm) && hackArm !== 0) jl.forceElbowDeg = hackArm;
        if (noLimits) jl.enabled = false;
        return true;
      };
      if ((Number.isFinite(hackKnee) && hackKnee !== 0) || (Number.isFinite(hackArm) && hackArm !== 0) || noLimits) {
        const timer = window.setInterval(() => {
          if (applyJointLimits()) window.clearInterval(timer);
        }, 400);
      }

      // 联调钩子：?walkdiag=1 每 200 ms 把走路读数打到控制台
      // （截图只能看见某一瞬间，瘸腿是「走着走着」才出现的，得看时间线）
      // 联调钩子：?afk=5 把闲逛间隔压到 5 秒，省得等半分钟才看到她走一次
      const afk = Number(params.get('afk'));
      if (Number.isFinite(afk) && afk > 0) {
        const timer = window.setInterval(() => {
          const nav = useGlobalStore.getState().viewer?.navigator;
          if (!nav) return;
          nav.wanderMinS = afk;
          nav.wanderMaxS = afk;
          window.clearInterval(timer);
        }, 400);
      }

      if (params.get('walkdiag')) {
        // navigator 可能在这一次 render 里还没建好，所以轮询挂上去
        const diagTimer = window.setInterval(() => {
          const nav = useGlobalStore.getState().viewer?.navigator;
          if (!nav) return;
          nav.debugLog = (m: string) => console.error(m);
          window.clearInterval(diagTimer);
        }, 300);
        // 2 秒窗口内的极值：走路是周期运动，单帧分不清「正常摆腿」和「腿被掰成水平」
        const ext = { l0: 180, l1: 0, r0: 180, r1: 0 };
        window.setInterval(() => {
          const live = useGlobalStore.getState().viewer;
          const jl = live?.model?.emoteController?.jointLimits;
          const kn = (jl?.angles ?? [0, 0]).map((v) => (Number.isFinite(v) ? v.toFixed(0) : 'x')).join('/');
          const clip = (live?.model?.emoteController?.currentClipUrl ?? '-').split('/').pop();
          // 腿的几何读数：「半人马」是腿被摆成水平/反向，光看膝盖角看不出来，
          // 所以直接量大腿、小腿在世界空间里偏离「竖直向下」多少度。
          const legs = (() => {
            const humanoid = live?.model?.vrm?.humanoid;
            if (!humanoid) return 'legs=-';
            // 身体整体有没有前倾：「半人马」也可能是躯干被整体掰斜，而不是腿本身
            const hipsNode = humanoid.getNormalizedBoneNode('hips' as never);
            let pitch = 0;
            if (hipsNode) {
              const up = new THREE.Vector3(0, 1, 0).applyQuaternion(hipsNode.getWorldQuaternion(new THREE.Quaternion()));
              pitch = (Math.atan2(Math.hypot(up.x, up.z), up.y) * 180) / Math.PI;
            }
            const read = (upper: string, lower: string, foot: string) => {
              const h = humanoid.getNormalizedBoneNode(upper as never);
              const k = humanoid.getNormalizedBoneNode(lower as never);
              const f = humanoid.getNormalizedBoneNode(foot as never);
              if (!h || !k || !f) return '?';
              const hp = h.getWorldPosition(new THREE.Vector3());
              const kp = k.getWorldPosition(new THREE.Vector3());
              const fp = f.getWorldPosition(new THREE.Vector3());
              const ang = (a: THREE.Vector3) => {
                const v = a.clone().normalize();
                return (Math.acos(Math.max(-1, Math.min(1, -v.y))) * 180) / Math.PI;
              };
              const thigh = ang(kp.clone().sub(hp));
              const shin = ang(fp.clone().sub(kp));
              // 脚趾骨在脚掌前掌处，正常站立时离地 1~3 厘米；它是「脚到底有没有踩在地板上」最直接的读数
              const toe = humanoid.getNormalizedBoneNode(`${upper.replace('UpperLeg', 'Toes')}` as never);
              const toeY = toe ? toe.getWorldPosition(new THREE.Vector3()).y : NaN;
              // 同一条腿在「髋骨本地坐标」里的角度：世界角偏大时，用它分清楚
              // 是片段本身把腿掰过去了，还是外层（根节点/髋）把它转过去了
              let thighLocal = NaN;
              const hipsNode2 = humanoid.getNormalizedBoneNode('hips' as never);
              if (hipsNode2) {
                const hL = hipsNode2.worldToLocal(hp.clone());
                const kL = hipsNode2.worldToLocal(kp.clone());
                const dir = kL.sub(hL).normalize();
                thighLocal = (Math.acos(Math.max(-1, Math.min(1, -dir.y))) * 180) / Math.PI;
              }
              if (upper.startsWith('left')) {
                ext.l0 = Math.min(ext.l0, thigh);
                ext.l1 = Math.max(ext.l1, thigh);
              } else {
                ext.r0 = Math.min(ext.r0, thigh);
                ext.r1 = Math.max(ext.r1, thigh);
              }
              return `${thigh.toFixed(0)}/${shin.toFixed(0)}@y${fp.y.toFixed(2)} loc${thighLocal.toFixed(0)} toe${toeY.toFixed(3)}`;
            };
            return `L=${read('leftUpperLeg', 'leftLowerLeg', 'leftFoot')} R=${read(
              'rightUpperLeg',
              'rightLowerLeg',
              'rightFoot',
            )} thL=${ext.l0.toFixed(0)}~${ext.l1.toFixed(0)} thR=${ext.r0.toFixed(0)}~${ext.r1.toFixed(0)} lean=${pitch.toFixed(0)}`;
          })();
          console.error(
            `[walk] ${live?.navigator?.walkInfo ?? '-'} clip=${clip} knee=${kn} kj=${jl?.clamped ?? 0} ${legs}`,
          );
        }, 600);
      }

      const walkParam = params.get('walk');
      if (walkParam) {
        const [wx, wz] = walkParam.split(',').map(Number);
        if (Number.isFinite(wx) && Number.isFinite(wz)) {
          whenRoomReady(() => {
            const live = useGlobalStore.getState().viewer;
            void live?.navigator?.walkTo(wx, wz);
          });
        }
      }
      if (params.get('sit')) {
        // 坐下是异步的：走到座位 → 播进入片段 → 切坐姿循环，中途任何一步失败外面都看不出来。
        // 所以这里会重试几次，并把次数记到 sittingTries 上，联调时一眼能看出
        // 「一次就成」还是「重试了」。
        //
        // 以前这里是自己在原始座位表里挑最近的，问题是座位表里混着**桌面**和抬高地面块，
        // 挑中桌面就会坐上去 / 走过去失败——这就是「?sit 偶发失败」的真正来源。
        // 现在交给 navigator.sitAtNearestSeat()：它用的是和点击同一套「像椅子」筛选。
        let tries = 0;
        const trySit = () => {
          tries += 1;
          sittingTries = tries;
          const live = useGlobalStore.getState().viewer;
          const navigator = live?.navigator;
          if (!navigator || !navigator.environment) {
            if (tries < 8) window.setTimeout(trySit, 700);
            return;
          }
          if (navigator.sitting) return;
          void navigator.sitAtNearestSeat().then((ok) => {
            if (!ok && tries < 8) window.setTimeout(trySit, 700);
          });
        };
        whenRoomReady(trySit);
      }

      // 联调钩子：?wander=<秒> 打开自动闲逛并把等待压到指定秒数
      const wanderParam = params.get('wander');
      if (wanderParam && viewer.navigator) {
        const seconds = Number(wanderParam);
        viewer.navigator.options.wander = true;
        if (Number.isFinite(seconds) && seconds > 0) {
          viewer.navigator.wanderMinS = seconds;
          viewer.navigator.wanderMaxS = seconds;
        }
      }

      // 联调钩子：?react=head|arm|body 触发「被戳」的反应（坐着时走坐姿反应池）。
      // 坐下要走路，时间点不好预判，所以空闲就再来一次，方便任意时刻截图。
      const reactParam = params.get('react');
      if (reactParam) {
        let reactTries = 0;
        const reactTimer = window.setInterval(() => {
          reactTries += 1;
          const navigator = useGlobalStore.getState().viewer?.navigator;
          const model = useGlobalStore.getState().viewer?.model;
          if (!navigator) return;
          if (params.get('sit') && !navigator.sitting) return;
          if (!model?.isOneShotPlaying) void navigator.react(reactParam);
          if (reactTries > 60) window.clearInterval(reactTimer);
        }, 700);
      }

      // 联调钩子：?hidechar=1 把模型藏起来（判断画面里那团黑到底是她，还是房间几何）
      if (params.get('hidechar')) {
        window.setTimeout(() => {
          const scene = useGlobalStore.getState().viewer?.model?.vrm?.scene;
          if (scene) scene.visible = false;
        }, 6000);
      }

      // 联调钩子：?gazedebug=1 左上角读数（注视角、贴地修正、当前片段、两只脚的世界高度）
      // 联调钩子：?activity=1 直接演一次闲逛活动（验「不只会走路」）
      if (params.get('activity')) {
        window.setTimeout(() => {
          void useGlobalStore.getState().viewer?.navigator?.runWanderActivity();
        }, 9000);
      }

      // 联调钩子：?fidget=1 坐稳之后演一段坐姿小动作（验它播完会回到坐姿待机）
      // 坐下要走路 + 播落座片段，所以轮询到坐稳为止；只演一次，方便验证「播完回来」。
      if (params.get('fidget')) {
        let fidgetTries = 0;
        const fidgetTimer = window.setInterval(() => {
          fidgetTries += 1;
          const navigator = useGlobalStore.getState().viewer?.navigator;
          const model = useGlobalStore.getState().viewer?.model;
          if (navigator?.sitting && !model?.isOneShotPlaying) {
            window.clearInterval(fidgetTimer);
            void navigator.playSeatedFidget();
            return;
          }
          if (fidgetTries > 60) window.clearInterval(fidgetTimer);
        }, 700);
      }

      // 联调钩子：?emotion=happy|sad|angry|surprised|relaxed 压一个表情（验表情映射）
      const emotionParam = params.get('emotion');
      if (emotionParam) {
        window.setInterval(() => {
          useGlobalStore
            .getState()
            .viewer?.model?.emoteController?.expression.set(emotionParam as never, 30);
        }, 500);
      }

      // 联调钩子：?turntest=180 在第 3 秒要求她转这么多度（验转身步片段）
      const turnTest = params.get('turntest');
      if (turnTest !== null) {
        window.setTimeout(() => {
          const navigator = useGlobalStore.getState().viewer?.navigator;
          const root = useGlobalStore.getState().viewer?.model?.navRoot;
          if (!navigator || !root) return;
          navigator.faceDirection(root.rotation.y + (Number(turnTest) * Math.PI) / 180);
        }, 3000);
      }

      if (params.get('gazedebug')) {
        const badge = document.createElement('div');
        badge.style.cssText =
          'position:fixed;left:8px;top:120px;z-index:9999;background:#000c;color:#0f0;' +
          'font:12px monospace;padding:6px 8px;white-space:pre;border-radius:4px';
        document.body.append(badge);
        /** 联调用：膝盖叉积的符号范围，跨零就是反关节 */
        let kneeCrossMin = 99;
        let kneeCrossMax = -99;
        let elbowCrossMin = 99;
        let elbowCrossMax = -99;
        let kneeAngMin = 999;
        let kneeAngMax = -999;
        window.setInterval(() => {
          const live = useGlobalStore.getState().viewer;
          const g = live?.model?.emoteController?.gaze;
          const humanoid = live?.model?.vrm?.humanoid;
          // 膝超伸的判据：用「大腿 × 小腿」的叉积投影到身体的侧向轴上。
          // 膝盖弯曲方向恒定，所以这个带符号量在正常姿势里符号不变；
          // 变号就是反关节。用叉积而不是「膝盖相对髋踝连线的前后偏移」，
          // 后者会被待机变体里胯的前后移位带偏（实测能算出 -20 cm 的假数）。
          const kneeCross = (side: 'left' | 'right') => {
            const hipN = humanoid?.getNormalizedBoneNode(`${side}UpperLeg` as never);
            const kneeN = humanoid?.getNormalizedBoneNode(`${side}LowerLeg` as never);
            const ankleN = humanoid?.getNormalizedBoneNode(`${side}Foot` as never);
            if (!hipN || !kneeN || !ankleN) return 0;
            const hp = hipN.getWorldPosition(new THREE.Vector3());
            const kn = kneeN.getWorldPosition(new THREE.Vector3());
            const an = ankleN.getWorldPosition(new THREE.Vector3());
            const thigh = kn.clone().sub(hp).normalize();
            const shin = an.clone().sub(kn).normalize();
            const cross = new THREE.Vector3().crossVectors(thigh, shin);
            const hipsN = humanoid?.getNormalizedBoneNode('hips' as never);
            const fq = new THREE.Quaternion();
            hipsN?.getWorldQuaternion(fq);
            // 侧向轴：髋骨朝向的 +X
            const sideAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(fq);
            return cross.dot(sideAxis);
          };
          const kcL = kneeCross('left');
          const kcR = kneeCross('right');
          if (kcL < kneeCrossMin) kneeCrossMin = kcL;
          if (kcL > kneeCrossMax) kneeCrossMax = kcL;
          if (kcR < kneeCrossMin) kneeCrossMin = kcR;
          if (kcR > kneeCrossMax) kneeCrossMax = kcR;
          // 肘部同理：肩→肘→腕的叉积投影到侧向轴，符号变了就是反关节。
          const elbowCross = (side: 'left' | 'right') => {
            const sh = humanoid?.getNormalizedBoneNode(`${side}UpperArm` as never);
            const el = humanoid?.getNormalizedBoneNode(`${side}LowerArm` as never);
            const wr = humanoid?.getNormalizedBoneNode(`${side}Hand` as never);
            if (!sh || !el || !wr) return 0;
            const sp = sh.getWorldPosition(new THREE.Vector3());
            const ep = el.getWorldPosition(new THREE.Vector3());
            const wp = wr.getWorldPosition(new THREE.Vector3());
            const upper = ep.clone().sub(sp).normalize();
            const fore = wp.clone().sub(ep).normalize();
            const cross = new THREE.Vector3().crossVectors(upper, fore);
            const hipsN2 = humanoid?.getNormalizedBoneNode('hips' as never);
            const fq2 = new THREE.Quaternion();
            hipsN2?.getWorldQuaternion(fq2);
            const sideAxis2 = new THREE.Vector3(1, 0, 0).applyQuaternion(fq2);
            return cross.dot(sideAxis2);
          };
          // 几何量出来的膝盖屈曲角（度）：大腿方向和小腿方向的夹角，
          // 符号由叉积在髋骨侧向轴上的投影给定（负 = 正常弯曲）。
          // 为什么不用骨骼四元数：四元数拆出来的「扭转角」在大 swing 时是退化的，
          // 实测能给出 +120° 这种不存在的读数；方向向量没有这个问题。
          const hingeAngleDeg = (side: 'left' | 'right') => {
            const hipN = humanoid?.getNormalizedBoneNode(`${side}UpperLeg` as never);
            const kneeN = humanoid?.getNormalizedBoneNode(`${side}LowerLeg` as never);
            const ankleN = humanoid?.getNormalizedBoneNode(`${side}Foot` as never);
            if (!hipN || !kneeN || !ankleN) return 0;
            const hp = hipN.getWorldPosition(new THREE.Vector3());
            const kn = kneeN.getWorldPosition(new THREE.Vector3());
            const an = ankleN.getWorldPosition(new THREE.Vector3());
            const u = kn.clone().sub(hp).normalize();
            const v = an.clone().sub(kn).normalize();
            const cr = new THREE.Vector3().crossVectors(u, v);
            const bend = Math.atan2(cr.length(), u.dot(v));
            const hipsN = humanoid?.getNormalizedBoneNode('hips' as never);
            const fq = new THREE.Quaternion();
            hipsN?.getWorldQuaternion(fq);
            const sideAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(fq);
            const sign = cr.dot(sideAxis) < 0 ? -1 : 1;
            return (sign * bend * 180) / Math.PI;
          };
          const kAngL = hingeAngleDeg('left');
          const kAngR = hingeAngleDeg('right');
          if (kAngL < kneeAngMin) kneeAngMin = kAngL;
          if (kAngL > kneeAngMax) kneeAngMax = kAngL;
          if (kAngR < kneeAngMin) kneeAngMin = kAngR;
          if (kAngR > kneeAngMax) kneeAngMax = kAngR;

          for (const side of ['left', 'right'] as const) {
            const ec = elbowCross(side);
            if (ec < elbowCrossMin) elbowCrossMin = ec;
            if (ec > elbowCrossMax) elbowCrossMax = ec;
          }

          // ?camdebug=1：只打取景那条，别的读数不要——整行太长会被视口切掉尾巴
          // ?camdebug=2：再加「镜头前方 5 条射线打到了什么」（点名挡画面的几何）
          if (params.get('camdebug')) {
            const base =
              `cam=${live?.camSetBy}:${live?.cameraInfo ?? '-'} ` +
              `pos=${live?.navigator?.walkInfo ?? '-'} probe=${live?.camProbe ?? '-'}`;
            badge.textContent =
              params.get('camdebug') === '2'
                ? `${base} occl=${live?.probeOccluders() ?? '-'}`
                : base;
            return;
          }
          badge.textContent = g
            ? `yaw=${g.debug.yaw.toFixed(2)} groundY=${(live?.model?.vrm?.scene.position.y ?? 0).toFixed(2)} ` +
              `clip=${(live?.model?.emoteController?.currentClipUrl ?? '-').split('/').pop()} fade=${live?.model?.emoteController?.lastFade ?? '-'} kNow=${kAngL.toFixed(0)}/${kAngR.toFixed(0)} kj=${live?.model?.emoteController?.jointLimits?.clamped ?? 0} eNow=${(live?.model?.emoteController?.jointLimits?.elbowAngles ?? [0, 0]).map((v) => (Number.isFinite(v) ? v.toFixed(0) : 'x')).join('/')} ej=${live?.model?.emoteController?.jointLimits?.clampedArms ?? 0} seat=${live?.navigator?.sitting ? 'y' : 'n'}/${sittingTries} pick=${live?.lastPick ?? '-'} cam=${live?.camSetBy}:${live?.cameraInfo ?? '-'} face=${live?.navigator?.facingInfo ?? '-'} bb=${live?.boundsInfo ?? '-'} probe=${live?.camProbe ?? '-'}`
            : 'no gaze';
        }, 200);
      }
      // 联调钩子：?clip=world-clap-loop 直接循环播一个片段（验证单段动作/关节）
      const clipParam = params.get('clip');
      if (clipParam) {
        window.setTimeout(() => {
          const live = useGlobalStore.getState().viewer;
          const url = `/vrma/${clipParam}.vrma`;
          void live?.model?.playMotionUrl(MotionFileType.VRMA, url, true);
        }, 4000);
      }

      // 联调钩子：?look=x,y,z 让她看向房间里的某个点（验证脖子/头转向）
      const lookParam = params.get('look');
      if (lookParam) {
        const [lx, ly, lz] = lookParam.split(',').map(Number);
        if ([lx, ly, lz].every(Number.isFinite)) {
          window.setTimeout(() => {
            const live = useGlobalStore.getState().viewer;
            live?.model?.lookAt({ x: lx, y: ly, z: lz });
          }, 2500);
        }
      }

      // 联调钩子：?mark=x,z[,refuse] 在房间地面上循环亮点击标记
      const markParam = params.get('mark');
      if (markParam) {
        const [mx, mz] = markParam.split(',').map(Number);
        const kind = markParam.includes('refuse') ? ('refuse' as const) : ('accept' as const);
        if (Number.isFinite(mx) && Number.isFinite(mz)) {
          const paint = () => {
            if (viewer.navigator) viewer.navigator.showClickFeedback({ x: mx, y: 1.05, z: mz }, kind);
            window.setTimeout(paint, 700);
          };
          paint();
        }
      }
      // 联调钩子：?click=x,y 在画布上发一次真实点击（走完 raycast → 地面 → 走位 整条链）
      // 联调钩子：?hover=x,y 假装鼠标停在这个屏幕坐标（验座位箭头）；
      //            ?hoverclick=1 再补一次点击（验「点箭头就去坐下」）
      const hoverParam = params.get('hover');
      if (hoverParam) {
        const [hx, hy] = hoverParam.split(',').map(Number);
        window.setInterval(() => {
          useGlobalStore.getState().viewer?.debugHover(hx, hy);
        }, 400);
        if (params.get('hoverclick')) {
          // 1 = 点箭头本体（按投影坐标）；2 = 点悬停的那块座面（用户实际会点的位置）
          const mode = params.get('hoverclick');
          window.setTimeout(() => {
            useGlobalStore.getState().viewer?.debugHover(hx, hy);
            window.setTimeout(() => {
              if (mode === '2') useGlobalStore.getState().viewer?.debugClick(hx, hy);
              else useGlobalStore.getState().viewer?.debugClickArrow();
            }, 500);
          }, 3000);
        }
      }

      // 联调钩子：?seatauto=1 扫出画面里第一块能坐的面 → 悬停 → 点它（验换房间后的整条通路）
      if (params.get('seatauto')) {
        window.setTimeout(() => {
          const viewer = useGlobalStore.getState().viewer;
          const hit = viewer?.debugFindSeat();
          if (!hit) {
            console.error('[sweep] no-seat');
            return;
          }
          console.error(`[sweep] ${hit.id} @${hit.x},${hit.y}`);
          viewer?.debugHover(hit.x, hit.y);
          window.setTimeout(() => viewer?.debugClick(hit.x, hit.y), 700);
        }, 4000);
      }

      // 联调钩子：?floorafter=x,y 在 9 秒后点一下那块地面（验「坐着点地面起身走」）
      const floorAfter = params.get('floorafter');
      if (floorAfter) {
        const [fx, fy] = floorAfter.split(',').map(Number);
        window.setTimeout(() => {
          useGlobalStore.getState().viewer?.debugClick(fx, fy);
        }, 9000);
      }

      // 联调钩子：?escape=1 坐下之后连点 5 次「走不到的远处」，
      // 验防卡死是不是在第 5 下把人强制放到地面（?seatauto=1 先坐上去）
      if (params.get('escape')) {
        window.setTimeout(async () => {
          const nav = useGlobalStore.getState().viewer?.navigator;
          if (!nav) {
            console.error('[escape] no navigator');
            return;
          }
          for (let i = 1; i <= 5; i++) {
            const r = await nav.handleFloorPoint({ x: 40, z: 40 });
            console.error(`[escape] click ${i} → ${r}`);
            await new Promise((resolve) => {
              setTimeout(resolve, 400);
            });
          }
          // 逃生之后还能不能正常走：再点一次出生点附近的地面
          await new Promise((resolve) => {
            setTimeout(resolve, 1200);
          });
          const walk = await nav.handleFloorPoint({ x: 0, z: 0 });
          console.error(`[escape] walk-after → ${walk}`);
          const navRoot = useGlobalStore.getState().viewer?.model?.navRoot;
          console.error(
            `[escape] done sitting=${nav.sitting} pos=${navRoot ? `${navRoot.position.x.toFixed(2)},${navRoot.position.z.toFixed(2)}` : 'no-root'}`,
          );
        }, 9000);
      }

      // 联调钩子：?camat=y,dist 把取景压到脚上（正常取景把脚切在画面外，验不了「有没有踩进地板」）
      const camAt = params.get('camat');
      if (camAt) {
        const [ty, dist] = camAt.split(',').map(Number);
        window.setInterval(() => {
          useGlobalStore.getState().viewer?.setDebugCamera(ty, dist);
        }, 300);
      }

      // 联调钩子：?noik=1 关掉逐腿 IK，用来做前后对照
      // 注意走位每帧都会重新打开 IK，所以必须从 navigator 的开关进
      if (params.get('noik')) {
        window.setInterval(() => {
          const live = useGlobalStore.getState().viewer;
          if (!live) return;
          live.model?.setFootPlanting(false);
          if (live.navigator) live.navigator.ikDisabled = true;
        }, 100);
      }

      // 联调钩子：?lock=1 / ?lock=0 直接把移动锁设成某一边（锁会持久化，验收要能翻回来）
      const lockParam = params.get('lock');
      if (lockParam !== null) {
        useCharacterStore.setState({ moveLocked: lockParam === '1' });
        const liveViewer = useGlobalStore.getState().viewer;
        if (liveViewer) liveViewer.touchDebug = true;
      }

      // 联调钩子：?touchonly=foot 只点一个部位（截「动作正在播」的那一帧用）
      const touchOnly = params.get('touchonly');
      if (touchOnly) {
        const runOne = () => {
          const live = useGlobalStore.getState().viewer;
          if (!live || !live.currentEnvironment) {
            window.setTimeout(runOne, 300);
            return;
          }
          live.touchDebug = true;
          const spot = live.debugTouchScreens().find((s) => s.area === touchOnly);
          if (!spot) {
            console.error(`[touchonly] 没有这个部位：${touchOnly}`);
            return;
          }
          // 每 1.2 秒补一下：截图什么时候落地都能拍到「动作正在播」，不用赌时机
          let left = 6;
          const tick = () => {
            if (left-- <= 0) return;
            live.debugClick(spot.x, spot.y);
            window.setTimeout(tick, 1200);
          };
          tick();
        };
        window.setTimeout(runOne, 2500);
      }

      // 联调钩子：?touchprobe=1 让骨骼自己指出七个触摸部位的屏幕位置，
      // 再逐点真点一下——验「点哪个部位 → 播哪条设定动作」这条链
      if (params.get('touchprobe')) {
        const runProbe = () => {
          const live = useGlobalStore.getState().viewer;
          if (!live || !live.currentEnvironment) {
            window.setTimeout(runProbe, 300);
            return;
          }
          const spots = live.debugTouchScreens();
          live.touchDebug = true;
          console.error(
            '[touchprobe] spots ' +
              spots
                .map(
                  (s) => `${s.area}${s.hit ? '' : '(miss)'}@${s.x.toFixed(0)},${s.y.toFixed(0)}`,
                )
                .join(' '),
          );
          spots.forEach((spot, i) => {
            window.setTimeout(() => {
              console.error(`[touchprobe] click ${spot.area} hit=${spot.hit}`);
              live.debugClick(spot.x, spot.y);
            }, 600 + i * 900);
          });
        };
        window.setTimeout(runProbe, 2500);
      }

      const clickParam = params.get('click');
      if (clickParam) {
        const [cx, cy] = clickParam.split(',').map(Number);
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          // 房间加载完成之后再点：固定 1200ms 太早，那会儿场景还没进来，
          // 射线打不到任何东西，等于没点。
          const tryClick = () => {
            const ready = useGlobalStore.getState().viewer?.currentEnvironment;
            if (!ready) {
              window.setTimeout(tryClick, 250);
              return;
            }
            document
              .getElementById('vrm-canvas')
              ?.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true }));
          };
          window.setTimeout(tryClick, 1200);
        }
      }
      }

      // 动作不再在启动时把 17 条预设全部下载解析一遍：
      // 每条的片段都是按需加载（playMotionUrl 自带缓存），启动时只留待机那一条。
      // 这样首屏少 2~5 MB 的请求和解析，进入舞台的时间也短一截。
      if (useCharacterStore.getState().interactive) {
        viewer.resetToIdle();
      }

      // 默认模式：镜头对脸。必须放在最后 —— 上面 resetToIdle() 内部会 resetCamera
      // 把机位拉回「胸口高度 + 1.4 m 开外」，房间加载也会 frameToRoom 覆盖一次，
      // 所以这段要排在它们之后跑，才是最终机位。
      viewer.focusCharacter();

      // 联调钩子：?motion=<片段 id> 直接在台上演一个动作库里的片段（见 public/vrma/index.json）
      const probe = new URLSearchParams(window.location.search).get('motion');
      if (probe) {
        void viewer.model?.playMotionUrl(MotionFileType.VRMA, `/vrma/${probe}.vrma`, true);
      }
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
      setLoadingStep(0);
    }
  };

  /**
   * 画布挂载
   *
   * 依赖只留 viewer：以前依赖里带着 interactive / character.id，切一下「触摸交互」
   * 就会让 React 重新执行一遍 ref 回调 → 又建一个渲染器、又开一条渲染循环、
   * 又下载一遍模型。setup 内部也做了幂等保护，两头都不再重复。
   */
  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      // 卸载画布（切到设置页 / 换人重挂）：停循环、放掉 GL 上下文
      if (!canvas) {
        viewer.teardown();
        return;
      }
      viewer.setup(canvas, (area) => touchHandlerRef.current(area));

      // Drag and DropでVRMを差し替え
      canvas.addEventListener('dragover', function (event) {
        event.preventDefault();
      });

      canvas.addEventListener('drop', function (event) {
        event.preventDefault();

        const files = event.dataTransfer?.files;
        if (!files) {
          return;
        }

        const file = files[0];
        if (!file) {
          return;
        }

        const file_type = file.name.split('.').pop();
        switch (file_type) {
          case 'vrm': {
            const blob = new Blob([file], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            viewer.loadVrm(url);

            break;
          }
          case 'fbx': {
            const blob = new Blob([file], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            viewer.model?.playMotionUrl(MotionFileType.FBX, url);

            break;
          }
          case 'pmx': {
            const blob = new Blob([file], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            viewer.loadStage(url);
            break;
          }
          case 'vmd': {
            const blob = new Blob([file], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            viewer.model?.playMotionUrl(MotionFileType.VMD, url);

            break;
          }
          case 'vrma': {
            const blob = new Blob([file], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            viewer.model?.playMotionUrl(MotionFileType.VRMA, url);
            break;
          }
          // No default
        }
      });
    },
    [viewer],
  );

  /**
   * 上台：只在人物变化时铺一次（挂画布不再触发下载）
   *
   * 以前这件事是塞在 ref 回调里跟着画布走的：画布重挂一次就把模型和房间
   * 重新下载解析一遍。现在模型认 character.id，房间认上次进入的那间，
   * 重挂画布只走 `preloadCharacterResources` 开头的「复位镜头」快路。
   */
  useEffect(() => {
    if (!viewer.isReady) return;
    void preloadCharacterResources();
    // 人物由 character.id 决定；其余入参变了不该重下模型
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, viewer]);

  const handleFullscreen = useCallback(() => {
    if (!ref.current) return;

    if (!document.fullscreenElement) {
      ref.current.requestFullscreen().catch((err) => {
        console.error(`全屏错误: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.error(`退出全屏错误: ${err.message}`);
      });
    }
  }, []);

  return (
    <div
      ref={ref}
      className={classNames(styles.viewer, className)}
      id="character-viewer"
      style={{ height, width, ...style }}
    >
      {toolbar && (
        <ToolBar className={styles.toolbar} viewer={viewer} onFullscreen={handleFullscreen} />
      )}
      {loading ? (
        <ScreenLoading
          title={t('loading.waiting')}
          className={styles.loading}
          description={loadingStep === 1 ? t('loading.model') : undefined}
        />
      ) : null}
      <canvas ref={canvasRef} className={styles.canvas} id={'vrm-canvas'}></canvas>
      <Background />
    </div>
  );
}

export default memo(CharacterViewer);
