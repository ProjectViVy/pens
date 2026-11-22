import { ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import HeartMenu from './HeartMenu';

interface AppLayoutDesktopProps {
  children: ReactNode;
}

/**
 * 舞台的外壳
 *
 * 左侧导航栏已经整个去掉（它白占 60px 舞台宽度），换成一枚左上角的浮动心形按钮：
 * 点开才向下弹出菜单（舞台 / 设置 / 场景）。舞台本体因此可以铺满整个窗口。
 */
const AppLayoutDesktop = memo<AppLayoutDesktopProps>(({ children }) => {
  return (
    <Flexbox height={'100%'} width={'100%'} horizontal>
      <HeartMenu />
      <Flexbox flex={1} height={'100%'} width={'100%'}>
        {children}
      </Flexbox>
    </Flexbox>
  );
});

export default AppLayoutDesktop;
