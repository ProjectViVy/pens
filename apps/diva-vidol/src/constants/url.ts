import urlJoin from 'url-join';

export const UTM_SOURCE = 'lobevidol';

export const GITHUB_REPO = 'https://github.com/lobehub/lobe-vidol';

export const AGENTS_INDEX_GITHUB = 'https://github.com/lobehub/lobe-vidol-market';
export const AGENTS_INDEX_GITHUB_ISSUE = urlJoin(AGENTS_INDEX_GITHUB, 'issues/new');
export const imageUrl = (filename: string) => `/images/${filename}`;

export const MORE_MODEL_PROVIDER_REQUEST_URL =
  'https://github.com/lobehub/lobe-vidol/discussions/162';

export const DISCORD = 'https://discord.gg/AYFPHvv2jT';
export const DOCUMENTS_REFER_URL = 'https://docs.vidol.chat';

/**
 * TODO: 改为企业邮箱
 */
export const EMAIL_SUPPORT = 'mailto:rdmclin2@gmail.com';

/** 赞助作者：Ko-fi 与微信赞赏码（原左侧栏「支持作者」气泡里的两条） */
export const KO_FI = 'https://ko-fi.com/Q5Q214AGLQ';
export const WECHAT_QRCODE_URL = 'https://r2.vidol.chat/common/wechat.jpg';

export const BASE_PROVIDER_DOC_URL = 'https://docs.vidol.chat/usage/providers';

export const GITHUB_ISSUES = 'https://github.com/lobehub/lobe-vidol/issues/new';
