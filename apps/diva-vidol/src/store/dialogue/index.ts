import { PersistOptions, createJSONStorage, devtools, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

import { vidolStorage } from '@/utils/storage';

export const DIALOGUE_STORAGE_KEY = 'vidol-stage-dialogue-storage';

/** 对话里只有两方：你说的话，和她的回复 */
export type DialogueRole = 'user' | 'assistant';

export interface DialogueLine {
  /** 毫秒时间戳，浮窗里用来排序和显示时间 */
  at: number;
  id: string;
  /** 这条回复是不是占位回复（后台没有模型，由规则拼出来的） */
  placeholder?: boolean;
  role: DialogueRole;
  text: string;
}

/** 历史上限：只留最近这些条，免得 localStorage 越滚越大 */
const HISTORY_LIMIT = 80;

export interface DialogueStore {
  clearHistory: () => void;
  /** 历史记录（左侧浮窗显示） */
  lines: DialogueLine[];
  pushAssistant: (text: string, placeholder?: boolean) => void;
  pushUser: (text: string) => void;
  setSubtitle: (text: string) => void;
  /** 正在渐变退场（CSS 过渡，配合 3 秒停留之后收尾） */
  setSubtitleFading: (fading: boolean) => void;
  /** 当前字幕：只放她的回复，galgame 那样一句一句地出 */
  subtitle: string;
  subtitleFading: boolean;
}

let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

const persistOptions: PersistOptions<DialogueStore> = {
  name: DIALOGUE_STORAGE_KEY,
  storage: createJSONStorage(() => vidolStorage),
  // 字幕是运行态，不落盘；只留历史
  partialize: (state) => ({ lines: state.lines } as DialogueStore),
};

export const useDialogueStore = createWithEqualityFn<DialogueStore>()(
  persist(
    devtools<DialogueStore>(
      (set) => ({
        lines: [],
        subtitle: '',
        subtitleFading: false,
        clearHistory: () => set({ lines: [], subtitle: '', subtitleFading: false }),
        pushAssistant: (text, placeholder) =>
          set((state) => ({
            lines: [
              ...state.lines,
              { id: nextId(), role: 'assistant' as const, text, at: Date.now(), placeholder },
            ].slice(-HISTORY_LIMIT),
          })),
        pushUser: (text) =>
          set((state) => ({
            lines: [
              ...state.lines,
              { id: nextId(), role: 'user' as const, text, at: Date.now() },
            ].slice(-HISTORY_LIMIT),
          })),
        setSubtitle: (text) => set({ subtitle: text }),
        setSubtitleFading: (fading) => set({ subtitleFading: fading }),
      }),
      { name: 'dialogue' },
    ),
    persistOptions,
  ),
  shallow,
);

export const dialogueSelectors = {
  lines: (s: DialogueStore) => s.lines,
  subtitle: (s: DialogueStore) => s.subtitle,
  subtitleFading: (s: DialogueStore) => s.subtitleFading,
  lastLine: (s: DialogueStore) => s.lines.at(-1),
};
