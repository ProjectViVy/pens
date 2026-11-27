'use client';

import { ActionIcon } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Wrench } from 'lucide-react';
import { memo, useState } from 'react';

import { DESKTOP_OPERATION_ICON_SIZE } from '@/constants/token';

import Focus from './actions/Focus';
import Interactive from './actions/Interactive';
import LockMove from './actions/LockMove';
import Setting from './actions/Setting';
import { useStyles } from './style';

/**
 * 舞台底部操作条（右下角）
 *
 * - 触摸交互开关（点人物有反应）
 * - 移动锁（锁上之后点地面/桌椅不再挪动她）
 * - 打开右侧舞台设置（人物 / 舞蹈 / 背景 / 舞台）——图标 title 就是「菜单」
 * - 聚焦人物（Hanami 双击取景那一套），放在菜单按钮右边
 * - 最右边是收缩按钮（一枚扳手）：**默认收起**，画面上只留这一枚；点一下才摊开那排按钮
 *
 * 收起的图标用扳手而不是箭头：收起状态只有这一颗按钮可见，箭头（»/«）看上去像
 * 「翻页」，扳手才说得清「点我打开工具」。扳手本身就是开关，展开时也用它。
 * 收起状态不写 localStorage —— 刷新后回到收起，这就是「默认收起」的意思。
 * 原来的挂断（回到聊天）、麦克风（发消息）随普通聊天一起移除。
 */
const StageOperation = memo(() => {
  const { styles, cx } = useStyles();
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={styles.wrap}>
      <div className={cx(styles.actions, collapsed && styles.actionsCollapsed)}>
        <Interactive />
        <LockMove />
        <Setting />
        <Focus />
      </div>
      {/* 收缩按钮放在最后一个：收起时它原地不动，不会跟着按钮一起「跳」到别处 */}
      <ActionIcon
        className={cx('operation-handle', styles.handle, collapsed && styles.handleSolo)}
        icon={Wrench}
        onClick={() => setCollapsed((value) => !value)}
        size={DESKTOP_OPERATION_ICON_SIZE}
        style={{
          backgroundColor: theme.colorBgElevated,
          color: collapsed ? theme.colorText : theme.colorTextTertiary,
        }}
        title={collapsed ? '展开工具栏' : '收起工具栏'}
      />
    </div>
  );
});

export default StageOperation;
