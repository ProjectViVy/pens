/**
 * 人物（角色模型）
 *
 * 拆分说明：原来的 `Agent` 是「聊天角色」——带 systemRole、模型供应商、语音、
 * 会话历史等一整套对话数据。聊天链路已经全部移除，后续要走 neurolink 外部接入，
 * 所以这里只保留舞台真正需要的东西：一个 VRM 模型 + 展示信息 + 性别（决定触摸反应）。
 *
 * 不再有 agent id / 市场下载 / 会话绑定，人物就是本地 public/assets/agents 下的模型。
 */

export enum GenderEnum {
  FEMALE = 'Female',
  MALE = 'Male',
}

export interface Character {
  /** 头像 */
  avatar: string;
  /** 封面（比头像大，用于展示） */
  cover: string;
  /** 描述 */
  description?: string;
  /** 性别，决定触摸反应取哪一套 */
  gender: GenderEnum;
  /** 唯一标识，也是本地缓存/持久化的 key */
  id: string;
  /** VRM 模型地址（本地 /assets/agents/...） */
  modelUrl: string;
  /** 展示名称 */
  name: string;
}
