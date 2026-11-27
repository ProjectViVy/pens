'use client';

import { isEqual } from 'lodash-es';
import React, { memo, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';

import CharacterViewer from '@/features/CharacterViewer';
import { characterSelectors, ensureLocalVrmLoaded, useCharacterStore } from '@/store/character';
import { useGlobalStore } from '@/store/global';

import Background from './Background';
import ChatHistory from './ChatHistory';
import InputBar from './InputBar';
import Operation from './Operation';
import Settings from './Settings';
import { useStyles } from './style';

/**
 * 舞台
 *
 * 全屏 3D 舞台 + 左侧对话记录 + 底部输入框（台词在它正上方）+ 右侧舞台设置抽屉。
 *
 * 拆分说明：
 * - 普通聊天（会话列表、消息流、语音通话）已全部移除；
 * - agent（聊天角色）概念也已移除，现在台上就是一个本地 VRM「人物」，
 *   后续由 neurolink 从外部驱动；
 * - 底部输入框发起对话，她的回复以 galgame 式大字台词出现在输入框正上方，历史留在左侧浮窗。
 *   **后台没有接模型**，现在的回复是规则挑的占位句子。
 */
export default memo(() => {
  const { styles } = useStyles();
  const [currentCharacter, interactive] = useCharacterStore(
    (s) => [characterSelectors.currentCharacter(s), s.interactive],
    isEqual,
  );
  const showChatSidebar = useGlobalStore((s) => s.showChatSidebar);

  // 上次可能选的是本机导入的人物：先读一次本地库，再决定谁上台
  useEffect(() => {
    void ensureLocalVrmLoaded();
  }, []);

  return (
    <Flexbox
      flex={1}
      horizontal
      style={{ height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Flexbox flex={1} style={{ position: 'relative' }}>
        {/*
         * 设置一打开就把整个 3D 前台卸掉，不留「低功耗预览」那一档。
         *
         * 卸载是真的停：React 会在同一次提交里把画布 ref 置空 → CharacterViewer
         * 调 viewer.teardown()，rAF 取消、监听器撤掉、GL 上下文连显存一起放掉。
         * 抽屉的滑入动画因此不用和 3D 抢主线程/合成器，点下去就是秒开。
         *
         * 关掉抽屉时这里重新挂载：新画布 → 新渲染器 → 房间环境贴图和贴图重新上传，
         * 也就是「再次打开重新加载」。模型和房间数据还在 viewer 里（teardown 不卸模型），
         * 所以这一次重载不下载任何东西。
         */}
        {currentCharacter && !showChatSidebar ? (
          <div className={styles.viewer}>
            <CharacterViewer
              key={currentCharacter.id}
              character={currentCharacter}
              interactive={interactive}
            />
          </div>
        ) : null}
        <Flexbox flex={1} className={styles.mask} />
        {/* 左侧对话记录浮窗（默认半透明）：字幕只留最近一句，说过的都在这儿 */}
        <ChatHistory />
        {/* 底栏：中间是输入框（绝对居中的那一块留给右边按钮，互不挤）；台词在输入框正上方 */}
        <div className={styles.docker}>
          <InputBar />
          <div className={styles.dockerRight}>
            <Operation />
          </div>
        </div>
      </Flexbox>
      <Settings />
      <Background />
    </Flexbox>
  );
});
