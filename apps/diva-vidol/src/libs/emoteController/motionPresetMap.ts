import { MotionFileType } from './type';

export enum MotionPresetName {
  FemaleHappy = 'female_happy', //开心
  FemaleAngry = 'female_angry', //生气
  FemaleGreeting = 'female_greeting', //招呼
  FemaleAppeal = 'female_appeal', // 吸引
  Idle = 'idle', //空闲
  FemaleCoverUndies = 'female_cover_undies',
  FemaleKiss = 'female_kiss',
  NumberMeter1 = 'number_meter_1',
  NumberMeter2 = 'number_meter_2',
  NumberMeter3 = 'number_meter_3',
  NumberMeter4 = 'number_meter_4',
  NumberMeter5 = 'number_meter_5',
  FemaleCoverChest = 'female_cover_chest',
  FemaleStand = 'female_stand',
  FemaleStandMix = 'female_stand_mix',
  MaleHappy = 'male_happy',
  MaleAngry = 'male_angry',
}

/**
 * 动作素材线（Hanami → lobe 移植）
 *
 * 素材来自 `public/vrma/`：Overte（Apache-2.0）、Microsoft Rocketbox（MIT）、
 * Quaternius（CC0），经 `scripts/port-hanami-motion.mjs` 索引到 `vrma/index.json`。
 * 这里只保留旧面板仍按名引用的 17 个「预设」，映射到语义最接近的真实片段；
 * 完整动作库由动作面板直接读索引（见 `libs/motionLibrary`）。
 */
export interface MotionPreset {
  url: string;
  type: MotionFileType;
  name: string;
  /** 一次性动作播完自动回 idle；待机类为 true */
  loop: boolean;
}

export const motionPresetMap: Record<MotionPresetName, MotionPreset> = {
  idle: { url: '/vrma/idle.vrma', type: MotionFileType.VRMA, name: '待机', loop: true },
  female_happy: { url: '/vrma/happy.vrma', type: MotionFileType.VRMA, name: '开心', loop: false },
  male_happy: { url: '/vrma/happy-2.vrma', type: MotionFileType.VRMA, name: '开心', loop: false },
  female_angry: { url: '/vrma/angry.vrma', type: MotionFileType.VRMA, name: '生气', loop: false },
  male_angry: { url: '/vrma/angry-2.vrma', type: MotionFileType.VRMA, name: '生气', loop: false },
  female_greeting: {
    url: '/vrma/raise-hand.vrma',
    type: MotionFileType.VRMA,
    name: '打招呼',
    loop: false,
  },
  female_appeal: { url: '/vrma/think.vrma', type: MotionFileType.VRMA, name: '思考', loop: false },
  female_cover_undies: {
    url: '/vrma/neutral.vrma',
    type: MotionFileType.VRMA,
    name: '中性',
    loop: false,
  },
  female_kiss: {
    url: '/vrma/relaxed.vrma',
    type: MotionFileType.VRMA,
    name: '放松',
    loop: false,
  },
  female_cover_chest: {
    url: '/vrma/rb-neutral.vrma',
    type: MotionFileType.VRMA,
    name: '中性',
    loop: false,
  },
  female_stand: { url: '/vrma/idle-2.vrma', type: MotionFileType.VRMA, name: '待机', loop: true },
  female_stand_mix: {
    url: '/vrma/idle-3.vrma',
    type: MotionFileType.VRMA,
    name: '待机',
    loop: true,
  },
  number_meter_1: {
    url: '/vrma/world-point-in.vrma',
    type: MotionFileType.VRMA,
    name: '指',
    loop: false,
  },
  number_meter_2: {
    url: '/vrma/world-point-hold.vrma',
    type: MotionFileType.VRMA,
    name: '指（保持）',
    loop: true,
  },
  number_meter_3: {
    url: '/vrma/world-point-out.vrma',
    type: MotionFileType.VRMA,
    name: '收手',
    loop: false,
  },
  number_meter_4: {
    url: '/vrma/world-clap-in.vrma',
    type: MotionFileType.VRMA,
    name: '拍手',
    loop: false,
  },
  number_meter_5: {
    url: '/vrma/world-clap-hold.vrma',
    type: MotionFileType.VRMA,
    name: '拍手（保持）',
    loop: true,
  },
};

/** 待机片段的 url（一次性动作播完回到它） */
export const IDLE_MOTION_URL = motionPresetMap[MotionPresetName.Idle].url;

