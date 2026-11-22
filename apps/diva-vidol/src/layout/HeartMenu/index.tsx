'use client';

import { message } from 'antd';
import { Check, Clapperboard, Heart, Mountain, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { EnvironmentRoomMeta, loadEnvironmentManifest, roomLabel } from '@/libs/environment';
import { setPreferredRoomId } from '@/libs/stageNav/roomPreference';
import { HeaderNavKey, HeaderNavPath } from '@/layout/type';
import { useGlobalStore } from '@/store/global';

import { useStyles } from './style';

/**
 * 左上角的浮动入口
 *
 * 原来左边一整条导航栏占掉 60px 宽度，舞台上那块地里没有可点的东西——现在整个去掉，
 * 只留一颗心：**点一下向下弹出菜单**，里面就是原来侧栏的内容（舞台 / 设置 / 场景）。
 *
 * 场景那一项做成菜单里的内联列表，不需要再点第二层弹窗；选定之后写进 `roomPreference`，
 * 下次打开页面直接铺回来。
 */
const HeartMenu = () => {
  const { styles, cx } = useStyles();
  const router = useRouter();
  const { t } = useTranslation('common');
  const activeKey = useActiveTabKey();
  const onStage = activeKey === HeaderNavKey.Stage;
  const viewer = useGlobalStore((s) => s.viewer);

  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<EnvironmentRoomMeta[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  // 服务端和客户端取到的语言不一定一样（服务端渲染中文、客户端第一帧还没拿到字典），
  // 直接把 t() 写进 JSX 会触发 hydration 不匹配。菜单默认是收起的，等挂载后再填文字。
  const [labels, setLabels] = useState<{ settings: string; stage: string } | null>(null);

  useEffect(() => {
    setLabels({ settings: t('header.settings'), stage: t('header.stage') });
  }, [t]);

  // 房间清单（导入时量过可行走面积和座位数）
  useEffect(() => {
    loadEnvironmentManifest()
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  // viewer 里「当前是哪间」不在 store 里，菜单开着的时候轮询同步一下
  useEffect(() => {
    if (!open) return;
    const sync = () => setCurrent(viewer?.currentEnvironment?.id);
    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, [open, viewer]);

  // 点外面 / 按 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const go = useCallback(
    (key: HeaderNavKey) => {
      setOpen(false);
      router.push(HeaderNavPath[key]);
    },
    [router],
  );

  const switchTo = useCallback(
    async (room: EnvironmentRoomMeta) => {
      if (!viewer || loadingId) return;
      setLoadingId(room.id);
      try {
        await viewer.loadEnvironment(room);
        setPreferredRoomId(room.id);
        setCurrent(room.id);
        setOpen(false);
      } catch (error) {
        message.error(`房间加载失败：${(error as Error).message}`);
      } finally {
        setLoadingId(null);
      }
    },
    [viewer, loadingId],
  );

  const clearStage = useCallback(() => {
    if (!viewer) return;
    viewer.unloadEnvironment();
    setCurrent(undefined);
    setOpen(false);
  }, [viewer]);

  // 设置页有自己的左侧分类栏，这颗心在那儿只会压住标题——舞台以外不显示
  // （回舞台的入口放在设置侧栏顶部，见 settings/_layout/Desktop/SideBar.tsx）
  if (!onStage) return null;

  return (
    <div className={cx(styles.dock, 'stage-heart-dock')} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="菜单"
        className={cx(styles.heart, 'stage-heart-button')}
        data-open={open}
        onClick={() => setOpen((value) => !value)}
        title="菜单"
        type="button"
      >
        <Heart fill="currentColor" size={19} />
      </button>

      <div className={cx(styles.menu, 'stage-heart-menu')} data-open={open} role="menu">
        <button
          className={styles.item}
          data-active={onStage}
          onClick={() => go(HeaderNavKey.Stage)}
          role="menuitem"
          type="button"
        >
          <Clapperboard size={15} />
          {labels ? labels.stage : null}
        </button>

        <button
          className={styles.item}
          data-active={!onStage}
          onClick={() => go(HeaderNavKey.Settings)}
          role="menuitem"
          type="button"
        >
          <Settings2 size={15} />
          {labels ? labels.settings : null}
        </button>

        <div className={styles.divider} />

        <div className={styles.label}>
          <Mountain size={12} />
          场景
        </div>

        <div className={styles.rooms}>
          {rooms.length === 0 ? <div className={styles.empty}>清单加载中……</div> : null}

          {rooms.map((room) => {
            const isActive = current === room.id;
            return (
              <button
                className={styles.room}
                data-active={isActive}
                data-room={room.id}
                disabled={Boolean(loadingId)}
                key={room.id}
                onClick={() => void switchTo(room)}
                type="button"
              >
                <span className={styles.mark}>{isActive ? <Check size={13} /> : null}</span>
                <span className={styles.roomBody}>
                  <span className={styles.roomName}>{roomLabel(room)}</span>
                  <span className={styles.roomDetail}>
                    {room.walkArea ?? '?'} m² · {room.seats} 座
                  </span>
                </span>
              </button>
            );
          })}

          <button
            className={styles.room}
            disabled={Boolean(loadingId)}
            onClick={clearStage}
            type="button"
          >
            <span className={styles.mark} />
            <span className={styles.roomBody}>
              <span className={styles.roomName}>空舞台</span>
              <span className={styles.roomDetail}>收起房间，只留人物</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default HeartMenu;
