import { ActionIcon, Form, FormItem, Modal } from '@lobehub/ui';
import { VRMExpressionPresetName } from '@pixiv/three-vrm';
import { Input, Select, Spin } from 'antd';
import { Edit2Icon, Plus } from 'lucide-react';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { INPUT_WIDTH_MD, INPUT_WIDTH_SM } from '@/constants/token';
import { MAX_TOUCH_ACTION_TEXT_LENGTH } from '@/constants/touch';
import { motionPresetMap } from '@/libs/emoteController/motionPresetMap';
import { loadMotionIndex, MotionClipMeta, MotionIndex } from '@/libs/motionLibrary';
import { useSettingStore } from '@/store/setting';
import { GenderEnum } from '@/types/character';
import { TouchAction, TouchAreaEnum } from '@/types/touch';

export interface Props {
  gender: GenderEnum;
  index?: number;
  isEdit?: boolean;
  touchAction?: TouchAction;
  touchArea: TouchAreaEnum;
}

/** 选择器里用 `clip:` / `preset:` 前缀区分两种来源 */
const CLIP_PREFIX = 'clip:';
const PRESET_PREFIX = 'preset:';

/**
 * 不放进触摸选择的分类。
 *
 * 走路/转身这类片段带的是「位移」，在人站着不动的时候播出来就是原地滑步
 * （片段本身不驱动位置），所以触摸反应里不给它们。
 */
const EXCLUDED_CATEGORIES = new Set(['locomotion', 'transition']);

/** 动作库里允许挑的分类顺序与中文名 */
const PICKER_GROUPS: { key: string; label: string }[] = [
  { key: 'emotion', label: '情绪' },
  { key: 'response', label: '回应' },
  { key: 'greeting', label: '招呼' },
  { key: 'talking', label: '说话' },
  { key: 'idle', label: '待机' },
  { key: 'seated', label: '坐姿' },
  { key: 'world-gesture', label: '场景手势' },
  { key: 'world-idle', label: '场景待机' },
];

