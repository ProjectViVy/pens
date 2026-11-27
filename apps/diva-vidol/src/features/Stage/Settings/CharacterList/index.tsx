'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Typography } from 'antd';
import { createStyles } from 'antd-style';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import GridList from '@/components/GridList';
import Header from '@/components/Header';
import { characterSelectors, ensureLocalVrmLoaded, useCharacterStore } from '@/store/character';

const { Text } = Typography;

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow-y: auto;

    width: 100%;
    height: 100%;
    padding: 0 ${token.paddingSM}px;
  `,
  error: css`
    padding-bottom: ${token.paddingXS}px;
    font-size: ${token.fontSizeSM}px;
    color: ${token.colorErrorText};
  `,
  localList: css`
    width: 100%;
    padding: ${token.paddingXS}px 0 ${token.padding}px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
  localRow: css`
    padding: 2px 0;
    font-size: ${token.fontSizeSM}px;
  `,
}));

/**
 * 人物
 *
 * 两来源合成一张表：仓库自带的人物（`public/assets/agents` 下的 VRM）
 * + 本机导入的 VRM（存在浏览器 IndexedDB 里，见 `libs/localVrm`）。
 * 导入成功就直接上台，删掉当前这个会退回默认人物。
 */
const CharacterList = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCharacters = useCharacterStore((s) => characterSelectors.allCharacters(s));
  const localVrm = useCharacterStore((s) => characterSelectors.localVrm(s));
  const currentCharacterId = useCharacterStore((s) => characterSelectors.currentCharacterId(s));
  const setCurrentCharacterId = useCharacterStore((s) => s.setCurrentCharacterId);
  const importLocalVrm = useCharacterStore((s) => s.importLocalVrm);
  const deleteLocalVrm = useCharacterStore((s) => s.deleteLocalVrm);

  useEffect(() => {
    void ensureLocalVrmLoaded();
  }, []);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      await importLocalVrm(file);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(t('character.importFailed', { message }));
    } finally {
      setBusy(false);
      // 同一个文件再选一次也要能触发 change
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Flexbox className={styles.container}>
      <Header
        title={t('character.onStage')}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            <Text type={'secondary'} style={{ fontSize: 12 }}>
              {t('character.totalCount', { total: allCharacters.length })}
            </Text>
            <Button
              icon={<PlusOutlined />}
              loading={busy}
              size={'small'}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? t('character.importing') : t('character.import')}
            </Button>
          </Flexbox>
        }
      />

      <input
        ref={fileInput}
        accept={'.vrm'}
        hidden
        type={'file'}
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {error ? <div className={styles.error}>{error}</div> : null}

      <GridList
        isActivated={(id) => id === currentCharacterId}
        items={allCharacters.map((character) => ({
          avatar: character.avatar,
          id: character.id,
          name: localVrm.some((item) => item.id === character.id)
            ? `${character.name} · ${t('character.localBadge')}`
            : character.name,
        }))}
        onClick={(id) => setCurrentCharacterId(id)}
      />

      {localVrm.length > 0 ? (
        <Flexbox className={styles.localList} gap={2}>
          <Text type={'secondary'} style={{ fontSize: 12 }}>
            {t('character.localTitle')}
          </Text>
          {localVrm.map((character) => (
            <Flexbox
              key={character.id}
              align={'center'}
              className={styles.localRow}
              horizontal
              justify={'space-between'}
            >
              <Text ellipsis style={{ maxWidth: 220 }}>
                {character.name}
              </Text>
              <Popconfirm
                cancelText={t('character.cancel')}
                okText={t('character.remove')}
                title={t('character.removeConfirm', { name: character.name })}
                onConfirm={() => void deleteLocalVrm(character.id)}
              >
                <Button danger size={'small'} type={'text'}>
                  {t('character.remove')}
                </Button>
              </Popconfirm>
            </Flexbox>
          ))}
        </Flexbox>
      ) : null}
    </Flexbox>
  );
});

export default CharacterList;
