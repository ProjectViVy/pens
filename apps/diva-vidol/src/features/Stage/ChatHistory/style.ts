import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  /** 可拖动的小挂件：一个圆形把手 + 挂在它下面的气泡面板 */
  dock: css`
    position: fixed;
    z-index: 6;

    /* 只有把手那块能点到，面板自己管自己的高度 */
    width: 40px;
    height: 40px;

    @media (max-width: 900px) {
      display: none;
    }
  `,
  /** 把手：平时只剩一枚很淡的图标（融进墙面），鼠标放上去才浮出来 */
  handle: css`
    cursor: grab;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border: 1px solid transparent;
    border-radius: 50%;

    color: ${token.colorTextSecondary};

    opacity: 0.34;
    background: transparent;
    box-shadow: none;

    transition:
      opacity 200ms ease,
      background 200ms ease,
      border-color 200ms ease,
      transform 200ms ease;

    &:hover {
      transform: scale(1.06);
      opacity: 1;
      border-color: rgb(255 255 255 / 34%);
      background: color-mix(in srgb, ${token.colorBgElevated} 56%, transparent);
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
      box-shadow: 0 2px 10px rgb(0 0 0 / 12%);
    }

    &:active {
      cursor: grabbing;
    }

    &[data-open='true'] {
      opacity: 0.78;
      border-color: rgb(255 255 255 / 26%);
      background: color-mix(in srgb, ${token.colorBgElevated} 48%, transparent);
    }

    /* 钉住 + 鼠标不在附近：把手也一起隐掉，画面上只剩气泡 */
    &[data-bare='true'] {
      pointer-events: none;
      opacity: 0;
    }
  `,
  /** 面板：磨砂小卡片（钉住时默认打开，做成一整张卡而不是侧栏） */
  panel: css`
    position: absolute;
    top: 46px;
    left: -8px;

    display: flex;
    flex-direction: column;
    gap: 6px;

    width: 340px;
    max-height: min(56vh, 470px);
    padding: 10px 12px 12px;
    border: 1px solid rgb(255 255 255 / 34%);
    border-radius: 22px;

    background: color-mix(in srgb, ${token.colorBgElevated} 66%, transparent);
    -webkit-backdrop-filter: blur(18px) saturate(1.2);
    backdrop-filter: blur(18px) saturate(1.2);
    box-shadow: 0 10px 32px rgb(0 0 0 / 18%);

    /* 卡片外观要能悄悄淡掉（气泡留着），所以只过渡外观相关的属性 */
    transition:
      background 240ms ease,
      border-color 240ms ease,
      box-shadow 240ms ease,
      opacity 200ms ease,
      transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  `,
  /** 展开：钉住时一直是它；没钉住时靠悬停 */
  open: css`
    transform: translateY(0) scale(1);
    opacity: 1;
  `,
  /** 收起（没钉住、鼠标也不在）：缩一点再淡出，像是「收起来了」 */
  closed: css`
    pointer-events: none;
    transform: translateY(-6px) scale(0.97);
    opacity: 0;
  `,
  /**
   * 钉住但鼠标不在附近：边框、底色、模糊、阴影全部撤掉，
   * 只留气泡本体浮在画面上（气泡自己有底色，不靠卡片也读得清）
   */
  bare: css`
    pointer-events: none;
    border-color: transparent;
    background: transparent;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  `,
  head: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding: 0 2px 2px;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    transition: opacity 200ms ease;
  `,
  /** 外观撤掉时表头也一起隐掉（连钉子），不然气泡旁边还挂着一排按钮 */
  headBare: css`
    pointer-events: none;
    opacity: 0;
  `,
  headTitle: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-weight: 600;
    letter-spacing: 0.02em;
  `,
  /** 诚实标记：后台没模型，回复是规则挑的 */
  tag: css`
    padding: 0 6px;
    border-radius: 999px;

    font-size: 11px;
    font-weight: 400;
    color: ${token.colorTextSecondary};

    background: color-mix(in srgb, ${token.colorText} 10%, transparent);
  `,
  headActions: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  /** 表头上的小图标按钮（钉子 / 清空） */
  iconButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 7px;

    color: ${token.colorTextTertiary};

    background: none;

    transition:
      color 160ms ease,
      background 160ms ease;

    &:hover {
      color: ${token.colorText};
      background: color-mix(in srgb, ${token.colorText} 10%, transparent);
    }

    &[data-pinned='true'] {
      color: ${token.colorText};
      background: color-mix(in srgb, ${token.colorText} 12%, transparent);
    }
  `,
  clear: css`
    cursor: pointer;

    padding: 0 4px;
    border: none;

    font-size: 11px;
    color: ${token.colorTextTertiary};

    background: none;

    &:hover {
      color: ${token.colorText};
    }
  `,
  body: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding: 2px 2px 0;

    scrollbar-width: thin;
    scrollbar-color: rgb(255 255 255 / 35%) transparent;
  `,
  empty: css`
    /* 外观撤掉之后，这段字就是唯一的鼠标靶子（不然叫不回卡片） */
    pointer-events: auto;

    padding: 4px 6px 2px;

    font-size: 13.5px;
    line-height: 1.7;
    color: ${token.colorText};
    opacity: 0.9;
    text-shadow: 0 1px 6px rgb(0 0 0 / 18%);
  `,
  /** 还没聊过时，卡片外观撤掉的话这段说明就是几行凭空浮着的话——干脆一起隐掉 */
  emptyHidden: css`
    pointer-events: none;
    opacity: 0;
  `,
  /** 聊天气泡：她从左来，你从右来 */
  row: css`
    display: flex;
    justify-content: flex-start;
  `,
  rowUser: css`
    justify-content: flex-end;
  `,
  bubble: css`
    pointer-events: auto;

    max-width: 86%;
    padding: 8px 13px;
    border-radius: 17px 17px 17px 6px;

    font-size: 16px;
    line-height: 1.55;
    color: #fff;
    overflow-wrap: anywhere;

    background: rgb(0 0 0 / 48%);
    box-shadow: 0 1px 4px rgb(0 0 0 / 10%);
  `,
  bubbleUser: css`
    border-radius: 17px 17px 6px;
    color: #1d1d1f;
    background: rgb(255 255 255 / 82%);
  `,
}));
