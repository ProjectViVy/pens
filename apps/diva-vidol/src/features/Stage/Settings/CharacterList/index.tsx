'use client';

import { createStyles } from 'antd-style';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import GridList from '@/components/GridList';
import Header from '@/components/Header';
import { characters } from '@/constants/characters';
import { characterSelectors, useCharacterStore } from '@/store/character';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow-y: auto;

    width: 100%;
    height: 100%;
    padding: 0 ${token.paddingSM}px;
  `,
}));

/**
 * 人物
 *
 * agent（聊天角色 + 市场下载）概念已删除，现在是纯粹的本地人物库：
 * public/assets/agents 下的 7 套 VRM 直接列出来，点谁谁上台。
 * 后续人物由 neurolink 从外部驱动，这里只负责选模型。
 */
const CharacterList = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');

  const currentCharacterId = useCharacterStore((s) => characterSelectors.currentCharacterId(s));
  const setCurrentCharacterId = useCharacterStore((s) => s.setCurrentCharacterId);

  return (
    <Flexbox className={styles.container}>
      <Header
        title={t('character.onStage')}
        extra={t('character.totalCount', { total: characters.length })}
      />
      <GridList
        isActivated={(id) => id === currentCharacterId}
        items={characters.map((character) => ({
          avatar: character.avatar,
          id: character.id,
          name: character.name,
        }))}
        onClick={(id) => setCurrentCharacterId(id)}
      />
    </Flexbox>
  );
});

export default CharacterList;
