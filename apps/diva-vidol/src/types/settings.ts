/**
 * 设置项里与「系统模型」相关的类型
 *
 * 名字沿用历史叫法（SystemAgent = 由系统调用的小模型配置，比如情感分析），
 * 和已经删掉的聊天角色 agent 无关：这里只是一组 provider/model 的配置。
 */

export interface SystemAgentItem {
  customPrompt?: string;
  enabled?: boolean;
  model: string;
  provider: string;
}

export interface SystemAgentConfig {
  emotionAnalysis: SystemAgentItem;
}

export type SystemAgentConfigKey = keyof SystemAgentConfig;
