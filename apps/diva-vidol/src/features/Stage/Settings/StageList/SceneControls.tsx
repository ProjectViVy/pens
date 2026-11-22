import { createStyles } from 'antd-style';
import React, { useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useGlobalStore } from '@/store/global';

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding: ${token.paddingXS}px 0;

    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  label: css`
    font-size: ${token.fontSizeSM}px;
    color: ${token.colorText};
  `,
  desc: css`
    padding-top: 2px;
    font-size: 11px;
    line-height: 1.5;
    color: ${token.colorTextTertiary};
  `,
  info: css`
    padding-bottom: ${token.paddingXS}px;
    font-size: ${token.fontSizeSM}px;
    line-height: 1.7;
    color: ${token.colorTextSecondary};
  `,
}));

/**
 * 场景行为开关
 *
 * 房间本身在「舞台」页选；这里管铺上房间之后的行为：
 * 点地面移动、点座位坐下、自动闲逛，以及站起来/回出生点。
 */
const SceneControls = () => {
  const { styles } = useStyles();
  const viewer = useGlobalStore((s) => s.viewer);

  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate((n) => n + 1);

  useEffect(() => {
    const timer = window.setInterval(refresh, 800);
    return () => window.clearInterval(timer);
  }, []);

  const navigator = viewer?.navigator;
  const room = viewer?.currentEnvironment?.scene;

  const toggle = (key: 'clickMove' | 'clickSit' | 'wander', value: boolean) => {
    if (!navigator) return;
    navigator.options[key] = value;
    refresh();
  };

  return (
    <Flexbox>
      <div className={styles.info}>
        {room
          ? `可行走 ${room.room.walkArea.toFixed(1)} m² · 座位 ${room.seats.length} 个 · 状态：${
              navigator?.isSitting ? '坐着' : navigator?.isWalking ? '走着' : '待机'
            }`
          : '还没铺房间。下面选一个 3D 房间，铺上之后点地面就能让她走过去。'}
      </div>

      {(
        [
          ['clickMove', '点地面走过去', '点到地板就转身走过去，不是瞬移'],
          ['clickSit', '点座位坐下', '点在座位附近就坐下，坐下后是坐姿待机循环'],
          ['wander', '自动闲逛', '待机 45~120 秒后自己在附近走两步'],
        ] as const
      ).map(([key, label, desc]) => (
        <div key={key} className={styles.row}>
          <div>
            <div className={styles.label}>{label}</div>
            <div className={styles.desc}>{desc}</div>
          </div>
          <input
            checked={navigator?.options[key] ?? false}
            disabled={!navigator || !room}
            style={{ accentColor: '#1677ff' }}
            type="checkbox"
            onChange={(event) => toggle(key, event.target.checked)}
          />
        </div>
      ))}

      <Flexbox gap={8} horizontal paddingBlock={10}>
        <button
          disabled={!navigator?.isSitting}
          style={{ cursor: 'pointer', fontSize: 12, padding: '2px 10px' }}
          type="button"
          onClick={() => {
            void navigator?.standUp();
          }}
        >
          站起来
        </button>
        <button
          disabled={!room}
          style={{ cursor: 'pointer', fontSize: 12, padding: '2px 10px' }}
          type="button"
          onClick={() => {
            // 房间被摆到角色脚下，所以「出生点」就是世界原点
            void navigator?.walkTo(0, 0);
          }}
        >
          回出生点
        </button>
      </Flexbox>
    </Flexbox>
  );
};

export default SceneControls;
