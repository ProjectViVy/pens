import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token, responsive }) => ({
  /** 整个底栏：输入框居中，操作按钮绝对定位贴右侧（左右对称才会真的居中） */
  wrap: css`
    display: flex;
    gap: 16px;
    align-items: flex-end;
    width: 100%;
  `,
  side: css`
    flex: 1;
    min-width: 0;
  `,
  center: css`
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    gap: 8px;
    align-items: center;

    min-width: 0;
    /* 撑到上限宽度（否则 flex 会按输入框的内容宽度收窄，看起来只有一小截） */
    width: 100%;
    max-width: max(200px, min(620px, calc(100% - 620px)));

    /* 「拉开」这件事本身要有过渡，否则是瞬间跳了一下，看不出是同一个东西 */
    transition:
      width 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
      max-width 240ms cubic-bezier(0.2, 0.8, 0.2, 1);

    ${responsive.mobile} {
      max-width: 100%;
    }

    /* 和底栏的换行断点对齐（Stage/style.ts 的 docker） */
    @media (max-width: 640px) {
      max-width: 100%;
    }
  `,
  /** 收起：只剩一小截，露一句「说点什么…」和麦克风，不挡画面 */
  centerCollapsed: css`
    width: 188px;
    max-width: 188px;

    ${responsive.mobile} {
      width: 188px;
      max-width: 188px;
    }

    @media (max-width: 640px) {
      width: 188px;
      max-width: 188px;
    }
  `,
  bar: css`
    display: flex;
    gap: 6px;
    align-items: center;

    width: 100%;
    /* 和右边那排操作按钮同高（48px）、同圆角，看上去是同一排东西 */
    height: 48px;
    padding: 4px 6px 4px 16px;
    border: 1px solid ${token.colorBorder};
    border-radius: 24px;

    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowSecondary};
  `,
  /** 语音正在听：边框呼吸一下，否则按下去没有任何反馈 */
  listening: css`
    border-color: ${token.colorError};

    @keyframes mic-pulse {
      0%,
      100% {
        box-shadow: 0 0 0 0 ${token.colorErrorBorder};
      }

      50% {
        box-shadow: 0 0 0 3px ${token.colorErrorBorder};
      }
    }

    animation: mic-pulse 1.2s ease-in-out infinite;
  `,
}));
