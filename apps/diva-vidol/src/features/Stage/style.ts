import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token, responsive }) => ({
  viewer: css`
    position: absolute;
    top: 0;
    left: 0;

    width: 100%;
    height: 100%;
  `,
  content: css`
    min-width: 360px;
    max-width: 100vw;
    padding: 0 12px;

    ${responsive.mobile} {
      width: 100%;
    }
  `,
  dialog: css`
    z-index: 2;
    margin: ${token.marginLG}px auto 0;
  `,
  docker: css`
    z-index: 2;
    position: relative;

    display: flex;
    align-items: flex-end;
    justify-content: center;

    width: 100%;
    margin-bottom: ${token.marginLG}px;
    padding: ${token.paddingSM}px;

    /* 窄屏放不下「中间输入框 + 右边四颗按钮」时改成上下两行，按钮居中换行 */
    @media (max-width: 640px) {
      flex-direction: column;
      gap: 10px;
      align-items: center;
    }
  `,
  /** 操作按钮贴右下角；绝对定位是为了让中间的输入框真的在画面正中 */
  dockerRight: css`
    position: absolute;
    right: ${token.paddingSM}px;
    bottom: ${token.paddingSM}px;

    display: flex;
    justify-content: flex-end;

    @media (max-width: 640px) {
      position: static;
      justify-content: center;
    }
  `,
  mask: css``,
}));