const AddOrEdit = memo<Props>(({ touchArea, index, touchAction, isEdit = true, gender }) => {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { t } = useTranslation('role');

  const [index_, setIndex] = useState<MotionIndex | undefined>(undefined);
  const [indexError, setIndexError] = useState<string | undefined>(undefined);

  const [updateTouchAction, createTouchAction] = useSettingStore((s) => [
    s.updateTouchAction,
    s.createTouchAction,
  ]);

  // 动作库索引只在第一次打开时拉，之后走模块内缓存
  useEffect(() => {
    if (!open) return;
    loadMotionIndex()
      .then(setIndex)
      .catch((error) => setIndexError(String(error)));
  }, [open]);

  /**
   * 动作选择项：真实片段（151 个）在前，旧预设（17 个）在后。
   *
   * 之所以两种都留着：老配置里存的是 `motion`（预设名），换了选择器不能让它失效；
   * 新配置存 `clipId`，播的就是动作面板里能预览的那个片段。
   */
  const motionOptions = useMemo(() => {
    const clips = index_?.clips ?? [];
    const groups = PICKER_GROUPS.map((group) => ({
      label: group.label,
      options: clips
        .filter((clip) => clip.category === group.key && !EXCLUDED_CATEGORIES.has(clip.category))
        .map((clip: MotionClipMeta) => ({
          label: `${clip.label || clip.id}${clip.loop ? ' ↻' : ''}`,
          value: `${CLIP_PREFIX}${clip.id}`,
        })),
    })).filter((group) => group.options.length > 0);

    groups.push({
      label: '旧预设',
      options: Object.entries(motionPresetMap).map(([key, value]) => ({
        // 预设的 name 常常就是「开心」这种词，和表情列表撞名，加前缀才分得清
        label: `预设 · ${value.name}（${key}）`,
        value: `${PRESET_PREFIX}${key}`,
      })),
    });

    return groups;
  }, [index_]);

  // 老数据只有 motion（预设），新数据是 clipId；统一成选择器的 value
  const initialValues = useMemo(() => {
    if (!isEdit || !touchAction) return { expression: VRMExpressionPresetName.Neutral };
    return {
      ...touchAction,
      motion: touchAction.clipId
        ? `${CLIP_PREFIX}${touchAction.clipId}`
        : touchAction.motion
          ? `${PRESET_PREFIX}${touchAction.motion}`
          : undefined,
    };
  }, [isEdit, touchAction]);

  const showModal = () => {
    setOpen(true);
  };

  const handleOk = () => {
    form.validateFields().then((values) => {
      setOpen(false);

      const { motion, ...rest } = values as {
        expression: VRMExpressionPresetName;
        motion?: string;
        text: string;
      };
      const next: TouchAction = {
        expression: rest.expression,
        text: rest.text,
      };

      if (motion?.startsWith(CLIP_PREFIX)) {
        const clipId = motion.slice(CLIP_PREFIX.length);
        next.clipId = clipId;
        next.clipLoop = index_?.clips.find((clip) => clip.id === clipId)?.loop ?? false;
      } else if (motion?.startsWith(PRESET_PREFIX)) {
        next.motion = motion.slice(PRESET_PREFIX.length) as TouchAction['motion'];
      }

      if (isEdit) {
        updateTouchAction(gender, touchArea, index!, next);
      } else {
        createTouchAction(gender, touchArea, next);
      }
    });
  };

  const handleCancel = () => {
    setOpen(false);
  };

  return (
    <>
      <ActionIcon
        // 联调要靠 className 定位（ActionIcon 不把 title 写到 DOM 上）
        className={isEdit ? 'touch-edit' : 'touch-add'}
        icon={isEdit ? Edit2Icon : Plus}
        title={isEdit ? t('actions.edit', { ns: 'chat' }) : t('actions.add', { ns: 'chat' })}
        onClick={showModal}
      />
      <Modal
        allowFullscreen
        onCancel={handleCancel}
        onOk={handleOk}
        open={open}
        width={800}
        destroyOnClose
        title={
          isEdit ? t('touch.editAction', { ns: 'role' }) : t('touch.addAction', { ns: 'role' })
        }
        okText={t('confirm', { ns: 'common' })}
        cancelText={t('cancel', { ns: 'common' })}
      >
        <Form layout="horizontal" requiredMark initialValues={initialValues} form={form} preserve={false}>
          <FormItem
            label={t('info.textLabel', { ns: 'role' })}
            desc={t('info.textDescription', { ns: 'role' })}
            name={'text'}
            rules={[{ required: true, message: t('touch.inputDIYText', { ns: 'role' }) }]}
          >
            <Input.TextArea
              placeholder={t('touch.inputActionText', { ns: 'role' })}
              maxLength={MAX_TOUCH_ACTION_TEXT_LENGTH}
              showCount
              autoSize
              style={{ width: INPUT_WIDTH_MD }}
            />
          </FormItem>
          <FormItem
            label={t('info.emotionLabel', { ns: 'role' })}
            desc={t('info.emotionDescription', { ns: 'role' })}
            divider
            rules={[{ required: true, message: t('touch.inputActionEmotion', { ns: 'role' }) }]}
            name="expression"
          >
            <Select
              options={[
                {
                  label: t('touch.expression.natural', { ns: 'role' }),
                  value: VRMExpressionPresetName.Neutral,
                },
                {
                  label: t('touch.expression.happy', { ns: 'role' }),
                  value: VRMExpressionPresetName.Happy,
                },
                {
                  label: t('touch.expression.angry', { ns: 'role' }),
                  value: VRMExpressionPresetName.Angry,
                },
                {
                  label: t('touch.expression.sad', { ns: 'role' }),
                  value: VRMExpressionPresetName.Sad,
                },
                {
                  label: t('touch.expression.relaxed', { ns: 'role' }),
                  value: VRMExpressionPresetName.Relaxed,
                },
                {
                  label: t('touch.expression.surprised', { ns: 'role' }),
                  value: VRMExpressionPresetName.Surprised,
                },
                {
                  label: t('touch.expression.blink', { ns: 'role' }),
                  value: VRMExpressionPresetName.Blink,
                },
                {
                  label: t('touch.expression.blinkLeft', { ns: 'role' }),
                  value: VRMExpressionPresetName.BlinkLeft,
                },
                {
                  label: t('touch.expression.blinkRight', { ns: 'role' }),
                  value: VRMExpressionPresetName.BlinkRight,
                },
              ]}
              style={{ width: INPUT_WIDTH_SM }}
              defaultActiveFirstOption={true}
            />
          </FormItem>
          <FormItem
            label={t('info.motionLabel', { ns: 'role' })}
            desc={`${t('info.motionDescription', { ns: 'role' })}（上组是动作库真实片段，下组是旧预设）`}
            divider
            rules={[{ required: true, message: t('touch.inputActionMotion', { ns: 'role' }) }]}
            name="motion"
          >
            <Select
              options={motionOptions}
              style={{ width: INPUT_WIDTH_SM }}
              defaultActiveFirstOption={true}
              showSearch
              optionFilterProp="label"
              notFoundContent={
                indexError ? (
                  <span>{indexError}</span>
                ) : index_ ? undefined : (
                  <Spin size="small" />
                )
              }
            />
          </FormItem>
        </Form>
      </Modal>
    </>
  );
});

export default AddOrEdit;
