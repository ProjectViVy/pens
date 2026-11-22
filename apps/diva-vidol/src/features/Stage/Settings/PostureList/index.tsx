import { createStyles } from 'antd-style';
import classNames from 'classnames';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Header from '@/components/Header';
import { LIST_GRID_GAP, LIST_GRID_HEIGHT, LIST_GRID_WIDTH } from '@/constants/token';
import { posturePresetMap, posturePresets } from '@/libs/emoteController/posturePresets';
import { useGlobalStore } from '@/store/global';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    height: 100%;
    padding: 0 ${token.paddingSM}px;

    background-color: rgba(255, 255, 255, 2%);
    border-radius: ${token.borderRadius}px;
  `,
  grid: css`
    display: grid;
    grid-auto-flow: row;
    grid-auto-rows: minmax(${LIST_GRID_HEIGHT}px, auto);
    grid-gap: ${LIST_GRID_GAP}px;
    grid-template-columns: repeat(auto-fill, minmax(${LIST_GRID_WIDTH}px, 1fr));
  `,
  card: css`
    cursor: pointer;

    position: relative;

    display: flex;
    align-items: flex-end;

    overflow: hidden;

    padding: ${token.paddingXS}px;

    border: 2px solid ${token.colorBgContainer};
    border-radius: ${token.borderRadius}px;

    transition: border-color 0.2s ${token.motionEaseInOut};

    &:hover {
      border-color: ${token.colorPrimaryBorder};
    }
  `,
  cardActive: css`
    border-color: ${token.colorPrimary};
  `,
  glyph: css`
    position: absolute;
    top: 6px;
    right: 8px;

    font-size: 22px;
    line-height: 1;
    opacity: 0.55;
  `,
  name: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    padding: 2px 4px;

    font-size: ${token.fontSizeSM}px;
    line-height: 16px;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background-color: ${token.colorBgContainer};
    border-radius: ${token.borderRadiusSM}px;
    opacity: 0.9;
  `,
  hint: css`
    padding: ${token.paddingSM}px ${token.paddingXS}px;
    font-size: ${token.fontSizeSM}px;
    line-height: 1.6;
    color: ${token.colorTextTertiary};
  `,
}));

const GLYPHS: Record<string, string> = {
  idle: '💤',
  stand: '🧍',
  handsOnHips: '🦸',
  armsCrossed: '🙅',
  raiseHand: '🙋',
  sit: '🪑',
  squat: '🧎',
};

interface PostureListProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 姿势列表
 *
 * 数据源是 `posturePresets` 里的程序化骨骼姿势（项目里没有任何 vrma / fbx / vmd
 * 姿势素材，所以姿势全部是代码直接摆骨骼摆出来的，不依赖静态资源）。
 * 点一下把姿势写到台上人物的 normalized 骨骼上，再点一次同一张回到待机。
 */
const PostureList = ({ className, style }: PostureListProps) => {
  const { t } = useTranslation('chat');
  const { styles, theme } = useStyles();
  const viewer = useGlobalStore((s) => s.viewer);

  // 抽屉切走页签会卸载组件，初始高亮从 model 里读回来，避免「姿势还摆着但卡片不亮了」
  const [activeId, setActiveId] = useState<string | undefined>(
    () => viewer.model?.currentPostureId,
  );

  const presets = useMemo(() => posturePresets, []);

  /**
   * 姿势到位后重新对镜头
   *
   * 坐下 / 蹲下会把髋部整体压低 0.36~0.43m，固定机位下腿会被切到画面外。
   * 姿势过渡是 0.4s，所以在过渡结束后把镜头重新对到胸口高度；压低重心的姿势再把镜头往后退一点，
   * 让整条腿进画面。
   */
  const refocusCamera = (id?: string) => {
    const drop = id ? Math.abs(posturePresetMap[id]?.hipsPosition?.[1] || 0) : 0;
    window.setTimeout(() => viewer.resetCamera(drop > 0.2 ? 0.6 : 0), 460);
  };

  const handleSelect = (id: string) => {
    const model = viewer.model;
    if (!model) return;

    // 再点一次同一张，或者点「待机」，都是取消姿势回到待机
    if (id === 'idle' || activeId === id) {
      setActiveId(undefined);
      model.clearPosture();
      refocusCamera();
      return;
    }

    setActiveId(id);
    model.applyPosture(id);
    refocusCamera(id);
  };

  return (
    <Flexbox className={classNames(className, styles.container)} style={style}>
      <Header title={t('info.posture')} extra={t('postureList', { total: presets.length })} />
      <div className={styles.grid}>
        {presets.map((preset, index) => {
          const hue = 200 - (index % 6) * 26;

          return (
            <div
              key={preset.id}
              className={classNames(styles.card, activeId === preset.id && styles.cardActive)}
              style={{
                background: `linear-gradient(140deg, ${theme.colorPrimaryBg} 0%, hsl(${hue}, 62%, 88%) 100%)`,
              }}
              title={preset.name}
              onClick={() => handleSelect(preset.id)}
            >
              <span className={styles.glyph}>{GLYPHS[preset.id] || '🧍'}</span>
              <span className={styles.name}>{preset.name}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.hint}>{t('postureHint')}</div>
    </Flexbox>
  );
};

export default PostureList;
