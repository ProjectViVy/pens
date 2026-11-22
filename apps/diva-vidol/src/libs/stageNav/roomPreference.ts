/**
 * 记住上次选过的 3D 房间。
 *
 * 之前房间只在设置面板里选、而且不落盘：每次刷新回到「空舞台」，
 * 打开 3000 看到的就是一个只有角色的灰底——新做的那一整套东西（铺房间、
 * 点地面走位、闲逛、坐姿）全都不在场。所以这里记一个偏好，
 * 下次直接铺回同一间房。
 */

const STORAGE_KEY = 'diva.stage.roomId';

/** 没有任何偏好时先铺这一间（教室是实测过最完整的一间） */
export const DEFAULT_ROOM_ID = 'japanese-classroom';

export function getPreferredRoomId(): string {
  if (typeof window === 'undefined') return DEFAULT_ROOM_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_ROOM_ID;
  } catch {
    return DEFAULT_ROOM_ID;
  }
}

export function setPreferredRoomId(id: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式写不进就算了，下次退回默认房间
  }
}
