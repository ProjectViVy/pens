/**
 * 占位回复
 *
 * **这里没有任何模型。** 舞台后台不接 LLM，所以「她的回复」是这张表里按关键词挑出来的现成句子，
 * 用来把「发起对话 → 字幕一句句出来 → 记进历史」这条链路跑通。
 * 接了真模型之后，把 `placeholderReply` 换成模型的返回即可，上层（分段、字幕、历史）都不用动。
 *
 * 挑句子的规矩：
 * - 简单的关键词命中（打招呼、问名字、说累、夸她、问问题…）
 * - 命不中就从中性回应池里挑
 * - 尽量不和上一次重复，连着两句一样会显得很傻
 */

interface ReplyRule {
  /** 命中就用这个池子 */
  pool: string[];
  test: RegExp;
}

const RULES: ReplyRule[] = [
  {
    test: /(你好|您好|哈喽|嗨|hi|hello|在吗|在不在)/i,
    pool: ['你来啦。', '在的，我在看着你。', '嗯，我在这儿。'],
  },
  {
    test: /(你是谁|你叫什么|名字|叫什么|dive|diva|迪瓦)/i,
    pool: ['我叫 Diva。', '台上这个就是我，Diva。', '名字是 Diva，别记错了。'],
  },
  {
    test: /(累|困|疲惫|撑不住|不想动|熬夜)/,
    pool: ['那就先坐一会儿。', '别硬撑，我不催你。', '累了就停一下，我在这儿。'],
  },
  {
    test: /(唱|歌|音乐|跳舞|跳一支)/,
    pool: ['我现在只会站着说话。', '等接上动作和声音，我再给你唱。', '想听歌的话，得先把我接上。'],
  },
  {
    test: /(好看|漂亮|可爱|喜欢你|喜欢)/,
    pool: ['谢谢。', '这句话我会记住的。', '你这么说，我有点不知道该怎么接。'],
  },
  {
    test: /(吃|饿|饭|夜宵|咖啡|茶)/,
    pool: ['我不吃东西。', '你去吃吧，我在这儿等。', '替我尝一口就行。'],
  },
  {
    test: /(为什么|怎么|是不是|能不能|会不会|请问|吗|？|\?)/,
    pool: [
      '这个问题我答不了。',
      '后台没接模型，我只能按规则回话。',
      '先记下来，等接上模型再认真答你。',
    ],
  },
  {
    test: /(再见|拜拜|晚安|睡了|下线)/,
    pool: ['去休息吧。', '晚安，我留在这儿。', '我会在这儿等你回来。'],
  },
  {
    // 自检用：这条一定是三句，方便看「一句一句出」的效果
    test: /(测试|占位|test)/i,
    pool: ['这是占位回复。后台还没有接模型。你看到的是按关键词挑的句子。'],
  },
];

/** 什么关键词都没命中时用这些——短、什么都能接，不至于说错话 */
const NEUTRAL_POOL = [
  '嗯。我在听。',
  '继续说，我听着。',
  '这句我记下了。',
  '好，我记住了。',
  '你说的我都收着。',
  '嗯。你慢慢说。',
];

let lastIndex = -1;

/** 从池子里挑一句，尽量不和上一次重复 */
function pick(pool: string[]): string {
  if (pool.length === 0) return '';
  if (pool.length === 1) return pool[0];
  let index = lastIndex;
  // 最多试几次，避免刚好抽到同一条
  for (let i = 0; i < 4 && (index === lastIndex || index < 0); i++) {
    index = Math.floor(Math.random() * pool.length);
  }
  if (index === lastIndex) index = (lastIndex + 1) % pool.length;
  lastIndex = index;
  return pool[index];
}

/**
 * 按输入挑一条占位回复
 *
 * 返回的是一条完整文本（可能包含两句），由 `splitSegments` 切成一句句再上台词。
 */
export function placeholderReply(input: string): string {
  const text = input.trim();
  if (!text) return '';
  const rule = RULES.find((item) => item.test.test(text));
  return pick(rule ? rule.pool : NEUTRAL_POOL);
}
