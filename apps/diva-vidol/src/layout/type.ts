/**
 * 左侧导航的入口
 *
 * VRM 舞台项目只剩两个：舞台 / 设置。
 * 皮套（Live2D）已拆成独立项目 diva-live2d；
 * 普通聊天、发现市场、我的角色三条线已经移除。
 */
export enum HeaderNavKey {
  Settings = 'settings',
  Stage = 'stage',
}

/** 导航项对应的路由地址 */
export const HeaderNavPath: Record<HeaderNavKey, string> = {
  [HeaderNavKey.Stage]: '/',
  [HeaderNavKey.Settings]: '/settings/common',
};
