import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  glow: css`
    pointer-events: none;

    position: absolute;
    top: 250px;
    left: 50%;

    width: 600px;
    height: 400px;

    opacity: 0.2;
    background: linear-gradient(
      135deg,
      ${token.purple} 0%,
      ${token.blue} 30%,
      ${token.red} 70%,
      ${token.cyan} 100%
    );
    background-size: 200% 200%;
    filter: blur(69px);
    transform: translate3d(-50%, 0, 0) scale(1.5);

    /*
     * 只动 transform / opacity：这两样由合成器处理，这一层（连 blur 一起）
     * 只栅格化一次。原来动的是 background-position，等于每帧把 600×400
     * 的区域重新模糊一遍——舞台本身在满帧渲染时，这是白白多出来的一份开销。
     */
    will-change: transform, opacity;
    animation: glow 10s ease-in-out infinite;

    @keyframes glow {
      0% {
        transform: translate3d(-50%, -6%, 0) scale(1.5);
        opacity: 0.16;
      }

      50% {
        transform: translate3d(-50%, 6%, 0) scale(1.5);
        opacity: 0.24;
      }

      100% {
        transform: translate3d(-50%, -6%, 0) scale(1.5);
        opacity: 0.16;
      }
    }
  `,
}));
