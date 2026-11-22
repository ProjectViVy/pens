export const EMPTY_ID = 'empty';

export interface StageOption {
  id: string;
  name: string;
  thumbnail: string;
  url?: string; // 添加 thumbnail 参数
}

/**
 * 本地素材线
 *
 * 原来这里挂着 9 个 PMX 舞台（cyber blackxwhite / 国风舞台 / 温泉馆 / 小书房 /
 * 太空舱 / 练习室 / 日系舞台 / 扭曲空间），全部来自 r2.vidol.chat，该存储桶已整体下线，
 * 也没有找到镜像。现在只保留“空场景”，等有新舞台素材源再往 stageList 里加。
 */
export const stageList: StageOption[] = [
  {
    id: EMPTY_ID,
    name: '空场景',
    thumbnail: '/assets/common/transparent.png',
  },
];
