'use client';

import { isEqual } from 'lodash-es';
import { MessagesSquare, Pin, PinOff } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import { dialogueSelectors, useDialogueStore } from '@/store/dialogue';

import { useStyles } from './style';

/** 拖动位置 + 钉子状态存在本地，下次进来还是你摆的样子 */
const POSITION_KEY = 'vidol-chat-dock-position';

const HANDLE_SIZE = 40;
const PANEL_WIDTH = 340;

interface DockState {
  pinned: boolean;
  x: number;
  y: number;
}

const DEFAULT_STATE: DockState = { x: 76, y: 96, pinned: true };

function clampPosition(state: DockState): DockState {
  if (typeof window === 'undefined') return state;
  const maxX = Math.max(8, window.innerWidth - PANEL_WIDTH);
  const maxY = Math.max(8, window.innerHeight - HANDLE_SIZE - 24);
  return {
    ...state,
    x: Math.min(Math.max(state.x, 8), maxX),
    y: Math.min(Math.max(state.y, 8), maxY),
  };
}

function readState(): DockState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<DockState>;
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return DEFAULT_STATE;
    return clampPosition({
      x: parsed.x,
      y: parsed.y,
      // 旧版本只存了坐标，没有 pinned：按「钉住」算
      pinned: parsed.pinned !== false,
    });
  } catch {
    return DEFAULT_STATE;
  }
}

/**
 * 左侧对话记录（可拖动的聊天气泡卡片）
 *
 * 三种状态，靠表头上那枚**钉子**切换：
 *
 * 1. **钉住（默认）**：卡片常显。但鼠标不在附近时，边框、底色、模糊、阴影、表头全部淡掉，
 *    画面上只剩气泡浮着——不挡画面，也不用去点开。
 * 2. **钉住 + 悬停**：卡片外观和表头（钉子、清空）一起回来，可以拖动、清空、取消钉住。
 * 3. **没钉住**：像最早那样收成一枚淡淡的圆把手，鼠标放上去才展开。
 *
 * 气泡是聊天样式的：她从左来（深色），你从右来（浅色）。
 */
const ChatHistory = memo(() => {
  const { styles, cx } = useStyles();
  const lines = useDialogueStore(dialogueSelectors.lines, isEqual);
  const clearHistory = useDialogueStore((s) => s.clearHistory);

  const [state, setState] = useState<DockState>(DEFAULT_STATE);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 状态要等挂载后再读（localStorage 在服务端没有）
  useEffect(() => {
    setState(readState());
  }, []);

  // 新的一句进来就滚到底部
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [lines, hovered]);

  const save = useCallback((next: DockState) => {
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      // 存不了就算了，位置只在这次有效
    }
  }, []);

  const togglePinned = useCallback(() => {
    setState((current) => {
      const next = { ...current, pinned: !current.pinned };
      save(next);
      return next;
    });
  }, [save]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOffset.current = { dx: event.clientX - state.x, dy: event.clientY - state.y };
      setDragging(true);
    },
    [state.x, state.y],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const offset = dragOffset.current;
    if (!offset) return;
    setState((current) =>
      clampPosition({ ...current, x: event.clientX - offset.dx, y: event.clientY - offset.dy }),
    );
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragOffset.current) return;
      dragOffset.current = null;
      setDragging(false);
      setState((current) => {
        const clamped = clampPosition(current);
        save(clamped);
        return clamped;
      });
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    [save],
  );

  const expanded = state.pinned || hovered || dragging;
  // 钉住但鼠标不在附近：只留气泡，卡片外观撤掉
  const bare = state.pinned && !hovered && !dragging;

  return (
    <div
      className={cx(styles.dock, 'stage-chat-dock')}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        if (dragging) return;
        setHovered(false);
      }}
      style={{ left: state.x, top: state.y }}
    >
      <button
        aria-label="对话记录（可拖动）"
        className={cx(styles.handle, 'stage-chat-handle')}
        data-bare={bare}
        data-open={expanded}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="对话记录（按住拖动）"
        type="button"
      >
        <MessagesSquare size={18} />
      </button>

      <div
        className={cx(
          styles.panel,
          'stage-chat-panel',
          expanded ? styles.open : styles.closed,
          bare && styles.bare,
        )}
      >
        <div className={cx(styles.head, bare && styles.headBare)}>
          <span className={styles.headTitle}>
            对话记录
            <span className={styles.tag} title="后台没有接模型，回复是按规则挑的">
              占位
            </span>
          </span>

          <span className={styles.headActions}>
            {lines.length > 0 ? (
              <button className={styles.clear} onClick={clearHistory} type="button">
                清空
              </button>
            ) : null}
            <button
              aria-label={state.pinned ? '取消钉住（收成浮标）' : '钉住（让它常显）'}
              className={cx(styles.iconButton, 'stage-chat-pin')}
              data-pinned={state.pinned}
              onClick={togglePinned}
              title={state.pinned ? '已钉住：点一下收成浮标' : '钉住：让它一直显示'}
              type="button"
            >
              {state.pinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>
          </span>
        </div>

        <div className={styles.body} ref={bodyRef}>
          {lines.length === 0 ? (
            <div className={cx(styles.empty, bare && styles.emptyHidden)}>
              还没聊过。在下面输入一句，她会回答——
              现在的回答是按关键词挑的占位句子，后台没有模型。
            </div>
          ) : (
            lines.map((line) => (
              <div
                className={cx(styles.row, line.role === 'user' && styles.rowUser)}
                key={line.id}
              >
                <div
                  className={cx(styles.bubble, line.role === 'user' && styles.bubbleUser)}
                  title={line.placeholder ? '占位回复·不是模型' : undefined}
                >
                  {line.text}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatHistory;
