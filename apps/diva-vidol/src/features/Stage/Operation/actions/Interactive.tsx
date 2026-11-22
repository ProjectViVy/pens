import { ActionIcon } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Pointer, PointerOff } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_OPERATION_ICON_SIZE } from '@/constants/token';
import { useCharacterStore } from '@/store/character';

/**
 * 触摸交互开关
 *
 * 打开后可以直接点/摸舞台上的人物，触发对应部位的反应动作。
 * 原来在聊天页的头部，拆线后挪到舞台底部操作条。
 */
export default () => {
  const [interactive, toggleInteractive] = useCharacterStore((s) => [
    s.interactive,
    s.toggleInteractive,
  ]);
  const theme = useTheme();
  const { t } = useTranslation('chat');

  return (
    <ActionIcon
      active={interactive}
      icon={interactive ? Pointer : PointerOff}
      onClick={toggleInteractive}
      size={DESKTOP_OPERATION_ICON_SIZE}
      title={t('interactive')}
      style={{
        backgroundColor: theme.colorBgElevated,
        color: interactive ? theme.colorPrimary : undefined,
      }}
    />
  );
};
