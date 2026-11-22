export const TRANSPARENT_ID = 'transparent';

interface BackgroundOption {
  id: string;
  name: string;
  thumbnail: string;
  url: string; // 添加 thumbnail 参数
}

/**
 * 本地素材线
 *
 * 原来这里有 24 张场景图，全部来自 r2.vidol.chat/backgrounds（存储桶已整体下线，
 * 没有镜像可取）。现在只保留“透明背景”，本地上限就是 `public/assets/common/transparent.png`。
 * 以后拿到新的场景图，放进 public/assets/backgrounds 并把 url/thumbnail 写成 / 开头的路径即可。
 */
export const backgroundOptions: BackgroundOption[] = [
  {
    id: TRANSPARENT_ID,
    name: 'transparent',
    url: '/assets/common/transparent.png',
    thumbnail: '/assets/common/transparent.png',
  },
];
