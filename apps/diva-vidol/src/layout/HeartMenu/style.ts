import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  /** 左上角的浮动入口：一颗心，点开才是菜单 */
  dock: css`
    position: fixed;
    z-index: 8;
    top: 14px;
    left: 14px;

    @media (max-width: 640px) {
      top: 10px;
      left: 10px;
    }
  `,
  heart: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 40%);
    border-radius: 50%;

    color: #fff;

    background: linear-gradient(145deg, #ff90ad 0%, #ff5f8a 60%, #f0446f 100%);
    box-shadow: 0 4px 14px rgb(240 68 111 / 35%);

    transition:
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 180ms ease,
      filter 180ms ease;

    &:hover {
      transform: scale(1.07);
      box-shadow: 0 6px 18px rgb(240 68 111 / 45%);
      filter: brightness(1.04);
    }

    &:active {
      transform: scale(0.97);
    }

    &[data-open='true'] {
      transform: scale(1.04);
      filter: brightness(0.96);
    }
  `,
  /** 向下弹出的菜单（内容就是原来左侧栏那几项 + 场景列表） */
  menu: css`
    position: absolute;
    top: 48px;
    left: 0;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 238px;
    padding: 6px;
    border: 1px solid rgb(255 255 255 / 46%);
    border-radius: 18px;

    background: color-mix(in srgb, ${token.colorBgElevated} 88%, transparent);
    -webkit-backdrop-filter: blur(18px) saturate(1.2);
    backdrop-filter: blur(18px) saturate(1.2);
    box-shadow: 0 12px 34px rgb(0 0 0 / 18%);

    transform-origin: top left;
    transition:
      opacity 160ms ease,
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);

    &[data-open='false'] {
      pointer-events: none;
      opacity: 0;
      transform: translateY(-6px) scale(0.96);
    }
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: 12px;

    font-size: 13.5px;
    color: ${token.colorText};
    text-align: left;

    background: none;

    transition: background 150ms ease;

    &:hover {
      background: color-mix(in srgb, ${token.colorText} 7%, transparent);
    }

    &[data-active='true'] {
      color: ${token.colorPrimary};
      background: color-mix(in srgb, ${token.colorPrimary} 10%, transparent);
    }

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }
  `,
  label: css`
    display: flex;
    gap: 6px;
    align-items: center;

    padding: 8px 10px 4px;

    font-size: 11.5px;
    letter-spacing: 0.04em;
    color: ${token.colorTextSecondary};
  `,
  divider: css`
    height: 1px;
    margin: 4px 8px;
    background: color-mix(in srgb, ${token.colorText} 10%, transparent);
  `,
  rooms: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;

    /* 菜单别长到把画面吃光 */
    max-height: min(46vh, 340px);

    scrollbar-width: thin;
  `,
  room: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 10px;

    text-align: left;

    background: none;

    transition: background 150ms ease;

    &:hover {
      background: color-mix(in srgb, ${token.colorText} 7%, transparent);
    }

    &[data-active='true'] {
      background: color-mix(in srgb, ${token.colorPrimary} 10%, transparent);
    }

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }
  `,
  mark: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;

    color: ${token.colorPrimary};
  `,
  roomBody: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  `,
  roomName: css`
    overflow: hidden;

    font-size: 13px;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  roomDetail: css`
    font-size: 11.5px;
    color: ${token.colorTextSecondary};
  `,
  empty: css`
    padding: 8px 10px;
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
}));
