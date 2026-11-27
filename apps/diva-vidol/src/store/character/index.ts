import { PersistOptions, createJSONStorage, devtools, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

import {
  DEFAULT_CHARACTER_ID,
  characters,
  defaultCharacter,
  getCharacterById,
  localVrmToCharacter,
} from '@/constants/characters';
import { addLocalVrm, listLocalVrm, removeLocalVrm } from '@/libs/localVrm';
import { Character } from '@/types/character';
import { vidolStorage } from '@/utils/storage';

export const CHARACTER_STORAGE_KEY = 'vidol-stage-character-storage';

export interface CharacterStore {
  /** 当前上台的人物 id */
  currentCharacterId: string;
  /**
   * 本地导入的人物（存在浏览器 IndexedDB 里，不进仓库）
   *
   * 只放在内存里，启动时从库里读一次；持久化只存 currentCharacterId。
   */
  localVrm: Character[];
  /** 是否已经读过一次本地库 */
  hydrated: boolean;
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
  deleteLocalVrm: (id: string) => Promise<void>;
  hydrateLocalVrm: () => Promise<void>;
  importLocalVrm: (file: File) => Promise<Character>;
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
  /**
   * v2：默认模式改成「一进来就锁住移动」。
   *
   * 光改初始值不够——存档里已经存着 `moveLocked: false`，恢复时它会盖掉新默认值，
   * 于是老机器打开还是「点地面她就走」。这里升一版，把旧的 false 一次性翻成 true；
   * 之后用户自己解锁的自由选择照常存、照常恢复。
   */
  version: 2,
  migrate: (persisted, version) => {
    const state = (persisted ?? {}) as Partial<CharacterStore>;
    if (version < 2) return { ...state, moveLocked: true } as CharacterStore;
    return state as CharacterStore;
  },
};

export const useCharacterStore = createWithEqualityFn<CharacterStore>()(
  persist(
    devtools<CharacterStore>(
      (set, get) => ({
        currentCharacterId: DEFAULT_CHARACTER_ID,
        localVrm: [],
        hydrated: false,
        interactive: true,
        // 默认模式：锁住移动。要先让她站在那儿别乱走（自动聚焦、看构图），
        // 想让她走路就点一下那颗锁解开。
        moveLocked: true,
        setCurrentCharacterId: (id) => {
          const exists = getCharacterById(id) || get().localVrm.some((item) => item.id === id);
          if (!exists) return;
          set({ currentCharacterId: id });
        },
        toggleInteractive: () => {
          set((state) => ({ interactive: !state.interactive }));
        },
        toggleMoveLock: () => {
          set((state) => ({ moveLocked: !state.moveLocked }));
        },
        resetCharacter: () => {
          // 复位回「默认模式」：默认人物 + 触摸开 + 移动锁上
          set({ currentCharacterId: DEFAULT_CHARACTER_ID, interactive: true, moveLocked: true });
        },
        hydrateLocalVrm: async () => {
          try {
            const metas = await listLocalVrm();
            set({ hydrated: true, localVrm: metas.map(localVrmToCharacter) });
          } catch (error) {
            // 库坏了不该让整个舞台起不来：照旧用内置人物，控制台留个记录
            console.error('[local-vrm] 读取本地人物库失败', error);
            set({ hydrated: true });
          }
        },
        importLocalVrm: async (file) => {
          const meta = await addLocalVrm(file);
          const character = localVrmToCharacter(meta);
          set((state) => ({
            currentCharacterId: character.id,
            localVrm: [character, ...state.localVrm],
          }));
          return character;
        },
        deleteLocalVrm: async (id) => {
          await removeLocalVrm(id);
          set((state) => ({
            currentCharacterId:
              state.currentCharacterId === id ? DEFAULT_CHARACTER_ID : state.currentCharacterId,
            localVrm: state.localVrm.filter((item) => item.id !== id),
          }));
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
 * 持久化里可能存着已经不存在的 id（人物库改了、导入的人物被删了），
 * 这里统一兜底到默认人物。
 */
export const getCurrentCharacter = (state: CharacterStore): Character =>
  getCharacterById(state.currentCharacterId) ||
  state.localVrm.find((item) => item.id === state.currentCharacterId) ||
  defaultCharacter;

export const characterSelectors = {
  allCharacters: (s: CharacterStore) => [...characters, ...s.localVrm],
  currentCharacter: (s: CharacterStore) => getCurrentCharacter(s),
  currentCharacterId: (s: CharacterStore) => getCurrentCharacter(s).id,
  interactive: (s: CharacterStore) => s.interactive,
  localVrm: (s: CharacterStore) => s.localVrm,
  moveLocked: (s: CharacterStore) => s.moveLocked,
};

let hydration: Promise<void> | null = null;

/**
 * 启动时读一次本地人物库。多处调用只会真正读一次。
 *
 * 必须有这一步：如果上次选的是导入的人物，刷新后要先知道它存在，
 * 否则兜底会把你打回默认人物。
 */
export const ensureLocalVrmLoaded = (): Promise<void> => {
  hydration ??= useCharacterStore
    .getState()
    .hydrateLocalVrm()
    .catch((error) => {
      console.error('[local-vrm] 初始化失败', error);
    });
  return hydration;
};
