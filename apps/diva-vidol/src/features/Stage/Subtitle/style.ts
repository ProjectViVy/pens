import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css }) => ({
  /** 台词区：挂在输入框正上方，整块预留高度（出现/消失时输入框不会上下跳） */
  layer: css`
    pointer-events: none;

    display: flex;
    /* 字贴着这块区域的底部排，离输入框近，上面那一截就是留给长句的留白 */
    align-items: flex-end;
    justify-content: center;

    /* 父级（输入框那一列）最宽只有 620px，台词要能比它宽，所以按自身内容撑开 */
    width: max-content;
    max-width: min(78vw, 980px);
    /* 预留两行高（46px × 1.5 × 2 ≈ 138px）+ 一点余量，长句进来也不会把输入框顶下去 */
    min-height: 150px;
    padding: 0 8px;

    text-align: center;

    /* 小屏上按同样的比例留白，不然一块空白吃掉半屏 */
    @media (max-width: 640px) {
      min-height: 96px;
    }
  `,
  /** 字：比之前收一号（63px → 46px），但仍然明显大过界面其它文字 */
  text: css`
    display: inline-block;
    padding: 8px 22px;
    border: 1px solid rgb(255 255 255 / 12%);
    border-radius: 16px;

    font-size: clamp(26px, 3.2vw, 46px);
    font-weight: 600;
    line-height: 1.5;
    color: #fff;
    letter-spacing: 0.02em;
    overflow-wrap: anywhere;

    background: rgb(0 0 0 / 44%);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
    text-shadow:
      0 2px 10px rgb(0 0 0 / 55%),
      0 1px 2px rgb(0 0 0 / 45%);

    /* 渐变退场：时长要和 say.ts 里的 FADE_MS 对齐，否则字会先被清空、动画看不见 */
    transition: opacity 450ms ease;

    @media (max-width: 640px) {
      font-size: clamp(20px, 5.6vw, 28px);
      padding: 6px 14px;
    }
  `,
  /** 淡出中：整块（连垫底一起）淡掉，不是只淡字 */
  textFading: css`
    opacity: 0;
  `,
  /** 打字光标：一细条，闪一下就够，别做成花哨的方块 */
  caret: css`
    display: inline-block;

    width: 2px;
    height: 0.95em;
    margin-left: 0.08em;
    vertical-align: text-bottom;

    background: rgb(255 255 255 / 75%);
    animation: caret-blink 900ms steps(1, end) infinite;

    @keyframes caret-blink {
      0%,
      50% {
        opacity: 1;
      }

      50.01%,
      100% {
        opacity: 0;
      }
    }
  `,
}));
