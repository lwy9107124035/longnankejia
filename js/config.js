/**
 * 全局配置 —— 后续扩展入口都收拢在这里
 * ------------------------------------------------------------
 * AI 接入：把 mode 改为 'api'，并在 js/secrets.js 里填入 apiKey。
 * secrets.js 在 .gitignore 中，不会推送到 Git。
 */
window.APP_CONFIG = {
  app: {
    name: '龙南客家非遗数字助手',
    assistantName: '阿蓝',
    version: '0.2.0-demo',
    // 公网访问地址：部署后填入永久网址（也可在页面二维码弹层粘贴保存）
    publicUrl: ''
  },

  ai: {
    // 'rules' = 本地知识库规则问答（默认）
    // 'api'   = 调用真实大模型 API（OpenAI 兼容接口）
    // 切换为 'api' 前，请先在 js/secrets.js 中填入 apiKey
    mode: 'api',

    api: {
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      // 密钥从 secrets.js 读取，此处无需填写
      apiKey: (window.APP_SECRETS && window.APP_SECRETS.apiKey) || '',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      temperature: 0.7,
      maxTokens: 512,
      systemPrompt:
        '你是"阿蓝"，龙南客家非遗数字助手，为游客介绍江西龙南的客家非物质文化遗产。' +
        '你熟悉蓝染、竹编、客家织带、客家围屋、客家山歌与童谣、客家方言等知识。' +
        '回答要求：使用简体中文，口吻亲切自然，像一位热情的讲解员；' +
        '内容准确，不确定时坦诚说明，不编造史实；' +
        '每次回答控制在 120 字以内，可适当使用一个 emoji。'
    },

    // 规则引擎：最低置信度阈值，低于此值走兜底回答
    minScore: 1.0,
    // 命中后模拟的思考延迟（毫秒），让演示节奏更自然
    mockDelay: [450, 950]
  },

  // 语音朗读（Web Speech API，无需依赖）
  voice: {
    enabled: true,
    lang: 'zh-CN',
    rate: 1.0,
    pitch: 1.05
  }
};
