import { ActionIcon } from '@lobehub/ui';
import { message } from 'antd';
import { useTheme } from 'antd-style';
import { Lock, Unlock } from 'lucide-react';
import React from 'react';

import { DESKTOP_OPERATION_ICON_SIZE } from '@/constants/token';
import { useCharacterStore } from '@/store/character';

/**
 * 移动锁
 *
 * 摆在「触摸交互」旁边。锁上之后：点地面不再走路、点桌椅不再坐下、她自己也不再起身闲逛，
 * 也就是说画面里的人不会突然跑掉——想把镜头对好、或者只是让她站那儿的时候用。
 *
 * 不锁的东西：点身体仍然有触摸反应（那是「看她被碰到怎么反应」），镜头随便转。
 * 锁的开关会存进 localStorage，刷新后保持；否则「锁好了」一刷新就散掉就白锁了。
 */
export default () => {
  const [moveLocked, toggleMoveLock] = useCharacterStore((s) => [s.moveLocked, s.toggleMoveLock]);
  const theme = useTheme();

  const handleClick = () => {
    toggleMoveLock();
    // 锁/解锁都要说一声：这个按钮看不出「她为什么不动了」，靠图标差一点点认不出来
    if (moveLocked) {
      message.info('已解锁：可以点地面 / 桌椅了');
    } else {
      message.info('已锁定：点地面和桌椅不会再让她动了');
    }
  };

  return (
    <ActionIcon
      active={moveLocked}
      className="lock-move"
      icon={moveLocked ? Lock : Unlock}
      onClick={handleClick}
      size={DESKTOP_OPERATION_ICON_SIZE}
      title={moveLocked ? '移动已锁定（点击解锁）' : '锁定移动（点地面不会再走）'}
      style={{
        // 锁上要「一眼看出不一样」：只换图标在 28px 上分不清开锁还是关锁，
        // 底色也一起换（跟随主题的主色，深色主题下就是一颗实心按钮）
        backgroundColor: moveLocked ? theme.colorPrimary : theme.colorBgElevated,
        color: moveLocked ? theme.colorTextLightSolid : undefined,
      }}
    />
  );
};
