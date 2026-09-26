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
    // 'api'   = 混合链路：本地知识库优先，未命中才转大模型；大模型不可用时回到
    //           馆内最接近的资料。三条路径都必须给出内容，不允许回"回答不了"。
    // 切换为 'api' 前，请先在 js/secrets.js 中填入 apiKey
    mode: 'api',

    api: {
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      // 密钥从 secrets.js 读取，此处无需填写
      apiKey: (window.APP_SECRETS && window.APP_SECRETS.apiKey) || '',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      temperature: 0.7,
      maxTokens: 256,
      systemPrompt:
        '你是"阿蓝"，龙南客家非遗数字助手，为游客介绍江西龙南的客家非物质文化遗产。' +
        '你熟悉蓝染、竹编、客家织带、客家围屋、客家山歌与童谣、客家方言等知识。' +
        '回答要求：使用简体中文，像馆里的讲解员那样说话，不用书面腔；' +
        '内容准确，不确定时坦诚说明，不编造史实；' +
        '每次回答控制在 120 字以内，不用 emoji，结尾不写总结套话。'
    },

    // 语音输入（问答框的麦克风）：录音走 MediaRecorder，转写用国内可直连的 ASR 接口，
    // 与问答共用同一个 apiKey。刻意不用 Chrome 自带的 webkitSpeechRecognition——
    // 那个要把音频发到谷歌服务器，馆内网络连不通，点了只会转到超时。
    asr: {
      url: 'https://api.siliconflow.cn/v1/audio/transcriptions',
      model: 'FunAudioLLM/SenseVoiceSmall',
      language: 'zh',
      maxMs: 20000,
      // 实测：1.5 秒的音频，这个接口往返要 24.5 / 49.6 / 58.0 秒（三次采样）。
      // 原来写死 15 秒，等于每次都在服务还没回话时自己把请求掐了。
      timeoutMs: 90000
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
