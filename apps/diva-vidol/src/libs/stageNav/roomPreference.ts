import { EMPTY_ID } from '@/constants/stage';

/**
 * 记住上次选过的 3D 房间。
 *
 * 之前房间只在设置面板里选、而且不落盘：每次刷新回到「空舞台」，
 * 打开 3000 看到的就是一个只有角色的灰底——新做的那一整套东西（铺房间、
 * 点地面走位、闲逛、坐姿）全都不在场。所以这里记一个偏好，
 * 下次直接铺回同一间房。
 *
 * 现在反过来：**默认就是空舞台**（产品口径），只有用户自己在「3D 房间」里
 * 挑过一间才铺房间。挑过的那间仍然记住，刷新后铺回同一间。
 */

const STORAGE_KEY = 'diva.stage.roomId';
/** 改成「默认空舞台」之前存下的偏好（比如 japanese-classroom）作废一次 */
const DEFAULT_EMPTY_MARKER = 'diva.stage.roomId.defaultEmpty';

/** 没有任何偏好时就是空舞台（不再铺教室） */
export const DEFAULT_ROOM_ID = EMPTY_ID;

export function getPreferredRoomId(): string {
  if (typeof window === 'undefined') return DEFAULT_ROOM_ID;
  try {
    // 只迁移一次：老存档里存着一间房，不清掉的话默认值的改动永远看不见
    if (!window.localStorage.getItem(DEFAULT_EMPTY_MARKER)) {
      window.localStorage.setItem(DEFAULT_EMPTY_MARKER, '1');
      window.localStorage.removeItem(STORAGE_KEY);
    }
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
    // 隐私模式写不进就算了，下次退回默认（空舞台）
  }
}
