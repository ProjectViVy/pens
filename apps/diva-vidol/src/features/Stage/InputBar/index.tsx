'use client';

import { ActionIcon } from '@lobehub/ui';
import { message } from 'antd';
import { useTheme } from 'antd-style';
import { SendHorizontal, Mic } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import { placeholderReply } from '@/libs/dialogue/reply';
import { playSegments } from '@/libs/dialogue/say';
import { splitSegments } from '@/libs/dialogue/segments';
import { useDialogueStore } from '@/store/dialogue';

import Subtitle from '../Subtitle';
import { useStyles } from './style';

/** 浏览器自带语音识别的类型（TS 的 lib.dom 里没有，这里只写用到的那几个字段） */
interface SpeechResult {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}

interface SpeechRecognitionLike {
  addEventListener: (type: 'error', handler: (event: { error: string }) => void) => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** 「后台没接模型」这件事只提醒一次，别每句都弹 */
let placeholderNoticed = false;

/**
 * 舞台底部的输入框（发起对话）
 *
 * **这里没有接任何模型。** 你发一句，她的回复是按关键词从 `libs/dialogue/reply.ts` 挑的占位句子，
 * 用来把这条链路跑通：发消息 → 回复进历史 → 回复切成一句句在输入框上方逐句显示。
 * 接了真模型之后换掉 `placeholderReply` 就行，分段/字幕/历史都不用动。
 *
 * - 字幕不在这里：由 `Subtitle` 组件画在画面正中（大字），这里只负责发起对话
 * - 同时播动作库里「说话」的循环待机片段，时长按整段算
 * - 麦克风走浏览器自带语音识别，识别结果只填进输入框，发不发由你决定
 */
const InputBar = memo(() => {
  const { styles, cx } = useStyles();
  const theme = useTheme();
  const [value, setValue] = useState('');
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  /**
   * 展开 / 收起
   *
   * 默认只有一小截（不挡画面），点一下才拉开成完整的输入框；写完/点了别处又收回去。
   * 有文字或者正在听的时候不收回——打字打到一半框自己缩走是最烦的一种交互。
   */
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike>();

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognition()));
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  /**
   * 点别处就收回
   *
   * 不能只靠 input 的 blur：舞台的 canvas 会拦掉 pointerdown 的默认行为（拖镜头要用），
   * 所以点 3D 画面时输入框根本不失焦。这里直接挂在 document 上，按「点到了框外面」判断。
   * 有文字、正在听的时候不收——不然打字打到一半框自己缩走。
   */
  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (value.trim() || listening) return;
      setExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded, value, listening]);

  /**
   * 发一句 → 回复进来 → 字幕一句句出
   *
   * 注意顺序：先把你说的记进历史，再把回复记进历史，最后才播字幕。
   * 历史是「说过什么」的记录，字幕是「此刻正在说什么」，两件事分开。
   */
  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    setValue('');

    const { pushUser, pushAssistant } = useDialogueStore.getState();
    pushUser(text);

    const reply = placeholderReply(text);
    if (!reply) return;
    pushAssistant(reply, true);

    if (!placeholderNoticed) {
      placeholderNoticed = true;
      message.info('后台没有接模型：她现在是按关键词挑的占位回复');
    }

    void playSegments(splitSegments(reply), 'neutral');

    // 点的是发送按钮，输入框会失焦；把焦点还回去，接着写下一句不用再点一下
    inputRef.current?.focus();
  }, [value]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = undefined;
    setListening(false);
  }, []);

  const handleMic = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }

    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setSpeechSupported(false);
      message.info('这个浏览器不带语音识别，用 Chrome / Edge 打开才有');
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      // 把这一次的所有结果拼起来（中间结果也会带过来，所以每次整体替换而不是追加）
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setValue(transcript);
    };
    recognition.addEventListener('error', (event) => {
      setListening(false);
      // not-allowed = 没给麦克风权限；no-speech = 没听到人说话。都不是「坏了」
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        message.info('没有麦克风权限：在地址栏那把锁里允许一次再试');
      } else if (event.error === 'no-speech') {
        message.info('没听到声音');
      } else {
        // 剩下的（network / audio-capture / aborted…）不说清楚就只能猜，直接把原始原因报出来
        message.info(`语音识别没成功：${event.error}（可以先用键盘输入）`);
      }
    });
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      // 连点两下时浏览器会抛「already started」，按已在听处理
    }
  }, [listening, stopListening]);

  return (
    <div className={cx(styles.center, !expanded && styles.centerCollapsed)} ref={rootRef}>
      {/* 她的台词：就在输入框正上方，一句一句地出；说过的话去左边浮窗看 */}
      <Subtitle />
      <div
        className={cx(styles.bar, listening && styles.listening)}
        onBlur={(event) => {
          // 焦点还留在这颗框里（比如从输入框点到麦克风）就不算「离开」。
          // 有文字、正在听的时候也不收：否则打字/说话到一半框自己缩走。
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          if (!expanded || value.trim() || listening) return;
          setExpanded(false);
        }}
        onClick={() => {
          // 点胶囊的任何地方都等于「拉开」，不用非得点中那一下输入区
          if (expanded) return;
          setExpanded(true);
          inputRef.current?.focus();
        }}
      >
        <input
          className="stage-input"
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              handleSend();
              return;
            }
            if (event.key === 'Escape') {
              setValue('');
              setExpanded(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={
            listening ? '正在听……' : expanded ? '跟她说一句，她会回你' : '说点什么…'
          }
          ref={inputRef}
          style={{
            flex: 1,
            minWidth: 0,
            padding: expanded ? '0 4px' : '0 2px',
            fontSize: 15,
            lineHeight: '38px',
            color: 'inherit',
            background: 'transparent',
            border: 'none',
            outline: 'none',
          }}
          value={value}
        />
        <ActionIcon
          active={listening}
          className="stage-mic"
          icon={Mic}
          onClick={handleMic}
          size={{ fontSize: 19, borderRadius: 20, blockSize: 36 }}
          title={speechSupported ? '语音输入（浏览器识别）' : '这个浏览器不支持语音识别'}
          style={{
            color: listening ? '#fff' : undefined,
            backgroundColor: listening ? theme.colorError : 'transparent',
          }}
        />
        {/* 发送只在拉开时出现：收起态那一小截里挤三个控件就没法看了 */}
        {expanded ? (
          <ActionIcon
            className="stage-send"
            disable={!value.trim()}
            icon={SendHorizontal}
            onClick={handleSend}
            size={{ fontSize: 19, borderRadius: 20, blockSize: 36 }}
            style={{
              color: value.trim() ? '#fff' : undefined,
              backgroundColor: value.trim() ? theme.colorPrimary : 'transparent',
            }}
          />
        ) : null}
      </div>
    </div>
  );
});

export default InputBar;
