'use client';

import { ActionIcon, DraggablePanel, DraggablePanelContainer, TabsNav } from '@lobehub/ui';
import { createStyles, useResponsive } from 'antd-style';
import { X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { rgba } from 'polished';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import SkeletonList from '@/components/SkeletonList';
import { CHAT_INFO_MAX_WIDTH, CHAT_INFO_WIDTH } from '@/constants/token';
import { useGlobalStore } from '@/store/global';

import { Tab } from './type';

const Loading = () => (
  <div style={{ padding: '16px 0' }}>
    <SkeletonList avatar count={8} />
  </div>
);

const CharacterList = dynamic(() => import('./CharacterList'), {
  ssr: false,
  loading: Loading,
});

const MotionList = dynamic(() => import('./MotionList'), {
  ssr: false,
  loading: Loading,
});

const PostureList = dynamic(() => import('./PostureList'), {
  ssr: false,
  loading: Loading,
});

const BackGround = dynamic(() => import('./BackGroundList'), {
  ssr: false,
  loading: Loading,
});

const DanceList = dynamic(() => import('./DanceList'), {
  ssr: false,
  loading: Loading,
});

const StageList = dynamic(() => import('./StageList'), {
  ssr: false,
  loading: Loading,
});

const useStyles = createStyles(({ css, token }) => ({
  content: css`
    display: flex;
    flex-direction: column;
    height: 100% !important;
  `,
  drawer: css`
    z-index: 10;
    background-color: ${rgba(token.colorBgLayout, 0.2)};
    backdrop-filter: saturate(180%) blur(8px);
  `,
  header: css`
    width: 100%;
    border-bottom: 1px solid ${token.colorBorder};
  `,
  player: css`
    min-width: 480px;
  `,
  closeIcon: css`
    cursor: pointer;
    margin-right: 12px;
    color: ${token.colorTextSecondary};

    &:hover {
      color: ${token.colorText};
    }
  `,
}));

/**
 * 舞台设置抽屉
 *
 * 页签：人物 / 动作 / 姿势 / 舞蹈 / 背景 / 舞台。
 * 动作页签在拆线时被移除过，现在按内置动作预设恢复（点一下直接演在台上）。
 * 姿势页签是纯程序化骨骼姿势（不依赖素材文件），点一下把人物摆成对应站姿。
 */
export default () => {
  const [showChatSidebar, setChatSidebar] = useGlobalStore((s) => [
    s.showChatSidebar,
    s.setChatSidebar,
  ]);

  const { md = true } = useResponsive();

  const [tab, setTab] = useState<Tab>(Tab.Character);
  const { t } = useTranslation('chat');

  const { styles } = useStyles();

  /**
   * 面板内容延迟到第一次打开
   *
   * 抽屉是常驻挂载的，以前「人物」这一页在首屏就跟着挂上了：
   * 动态 chunk + 七张头像在进入舞台的同时一起下载、占内存，
   * 而用户可能根本不打开设置。第一次展开之后再挂，之后保持常驻（切页签不再闪）。
   */
  const [openedOnce, setOpenedOnce] = useState(showChatSidebar);
  useEffect(() => {
    if (showChatSidebar) setOpenedOnce(true);
  }, [showChatSidebar]);

  return (
    <DraggablePanel
      className={styles.drawer}
      classNames={{ content: styles.content }}
      minWidth={CHAT_INFO_WIDTH}
      maxWidth={CHAT_INFO_MAX_WIDTH}
      mode={md ? 'fixed' : 'float'}
      onExpandChange={(expand) => {
        setChatSidebar(expand);
      }}
      expand={showChatSidebar}
      placement={'right'}
    >
      <DraggablePanelContainer
        style={{
          flex: 'none',
          height: '100%',
          maxHeight: '100vh',
          minWidth: CHAT_INFO_WIDTH,
        }}
      >
        <Flexbox justify={'space-between'} horizontal align={'center'} className={styles.header}>
          <TabsNav
            variant={'compact'}
            activeKey={tab}
            tabBarExtraContent={{
              left: (
                <ActionIcon
                  icon={X}
                  onClick={() => {
                    setChatSidebar(false);
                  }}
                  style={{ marginLeft: 12 }}
                />
              ),
            }}
            items={[
              {
                label: t('info.character'),
                key: Tab.Character,
              },
              {
                label: t('info.motion'),
                key: Tab.Motion,
              },
              {
                label: t('info.posture'),
                key: Tab.Posture,
              },
              {
                label: t('info.dance'),
                key: Tab.DanceList,
              },
              {
                label: t('info.background'),
                key: Tab.Background,
              },
              {
                label: t('info.stage'),
                key: Tab.Stage,
              },
            ]}
            onChange={(key) => {
              setTab(key as Tab);
            }}
          />
        </Flexbox>
        <Flexbox flex={1}>
          {openedOnce && (
            <>
              {tab === Tab.Character && <CharacterList />}
              {tab === Tab.Motion && <MotionList />}
              {tab === Tab.Posture && <PostureList />}
              {tab === Tab.DanceList && <DanceList />}
              {tab === Tab.Background && <BackGround />}
              {tab === Tab.Stage && <StageList />}
            </>
          )}
        </Flexbox>
      </DraggablePanelContainer>
    </DraggablePanel>
  );
};


