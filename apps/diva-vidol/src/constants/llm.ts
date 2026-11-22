import { ModelProvider } from '@/libs/agent-runtime';
import { SystemAgentConfig, SystemAgentItem } from '@/types/settings';

/**
 * 语言模型的默认配置
 *
 * 这些值原来放在 constants/agent.ts 里，和「聊天角色 agent」混在一起；
 * agent 概念删除后挪到这里，只保留模型调用需要的东西（语言模型设置页 + 连接测试）。
 */

export const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
export const DEFAULT_CHAT_PROVIDER = ModelProvider.OpenAI;

/** 默认的生成参数 */
export const DEFAULT_LLM_CONFIG = {
  model: DEFAULT_CHAT_MODEL,
  provider: DEFAULT_CHAT_PROVIDER,
  params: {
    frequency_penalty: 0,
    presence_penalty: 0,
    temperature: 0.6,
    top_p: 1,
  },
};

export const DEFAULT_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  model: DEFAULT_CHAT_MODEL,
  provider: DEFAULT_CHAT_PROVIDER,
};

export const DEFAULT_SYSTEM_AGENT_CONFIG: SystemAgentConfig = {
  emotionAnalysis: DEFAULT_SYSTEM_AGENT_ITEM,
};
