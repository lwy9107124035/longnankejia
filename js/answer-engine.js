/**
 * 回答引擎（可插拔）
 * ------------------------------------------------------------
 *  - RulesEngine：本地知识库关键词匹配（默认，离线可用）
 *  - ApiEngine  ：调用 OpenAI 兼容大模型 API
 *  - getEngine()：根据 APP_CONFIG.ai.mode 返回对应引擎
 *
 * 新增引擎：实现 ask(question) => Promise<{ text, source, matched? }>
 * 然后在 getEngine() 中注册即可。
 */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function mockDelay() {
    var d = (window.APP_CONFIG && window.APP_CONFIG.ai.mockDelay) || [400, 800];
    return new Promise(function (resolve) {
      setTimeout(resolve, rand(d[0], d[1]));
    });
  }

  /* ---------- 同义词扩展 ---------- */
  function expandKeywords(word) {
    var map = window.KEYWORD_SYNONYMS || {};
    var extras = [];
    Object.keys(map).forEach(function (main) {
      if (main === word || map[main].indexOf(word) !== -1) {
        if (extras.indexOf(main) === -1) extras.push(main);
        map[main].forEach(function (s) {
          if (extras.indexOf(s) === -1) extras.push(s);
        });
      }
    });
    return extras;
  }

  /* ---------- 文本清洗与分词 ---------- */
  function cleanQuestion(q) {
    return String(q || '')
      .trim()
      .replace(/[？?！!。．.，,；;：:""''「」【】（）()《》\s]+/g, ' ')
      .toLowerCase();
  }

  // 中文无空格：生成 2-gram 滑动窗口 + 原始词
  function tokenize(question) {
    var text = cleanQuestion(question);
    var tokens = [];
    if (!text) return tokens;

    // 按空格切出的片段
    var parts = text.split(' ').filter(Boolean);
    parts.forEach(function (p) {
      if (p.length <= 3) {
        tokens.push(p);
      } else {
        for (var i = 0; i < p.length - 1; i++) {
          tokens.push(p.slice(i, i + 2));
        }
        // 3-gram 也保留
        for (var j = 0; j < p.length - 2; j++) {
          tokens.push(p.slice(j, j + 3));
        }
      }
    });
    return tokens;
  }

  /* ---------- 规则引擎 ---------- */
  function RulesEngine() {
    this.name = 'rules';
    this.label = '本地知识库';
    this.entries = (window.KNOWLEDGE_BASE || []).slice();
  }

  RulesEngine.prototype.scoreEntry = function (entry, tokens) {
    var score = 0;
    var matched = [];

    entry.keywords.forEach(function (kw) {
      var kwLow = kw.toLowerCase();
      var variants = [kwLow].concat(expandKeywords(kw).map(function (s) {
        return s.toLowerCase();
      }));

      variants.forEach(function (v) {
        // 完整关键词出现在原文 → 高权重
        var text = tokens.join('');
        if (v.length >= 2 && text.indexOf(v) !== -1) {
          score += v.length >= 4 ? 2.5 : 2.0;
          if (matched.indexOf(kw) === -1) matched.push(kw);
        }
        // 2-gram 命中 → 累加
        tokens.forEach(function (t) {
          if (t.length >= 2 && v.indexOf(t) !== -1) {
            score += 0.45;
          }
        });
      });
    });

    return { score: score, matched: matched };
  };

  RulesEngine.prototype.ask = function (question) {
    var self = this;
    return mockDelay().then(function () {
      var tokens = tokenize(question);
      if (!tokens.length) {
        return {
          text: '嗯嗯？阿蓝好像没听清，换个说法再问问看吧~',
          source: 'rules'
        };
      }

      var best = null;
      var bestScore = 0;

      self.entries.forEach(function (entry) {
        var r = self.scoreEntry(entry, tokens);
        if (r.score > bestScore) {
          bestScore = r.score;
          best = { entry: entry, matched: r.matched };
        }
      });

      var minScore = (window.APP_CONFIG && window.APP_CONFIG.ai.minScore) || 1.0;

      if (best && bestScore >= minScore) {
        return {
          text: best.entry.answer,
          source: 'rules',
          matched: best.entry.title,
          score: bestScore
        };
      }

      // 兜底：不编造，引导到热门问题
      return {
        text:
          '这个问题阿蓝还在学习中，暂时不敢乱答~\n' +
          '目前我比较擅长：蓝染、竹编、客家织带、围屋、山歌童谣、客家方言等话题。\n' +
          '你可以点上方的快捷问题，或换种方式问我试试！',
        source: 'rules',
        fallback: true
      };
    });
  };

  /* ---------- API 引擎 ---------- */
  function ApiEngine() {
    this.name = 'api';
    this.label = 'AI 大模型';
    var api = (window.APP_CONFIG && window.APP_CONFIG.ai.api) || {};
    this.cfg = api;
    if (!api.apiKey) {
      console.warn('[answer-engine] 已选择 API 模式，但未配置 apiKey，将回退到本地知识库。');
      this._fallback = new RulesEngine();
    }
  }

  ApiEngine.prototype.ask = function (question) {
    var self = this;
    if (this._fallback) {
      return this._fallback.ask(question);
    }

    var api = this.cfg;
    var messages = [
      { role: 'system', content: api.systemPrompt || '你是非遗数字助手。' },
      { role: 'user', content: String(question || '') }
    ];

    // 带超时的 fetch（15 秒无响应则回退本地知识库）
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);

    return fetch(api.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + api.apiKey
      },
      body: JSON.stringify({
        model: api.model,
        messages: messages,
        temperature: api.temperature != null ? api.temperature : 0.7,
        max_tokens: api.maxTokens || 512
      }),
      signal: controller.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error('API HTTP ' + res.status);
      }
      return res.json();
    }).then(function (data) {
      var msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
      // 优先取 content；若为空则尝试 reasoning_content
      var text = String(msg.content || '').trim();
      if (!text && msg.reasoning_content) {
        text = String(msg.reasoning_content).trim();
      }
      if (!text) throw new Error('API 返回内容为空');
      // 清理 markdown 强调符号（**bold** → bold）
      text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
      // 限制长度，防止打字机过长
      if (text.length > 300) text = text.slice(0, 300) + '……';
      return { text: text, source: 'api' };
    }).catch(function (err) {
      clearTimeout(timer);
      console.error('[answer-engine] API 调用失败，回退本地知识库：', err);
      return self._fallback
        ? self._fallback.ask(question)
        : { text: '网络似乎不太稳定，阿蓝先用本地知识库回答：可以问我蓝染、竹编、织带、围屋相关的问题~', source: 'fallback' };
    });
  };

  /* ---------- 工厂 ---------- */
  var current = null;

  function getEngine() {
    if (current) return current;
    var mode = (window.APP_CONFIG && window.APP_CONFIG.ai.mode) || 'rules';
    current = mode === 'api' ? new ApiEngine() : new RulesEngine();
    return current;
  }

  // 暴露给其他模块 / 控制台调试
  window.AnswerEngine = {
    getEngine: getEngine,
    RulesEngine: RulesEngine,
    ApiEngine: ApiEngine,
    reset: function () { current = null; }
  };
})();
