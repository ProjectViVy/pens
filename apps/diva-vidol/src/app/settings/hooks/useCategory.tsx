import { Icon } from '@lobehub/ui';
import { Info, MousePointerClick, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MenuProps } from '@/components/Menu';
import { SettingsTabs } from '@/store/global/index';

export const useCategory = () => {
  const { t } = useTranslation('settings');

  const cateItems: MenuProps['items'] = useMemo(
    () =>
      [
        {
          icon: <Icon icon={Settings2} />,
          key: SettingsTabs.Common,
          label: (
            <Link href={'/settings/common'} onClick={(e) => e.preventDefault()}>
              {t('common.title')}
            </Link>
          ),
        },
        // {
        //   icon: <Icon icon={Sparkles} />,
        //   key: SettingsTabs.SystemAgent,
        //   label: (
        //     <Link href={'/settings/system-agent'} onClick={(e) => e.preventDefault()}>
        //       {t('tab.system-agent')}
        //     </Link>
        //   ),
        // },
        // 语言模型设定：这条线没有接 LLM（人格、记忆、对话都不在这里配），
        // 面板里留着只会让人以为改了会生效，所以从左侧栏移出。
        // 路由 /settings/llm 还在，需要时可以直接访问。
        {
          icon: <Icon icon={MousePointerClick} />,
          key: SettingsTabs.Touch,
          label: (
            <Link href={'/settings/touch'} onClick={(e) => e.preventDefault()}>
              {t('touch.title')}
            </Link>
          ),
        },
        // 品牌图标、GitHub、文档、赞助这些原本挂在左侧栏，都收进这一页
        {
          icon: <Icon icon={Info} />,
          key: SettingsTabs.About,
          label: (
            <Link href={'/settings/about'} onClick={(e) => e.preventDefault()}>
              {t('about.title')}
            </Link>
          ),
        },
      ].filter(Boolean) as MenuProps['items'],
    [t],
  );

  return cateItems;
};
