'use client';

import { ActionIcon } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
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
 * - 最右边是收缩按钮：默认展开，点一下收起这排按钮，只剩它自己；再点一下展开
 *
 * 原来那一版是「永远摊开」，挡画面右下角；现在默认打开、可以收起来。
 * 收起状态不写 localStorage —— 刷新后回到展开，这也正是「默认打开」的意思。
 * 原来的挂断（回到聊天）、麦克风（发消息）随普通聊天一起移除。
 */
const StageOperation = memo(() => {
  const { styles, cx } = useStyles();
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(false);

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
        icon={collapsed ? ChevronsLeft : ChevronsRight}
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
