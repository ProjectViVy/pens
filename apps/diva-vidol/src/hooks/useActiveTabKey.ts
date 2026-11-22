import { usePathname } from 'next/navigation';

import { HeaderNavKey } from '@/layout/type';

/**
 * 返回当前激活的导航项（stage / settings）
 *
 * 根路径 `/` 是第一段为空的情况，按舞台处理。
 */
export const useActiveTabKey = () => {
  const pathname = usePathname();
  const key = pathname.split('/').find(Boolean);

  if (!key) return HeaderNavKey.Stage;

  return key as HeaderNavKey;
};
