/**
 * 全局配置 —— 后续扩展入口都收拢在这里
 * ------------------------------------------------------------
 * AI 接入：把 mode 改为 'api'，填好 apiKey 即可切换到真实大模型。
 * 目前默认 'rules'（本地知识库），离线可用、演示零风险。
 */
window.APP_CONFIG = {
  app: {
    name: '龙南客家非遗数字助手',
    assistantName: '阿蓝',
    version: '0.2.0-demo',
    // 公网访问地址：部署到 Netlify/GitHub Pages 后填入永久网址
    // 也可以在页面二维码弹层里粘贴保存（会覆盖此处配置并存入 localStorage）。
    publicUrl: ''
  },

  ai: {
    // 'rules' = 本地知识库规则问答（默认）
    // 'api'   = 调用真实大模型 API（OpenAI 兼容接口）
    mode: 'rules',

    // —— API 模式配置（mode: 'api' 时生效）——
    // 推荐 SiliconFlow（硅基流动）免费模型，注册后获取 API Key：
    //   https://cloud.siliconflow.cn
    // 其他 OpenAI 兼容服务（DeepSeek、智谱、Moonshot 等）改 baseUrl/model 即可。
    api: {
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      apiKey: '',           // ← 在此填入 API Key
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
