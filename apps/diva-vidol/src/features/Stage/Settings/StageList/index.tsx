import { message } from 'antd';
import { createStyles } from 'antd-style';
import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import GridList from '@/components/GridList';
import Header from '@/components/Header';
import { EMPTY_ID, StageOption, stageList } from '@/constants/stage';
import { EnvironmentRoomMeta, loadEnvironmentManifest, roomLabel } from '@/libs/environment';
import { getPreferredRoomId, setPreferredRoomId } from '@/libs/stageNav/roomPreference';
import { useGlobalStore } from '@/store/global';

import SceneControls from './SceneControls';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow-y: auto;
    width: 100%;
    height: 100%;
    padding: 0 ${token.paddingSM}px;

    background-color: rgba(255, 255, 255, 2%);
    border-radius: ${token.borderRadius}px;
  `,
  section: css`
    padding-top: ${token.paddingXS}px;
  `,
}));

interface StageListProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 舞台面板
 *
 * 两段：
 * 1. **3D 房间** —— Hanami 移植过来的 `.glb` 房间（`public/environments/`），
 *    每个房间带导入时量好的可行走面积与座位数；载入后角色站到房间出生点。
 * 2. **PMX 舞台** —— 项目原有的 MMD 舞台。
 */
const StageList = ({ className, style }: StageListProps) => {
  const { t } = useTranslation('chat');
  const { styles } = useStyles();
  const viewer = useGlobalStore((s) => s.viewer);

  const [stageId, setStageId] = useState<string | undefined>(undefined);
  const [loadingStage, setLoadingStage] = useState(false);

  const [rooms, setRooms] = useState<EnvironmentRoomMeta[]>([]);
  // 首页启动时会自动铺「上次用过的房间」，所以这里的初始高亮也跟它对齐
  const [roomId, setRoomId] = useState<string | undefined>(() => getPreferredRoomId());
  const [loadingRoom, setLoadingRoom] = useState(false);

  useEffect(() => {
    loadEnvironmentManifest()
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  const handleStageClick = async (id: string, item: StageOption) => {
    setStageId(id);
    setRoomId(undefined);
    if (id === EMPTY_ID) {
      viewer.removeStage();
      return;
    }
    setLoadingStage(true);
    try {
      if (item.url) await viewer.loadStage(item.url);
    } catch {
      message.error('舞台模型加载失败');
    } finally {
      setLoadingStage(false);
    }
  };

  const handleRoomClick = async (id: string) => {
    setRoomId(id);
    setStageId(undefined);
    if (id === EMPTY_ID) {
      viewer.unloadEnvironment();
      return;
    }
    // 注意：GridList 回传的是它自己拼的条目（只有 id/name/detail/spin），
    // 不是 manifest 里的房间元数据。之前把条目直接当 meta 交给 loadEnvironment，
    // 少了模型地址，于是每次都抛错、房间根本铺不上。必须按 id 回到 rooms 里取。
    const room = rooms.find((item) => item.id === id);
    if (!room) return;
    setLoadingRoom(true);
    try {
      await viewer.loadEnvironment(room);
      // 记住这间：下次打开页面直接铺回来，不用每次重新选
      setPreferredRoomId(room.id);
    } catch (error) {
      message.error(`房间加载失败：${(error as Error).message}`);
    } finally {
      setLoadingRoom(false);
    }
  };

  return (
    <Flexbox className={classNames(className, styles.container)} style={style}>
      <SceneControls />

      <div className={styles.section}>
        <Header title="3D 房间" extra={`${rooms.length + 1}`} />
        <GridList
          items={[
            { id: EMPTY_ID, name: '空舞台' },
            ...rooms.map((room) => ({
              id: room.id,
              name: roomLabel(room),
              detail: `${room.walkArea ?? '?'} m² · ${room.seats} 座`,
              spin: loadingRoom && roomId === room.id,
            })),
          ]}
          isActivated={(id) => roomId === id}
          onClick={(id) => handleRoomClick(id)}
        />
      </div>
      <div className={styles.section}>
        <Header
          title={t('stage.stageList')}
          extra={t('stage.totalCount', { total: stageList.length })}
        />
        <GridList
          items={stageList.map((option) => ({
            avatar: option.thumbnail,
            id: option.id,
            name: option.name,
            url: option.url,
            spin: loadingStage && stageId === option.id,
          }))}
          isActivated={(id) => stageId === id}
          onClick={handleStageClick}
        />
      </div>
    </Flexbox>
  );
};

export default StageList;

