import { createStyles } from 'antd-style';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Header from '@/components/Header';
import { LIST_GRID_GAP, LIST_GRID_HEIGHT, LIST_GRID_WIDTH } from '@/constants/token';
import { MotionFileType } from '@/libs/emoteController/type';
import {
  clipsOf,
  loadMotionIndex,
  MOTION_CATEGORIES,
  MotionCategory,
  MotionClipMeta,
  MotionIndex,
} from '@/libs/motionLibrary';
import { useGlobalStore } from '@/store/global';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    height: 100%;
    padding: 0 ${token.paddingSM}px;

    background-color: rgba(255, 255, 255, 2%);
    border-radius: ${token.borderRadius}px;
  `,
  tabs: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: ${token.paddingXS}px 0;
  `,
  tab: css`
    cursor: pointer;

    padding: 2px 10px;

    font-size: ${token.fontSizeSM}px;
    color: ${token.colorTextSecondary};

    background: ${token.colorFillQuaternary};
    border-radius: 999px;

    &:hover {
      color: ${token.colorText};
    }
  `,
  tabActive: css`
    color: ${token.colorTextLightSolid};
    background: ${token.colorPrimary};
  `,
  scroll: css`
    overflow-y: auto;
    flex: 1;
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
  meta: css`
    position: absolute;
    top: 4px;
    right: 6px;

    font-size: 10px;
    color: ${token.colorTextQuaternary};
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
    padding: ${token.paddingXS}px 0 ${token.paddingSM}px;
    font-size: ${token.fontSizeSM}px;
    line-height: 1.6;
    color: ${token.colorTextTertiary};
  `,
}));

interface MotionListProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 动作库面板
 *
 * 数据源是 `public/vrma/index.json`（151 个 .vrma，Hanami 素材）。
 * 点一张卡片 = 在那个动作上直接演；一次性动作播完自动回待机（MotionController 负责）。
 */
const MotionList = ({ className, style }: MotionListProps) => {
  const { t } = useTranslation('chat');
  const { styles, theme } = useStyles();
  const viewer = useGlobalStore((s) => s.viewer);

  const [index, setIndex] = useState<MotionIndex | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<MotionCategory>('emotion');
  const [playingId, setPlayingId] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadMotionIndex()
      .then(setIndex)
      .catch((e) => setError(String(e)));
  }, []);

  const clips = useMemo(() => (index ? clipsOf(index, category) : []), [index, category]);
  const total = index?.counts.total ?? 0;

  const handlePlay = async (clip: MotionClipMeta) => {
    if (!viewer?.model) return;
    setPlayingId(clip.id);
    try {
      await viewer.model.playMotionUrl(MotionFileType.VRMA, clip.file, clip.loop);
    } finally {
      // 循环片段会一直播，这里只给一个短点亮
      window.setTimeout(() => setPlayingId((id) => (id === clip.id ? undefined : id)), 900);
    }
  };

  return (
    <Flexbox className={classNames(className, styles.container)} style={style}>
      <Header
        title={t('info.motion')}
        extra={index ? `${clips.length} / ${total}` : '…'}
      />
      <div className={styles.tabs}>
        {MOTION_CATEGORIES.map((item) => (
          <span
            key={item.key}
            className={classNames(styles.tab, category === item.key && styles.tabActive)}
            onClick={() => setCategory(item.key)}
          >
            {item.label}
            {index?.counts.byCategory[item.key]
              ? ` ${index.counts.byCategory[item.key]}`
              : ''}
          </span>
        ))}
      </div>
      <div className={styles.scroll}>
        {error && <div className={styles.hint}>{error}</div>}
        {!error && !index && <div className={styles.hint}>动作索引加载中…</div>}
        {index && (
          <div className={styles.grid}>
            {clips.map((clip, i) => {
              const hue = 200 - (i % 6) * 26;
              return (
                <div
                  key={clip.id}
                  className={classNames(styles.card, playingId === clip.id && styles.cardActive)}
                  style={{
                    background: `linear-gradient(140deg, ${theme.colorPrimaryBg} 0%, hsl(${hue}, 62%, 88%) 100%)`,
                  }}
                  title={`${clip.id}${clip.role ? ` — ${clip.role}` : ''}${clip.credit ? ` (${clip.credit} · ${clip.license})` : ''}`}
                  onClick={() => handlePlay(clip)}
                >
                  <span className={styles.meta}>
                    {clip.durationS ? `${clip.durationS.toFixed(1)}s` : ''}
                    {clip.loop ? ' ↻' : ''}
                  </span>
                  <span className={styles.name}>{clip.label || clip.id}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.hint}>
        素材：Overte（Apache-2.0）、Microsoft Rocketbox（MIT）、Quaternius（CC0）。
        单击即演；手势播完自动回待机。
      </div>
    </Flexbox>
  );
};

export default MotionList;
