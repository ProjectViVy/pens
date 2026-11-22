import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  /** 工具栏一整排：左边是操作按钮，最右边是收缩按钮（收缩按钮的位置永远不变） */
  wrap: css`
    display: flex;
    flex-direction: row;
    align-items: center;
  `,
  /**
   * 一排操作按钮
   *
   * 收起时把宽度收到 0（不是只变透明）：收起来就该退回画面边缘，不该继续占着一片空白。
   * overflow hidden 让按钮在宽度变窄的过程中被切掉，看起来像缩回右边。
   */
  actions: css`
    display: flex;
    flex-direction: row;
    gap: 24px;
    align-items: center;

    max-width: 520px;
    overflow: hidden;
    visibility: visible;

    transition:
      max-width 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 160ms ease,
      transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
      visibility 0s linear;

    /* 宽度被压小的时候不许挤压图标本身，否则收起过程中按钮会先变扁 */
    & > * {
      flex: none;
    }
  `,
  actionsCollapsed: css`
    visibility: hidden;
    max-width: 0;
    opacity: 0;
    transform: translateX(12px);
    pointer-events: none;

    /* visibility 等缩完再切到 hidden：立刻 hidden 就看不到收起的过程了 */
    transition-delay: 0s, 0s, 0s, 260ms;
  `,
  /** 收缩按钮和那排按钮之间留一点点空，看起来是「一排」而不是挤在一起 */
  handle: css`
    flex: none;
    margin-left: 10px;
  `,
  /** 收起之后只剩这颗按钮，给它一圈描边（用阴影不占位置，不会有 1px 的跳动） */
  handleSolo: css`
    box-shadow: 0 0 0 1px ${token.colorBorder};
  `,
}));
