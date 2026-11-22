import { ActionIcon } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Focus } from 'lucide-react';

import { DESKTOP_OPERATION_ICON_SIZE } from '@/constants/token';
import { useGlobalStore } from '@/store/global';

/**
 * 聚焦人物
 *
 * 对应 Hanami 里双击人物触发的 `frameCamera`：把镜头切到她正面的半身取景
 * （以头下 12 cm 为落点，距离按 fov 反算，撞墙就收回来）。
 * 放在「菜单」按钮右边，和其它开关同一个尺寸。
 */
export default () => {
  const viewer = useGlobalStore((s) => s.viewer);
  const theme = useTheme();
  return (
    <ActionIcon
      className="focus-character"
      icon={Focus}
      size={DESKTOP_OPERATION_ICON_SIZE}
      style={{
        backgroundColor: theme.colorBgElevated,
      }}
      title="聚焦人物"
      onClick={() => viewer?.focusCharacter()}
    />
  );
};
