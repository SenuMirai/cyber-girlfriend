// 声线目录
// 来源分三级，界面上会明确标注，绝不把没核实的音色伪装成官方音色：
//   official   ── Vivix 官方文档《Choose a voice》里直接列出的内置音色（含 ElevenLabs 示例音色）
//   candidate  ── 阿里通义 CosyVoice 官方音色表里的音色 ID。Vivix 底层用的就是 Qwen Audio / CosyVoice 系，
//                 这些 ID 「可能」可直接用，但 Vivix 文档未列出，属于待验证，界面上标注为候选。
//   自定义      ── 用户自己知道的 ID，或用 Vivix 音色克隆（Voices API）拿到的 voice_xxx
// 分组只做展示用途，provider/model 一致的音色才会被写进 tts_config。

export const DEFAULT_PROVIDER = { provider: "", model: "" };

export const VOICE_GROUPS = [
  {
    id: "female",
    label: "女声 · Vivix 内置（已验证）",
    source: "official",
    provider: "",
    model: "",
    items: [
      { id: "longanlingxi", name: "龙安灵汐", desc: "甜美明亮" },
      { id: "longanxiaoxin", name: "龙安小欣", desc: "亲切活泼" },
      { id: "longanhuan_v3.6", name: "龙安欢", desc: "俏皮灵动 · 默认" },
      { id: "longanfengyue", name: "龙安枫月", desc: "自然亲切" },
      { id: "longanyuanfei", name: "龙安元菲", desc: "沉稳有气场" }
    ]
  },
  {
    id: "male",
    label: "男声 · Vivix 内置（已验证）",
    source: "official",
    provider: "",
    model: "",
    items: [
      { id: "longchuanshu_v3.6", name: "龙传书", desc: "成熟男声 · 带四川口音" }
    ]
  },
  {
    id: "youth",
    label: "少年 / 正太 · Vivix 内置（已验证）",
    source: "official",
    provider: "",
    model: "",
    items: [
      { id: "longjielidou_v3.6", name: "龙杰力豆", desc: "少年男声 · 清亮" },
      { id: "longhuohuo_v3.6", name: "龙伙伙", desc: "少年男声 · 俏皮" },
      { id: "longpaopao_v3.6", name: "龙泡泡", desc: "软萌少女 / 童声" }
    ]
  },
  {
    id: "english",
    label: "英文 · Vivix 内置（已验证）",
    source: "official",
    provider: "",
    model: "",
    items: [
      { id: "loongjohn", name: "John", desc: "男 · 沉稳友好美音" },
      { id: "loongmary", name: "Mary", desc: "女 · 温暖英音" },
      { id: "loongeva_v3.6", name: "Eva", desc: "女 · 沉稳美音" }
    ]
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs（需另配 ElevenLabs Key）",
    source: "official",
    provider: "elevenlabs",
    model: "eleven_v3",
    items: [
      { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "男 · 温暖成熟英音" },
      { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", desc: "男 · 低沉有力澳音" },
      { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", desc: "女 · 明亮温暖美音" }
    ]
  },
  {
    id: "candidate",
    label: "候选男声 · 来自 CosyVoice 官方表（未在 Vivix 文档列出，需自行验证）",
    source: "candidate",
    provider: "",
    model: "",
    items: [
      { id: "longanyang", name: "龙安洋", desc: "阳光大男孩 20-30" },
      { id: "longtian_v3", name: "龙天", desc: "磁性理智男 30-35" },
      { id: "longanlang_v3", name: "龙安朗", desc: "清爽利落男 20-25" },
      { id: "longanshuo_v3", name: "龙安朔", desc: "干净清爽男 20-25" },
      { id: "longcheng_v3", name: "龙橙", desc: "智慧青年男 20-25" },
      { id: "longze_v3", name: "龙泽", desc: "温暖元气男 25-30" },
      { id: "longzhe_v3", name: "龙哲", desc: "呆板大暖男 25-30" },
      { id: "longyingxun_v3", name: "龙应询", desc: "年轻青涩男 20-25" },
      { id: "longyichen_v3", name: "龙逸尘", desc: "洒脱活力男 20-30" },
      { id: "longfei_v3", name: "龙飞", desc: "热血磁性男 30-35" },
      { id: "longjiqi_v3", name: "龙机器", desc: "呆萌机器人 20-30" },
      { id: "longhouge_v3", name: "龙猴哥", desc: "经典猴哥 20-25" }
    ]
  },
  {
    id: "candidate-youth",
    label: "候选少年 / 童声 · 同上（需自行验证）",
    source: "candidate",
    provider: "",
    model: "",
    items: [
      { id: "longwangwang_v3", name: "龙汪汪", desc: "台湾少年音 6-15" },
      { id: "longniuniu_v3", name: "龙牛牛", desc: "阳光男童声 6-15" },
      { id: "longxian_v3", name: "龙仙", desc: "豪放可爱 12 岁" },
      { id: "longling_v3", name: "龙铃", desc: "稚气呆板 10 岁" },
      { id: "longhuhu_v3", name: "龙呼呼", desc: "天真烂漫 6-10" },
      { id: "longshanshan_v3", name: "龙闪闪", desc: "戏剧化童声 6-15" }
    ]
  },
  {
    id: "candidate-female",
    label: "候选女声 · 同上（需自行验证）",
    source: "candidate",
    provider: "",
    model: "",
    items: [
      { id: "longhua_v3", name: "龙华", desc: "元气甜美女 20-25" },
      { id: "longantai_v3", name: "龙安台", desc: "嗲甜台湾女 20-25" },
      { id: "longxing_v3", name: "龙星", desc: "温婉邻家女 20-25" },
      { id: "longanqin_v3", name: "龙安亲", desc: "亲和活泼女 20-25" },
      { id: "longanling_v3", name: "龙安灵", desc: "思维灵动女 20-30" },
      { id: "longanya_v3", name: "龙安雅", desc: "高雅气质女 25-35" },
      { id: "longanwen_v3", name: "龙安温", desc: "优雅知性女 25-35" },
      { id: "longyingtao_v3", name: "龙应桃", desc: "温柔淡定女 25-30" },
      { id: "longyingjing_v3", name: "龙应静", desc: "低调冷静女 25-35" },
      { id: "longxiaochun_v3", name: "龙小淳", desc: "知性积极女 25-30" },
      { id: "longfeifei_v3", name: "龙菲菲", desc: "甜美娇气女 20-25" },
      { id: "longwanjun_v3", name: "龙婉君", desc: "细腻柔声女 20-30" },
      { id: "longdaiyu_v3", name: "龙黛玉", desc: "娇率才女音 15-25" },
      { id: "longlaobo_v3", name: "龙老伯", desc: "沧桑老年男 60+" },
      { id: "longlaoyi_v3", name: "龙老姨", desc: "从容阿姨 60+" }
    ]
  }
];

// 把音色 ID 反查成分组与展示名，用于角色卡片、下拉回显
export function findVoice(id) {
  for (const g of VOICE_GROUPS) {
    const hit = g.items.find((v) => v.id === id);
    if (hit) return { ...hit, group: g };
  }
  return null;
}

export function voiceLabel(id) {
  if (!id) return "";
  const hit = findVoice(id);
  return hit ? `${hit.name}（${hit.desc}）` : id;
}

// 该音色是否属于 ElevenLabs（决定要不要写 tts_provider / tts_model_id）
export function providerFor(id) {
  const hit = findVoice(id);
  if (hit && hit.group.provider) return { provider: hit.group.provider, model: hit.group.model, source: hit.group.source };
  return { provider: "", model: "", source: hit ? hit.group.source : "custom" };
}
