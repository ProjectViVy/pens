import { VRMExpressionPresetName } from '@pixiv/three-vrm';

import { MotionPresetName } from '@/libs/emoteController/motionPresetMap';
import { GenderEnum } from '@/types/character';

import { TTS } from './tts';

/**
 * 表情类型
 */
export type ExpressionType = VRMExpressionPresetName;

/**
 * 触摸区域枚举
 *
 * 和骨骼的对应关系见 `Model.mapBoneNameToTouchArea`：
 * - head：头/颈/眼/下颌（头还有独立的点击盒）
 * - chest：胸（含 upperChest）——「上半身」
 * - belly：spine + hips 之间的肚子（spine 落这里）
 * - arm：上臂/前臂/手——「手和手臂」
 * - leg：大腿/小腿
 * - foot：脚掌/脚趾
 * - buttocks：hips
 */
export enum TouchAreaEnum {
  Arm = 'arm',
  Belly = 'belly',
  Buttocks = 'buttocks',
  Chest = 'chest',
  Foot = 'foot',
  Head = 'head',
  Leg = 'leg',
}

/**
 * 触摸动作接口
 */
export interface TouchAction {
  /**
   * 动作库片段 id（`public/vrma/index.json` 里的 151 个真实片段，如 `world-nod`）。
   *
   * 和 `motion` 二选一：给了 `clipId` 就直接播这个片段，不再走预设映射。
   */
  clipId?: string;
  /** 片段本身是否循环（循环片段播几秒后由世界那套收回待机） */
  clipLoop?: boolean;
  /**
   * 表情
   */
  expression: ExpressionType;
  /**
   * 动作（旧预设，17 个）
   */
  motion?: MotionPresetName;
  /**
   * 文本
   */
  text: string;
}

/**
 * 动作类别枚举
 */
export enum MotionCategoryEnum {
  DANCE = 'Dance',
  NORMAL = 'Normal',
}

/**
 * 姿势类别枚举
 */
export enum PostureCategoryEnum {
  ACTION = 'Action',
  CROUCH = 'Crouch',
  DANCE = 'Dance',
  LAYING = 'Laying',
  LOCOMOTION = 'Locomotion',
  SITTING = 'Sitting',
  STANDING = 'Standing',
}

/**
 * 动作动画接口
 */
export interface MotionAnimation {
  /**
   * 头像
   */
  avatar: string;
  /**
   * 类别
   */
  category: MotionCategoryEnum | PostureCategoryEnum;
  /**
   * 描述
   */
  description: string;
  /**
   * 性别
   */
  gender: GenderEnum;
  /**
   * ID
   */
  id: string;
  /**
   * 名称
   */
  name: string;
  /**
   * 类型
   */
  type: string;
  /**
   * URL
   */
  url: string;
}

/**
 * 触摸动作配置接口
 */
export interface TouchActionConfig {
  enable?: boolean;
  [TouchAreaEnum.Head]: TouchAction[];
  [TouchAreaEnum.Arm]: TouchAction[];
  [TouchAreaEnum.Leg]: TouchAction[];
  [TouchAreaEnum.Foot]: TouchAction[];
  [TouchAreaEnum.Chest]: TouchAction[];
  [TouchAreaEnum.Belly]: TouchAction[];
  [TouchAreaEnum.Buttocks]: TouchAction[];
}

/**
 * 剧本类型
 */
export type Screenplay = {
  /**
   * 表情
   */
  expression: ExpressionType;
  /**
   * 动作（可选）
   */
  motion?: MotionPresetName;
  /**
   * 语音合成
   */
  tts: TTS;
};
