import { ReactNode, memo } from 'react';

import AppLayout from '@/layout/AppLayout';

/**
 * 舞台路由的布局
 *
 * 应用只剩两个入口：舞台（/）、设置（/settings/*）。
 * 这里只负责套上那个浮动的心形菜单（原来的左侧导航栏已经整个去掉），
 * 舞台本体在 page.tsx 里全屏渲染。
 */
const StageLayout = memo<{ children: ReactNode }>(({ children }) => (
  <AppLayout>{children}</AppLayout>
));

StageLayout.displayName = 'StageLayout';

export default StageLayout;
