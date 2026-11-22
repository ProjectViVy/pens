import { PersistOptions, createJSONStorage, devtools, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

import { DEFAULT_CHARACTER_ID, defaultCharacter, getCharacterById } from '@/constants/characters';
import { Character } from '@/types/character';
import { vidolStorage } from '@/utils/storage';

export const CHARACTER_STORAGE_KEY = 'vidol-stage-character-storage';

export interface CharacterStore {
  /** 当前上台的人物 id */
  currentCharacterId: string;
  /** 触摸交互开关 */
  interactive: boolean;
  /**
   * 移动锁
   *
   * 打开后她不再因为「点地面/点椅子/自己闲逛」而换位置或换姿势——
   * 摆好一个画面想仔细看的时候用。触摸反应（点身体）不受影响，
   * 那是「看她被碰到怎么反应」，不是「把她挪走」。
   */
  moveLocked: boolean;
  resetCharacter: () => void;
  setCurrentCharacterId: (id: string) => void;
  toggleInteractive: () => void;
  toggleMoveLock: () => void;
}

const persistOptions: PersistOptions<CharacterStore> = {
  name: CHARACTER_STORAGE_KEY,
  storage: createJSONStorage(() => vidolStorage),
  // 只持久化身份、交互开关和移动锁，其余都是派生值
  partialize: (state) => ({
    currentCharacterId: state.currentCharacterId,
    interactive: state.interactive,
    moveLocked: state.moveLocked,
  } as CharacterStore),
};

export const useCharacterStore = createWithEqualityFn<CharacterStore>()(
  persist(
    devtools<CharacterStore>(
      (set) => ({
        currentCharacterId: DEFAULT_CHARACTER_ID,
        interactive: true,
        moveLocked: false,
        setCurrentCharacterId: (id) => {
          if (!getCharacterById(id)) return;
          set({ currentCharacterId: id });
        },
        toggleInteractive: () => {
          set((state) => ({ interactive: !state.interactive }));
        },
        toggleMoveLock: () => {
          set((state) => ({ moveLocked: !state.moveLocked }));
        },
        resetCharacter: () => {
          set({ currentCharacterId: DEFAULT_CHARACTER_ID, interactive: true, moveLocked: false });
        },
      }),
      { name: 'character' },
    ),
    persistOptions,
  ),
  shallow,
);

/**
 * 取当前人物对象
 *
 * 持久化里可能存着已经不存在的 id（比如人物库改了），这里统一兜底到默认人物。
 */
export const getCurrentCharacter = (state: CharacterStore): Character =>
  getCharacterById(state.currentCharacterId) || defaultCharacter;

export const characterSelectors = {
  currentCharacter: (s: CharacterStore) => getCurrentCharacter(s),
  currentCharacterId: (s: CharacterStore) => getCurrentCharacter(s).id,
  interactive: (s: CharacterStore) => s.interactive,
  moveLocked: (s: CharacterStore) => s.moveLocked,
};
