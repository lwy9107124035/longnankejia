/**
 * 全局配置 —— 后续扩展入口都收拢在这里
 * ------------------------------------------------------------
 * AI 接入：线上请求通过同源 Pages Function 转发，密钥保存在 Cloudflare 服务端绑定中；
 * 本地开发可在被 .gitignore 忽略的 js/secrets.js 中填写 apiKey，直接调用上游接口。
 */
window.APP_CONFIG = {
  app: {
    name: '龙南客家非遗数字助手',
    assistantName: '阿蓝',
    version: 'v2',
    // 公网访问地址。留空 = 用当前网址自己推（见 ui.js 的 currentUrl），
    // 这样同一份构建在 Pages 根路径、Pages 的 /dev/ 子路径、馆内局域网、
    // 本机预览上都扫得出正确的地址；写死某个域名反而会在换宿主时把入口码指错。
    // 需要固定指向某个域名时，在「访问地址」面板里填一次即可（存 localStorage）。
    publicUrl: '',
    // 永久地址：印展板用的二维码（scripts/make_entry_qr_png.py）认这一行，
    // 换正式域名时改这里，测试会解码成品图核对它没和代码脱节。
    canonicalUrl: 'https://longnankejia.pages.dev/'
  },

  ai: {
    // 'rules' = 只用本地知识库（离线演示，不联网）
    // 'api'   = 简单概述读取馆内资料；具体、比较和追问经检索后交给大模型整理。
    //           接口不可用时给资料节选；缺少证据时明确说明。
    // 线上由 Pages Function 使用服务端密钥；本地可用 js/secrets.js 覆盖为直连模式。
    mode: 'api',

    api: {
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      proxyUrl: (window.location && window.location.hostname === 'lwy9107124035.github.io')
        ? 'https://longnankejia.pages.dev/api/ai/chat/completions'
        : '/api/ai/chat/completions',
      // 本地直连密钥（若有）；线上通过 proxyUrl 转发，密钥不会下发到浏览器。
      apiKey: (window.APP_SECRETS && window.APP_SECRETS.apiKey) || '',
      model: 'deepseek-ai/DeepSeek-V3.2',
      temperature: 0.2,
      maxTokens: 900,
      systemPrompt:
        '你是"阿蓝"，龙南客家非遗数字助手，为游客介绍江西龙南的客家非物质文化遗产。' +
        '你熟悉蓝染、竹编、客家织带、客家围屋、客家山歌与童谣、客家方言等知识。' +
        '回答要求：使用简体中文，像馆里的讲解员那样说话，不用书面腔；' +
        '内容准确，不确定时坦诚说明，不编造史实；' +
        '长度随问题需要，不用 emoji，结尾不写总结套话。'
    },

    // 语音输入（问答框的麦克风）：录音走 MediaRecorder，转写用国内可直连的 ASR 接口，
    // 与问答共用服务端密钥。刻意不用 Chrome 自带的 webkitSpeechRecognition——
    // 那个要把音频发到谷歌服务器，馆内网络连不通，点了只会转到超时。
    asr: {
      url: 'https://api.siliconflow.cn/v1/audio/transcriptions',
      proxyUrl: (window.location && window.location.hostname === 'lwy9107124035.github.io')
        ? 'https://longnankejia.pages.dev/api/ai/audio/transcriptions'
        : '/api/ai/audio/transcriptions',
      // 实测同一句普通话（3.5 秒，离线合成）：SenseVoiceSmall 要 40.7～97.4 秒，
      // 还把"蓝染/制靛"听成"兰染/质垫"；Qwen3-ASR-1.7B 0.7～12 秒且逐字正确。
      model: 'Qwen/Qwen3-ASR-1.7B',
      language: 'zh',
      maxMs: 20000,
      // 换模型后仍留 30 秒余量：这个服务的延迟会抖（同一次请求 0.7 秒到 12 秒都出现过）
      timeoutMs: 30000
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
  },

  // 管理员界面
  admin: {
    // 默认密码（管理员可在界面中修改，修改后存 localStorage 覆盖此值）
    password: 'admin123'
  }
};
