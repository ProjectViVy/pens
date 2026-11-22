'use client';

import React, { memo, useEffect, useState } from 'react';

import { CHAR_MS, PAUSE_MS, START_DELAY_MS } from '@/libs/dialogue/typing';
import { dialogueSelectors, useDialogueStore } from '@/store/dialogue';

import { useStyles } from './style';

/**
 * 台词（输入框正上方）
 *
 * 打字机：一个字一个字地打出来（`55ms/字`，标点额外停顿），打完停 3 秒，
 * 然后**渐变消失**再轮到下一句——这个节奏由 `libs/dialogue/say.ts` 驱动，
 * 组件只负责把「当前这一句」逐字显出来，以及淡出时挂上过渡样式。
 *
 * 留白是固定预留的：这一块高度始终在，台词出现/消失时输入框不会上下跳。
 */
const Subtitle = memo(() => {
  const { styles, cx } = useStyles();
  const subtitle = useDialogueStore(dialogueSelectors.subtitle);
  const fading = useDialogueStore(dialogueSelectors.subtitleFading);
  const [shown, setShown] = useState('');

  useEffect(() => {
    if (!subtitle) {
      setShown('');
      return;
    }

    let index = 0;
    let timer = 0;
    setShown('');

    const tick = () => {
      index += 1;
      setShown(subtitle.slice(0, index));
      if (index >= subtitle.length) return;
      // 刚打出来的这个字是标点就多停一会儿
      const justTyped = subtitle[index - 1];
      timer = window.setTimeout(tick, PAUSE_MS[justTyped] ?? CHAR_MS);
    };

    timer = window.setTimeout(tick, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [subtitle]);

  return (
    <div className={styles.layer}>
      {shown ? (
        <div className={cx(styles.text, fading && styles.textFading)}>
          {shown}
          {/* 光标：只在打字途中闪，打完了就消失 */}
          {shown.length < subtitle.length ? <span className={styles.caret} /> : null}
        </div>
      ) : null}
    </div>
  );
});

export default Subtitle;
