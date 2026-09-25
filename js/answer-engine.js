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
    // 从 Store 读取合并后的知识库（默认 + 管理员修改）
    this.entries = (window.Store ? window.Store.getEntries() : (window.KNOWLEDGE_BASE || [])).slice();
  }

  RulesEngine.prototype.scoreEntry = function (entry, tokens) {
    var score = 0;
    var matched = [];
    var ngram = 0;

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
            ngram += 0.45;
          }
        });
      });
    });

    // 2-gram 的部分重合封顶再计入。不封顶的话，问题越长分越高：
    // 实测「潮汕工夫茶的冲泡步骤是什么」靠 23 个 2-gram 蹭到 1.35，越过了阈值，
    // 把自我介绍当成答案端给一个馆外话题。
    return { score: score + Math.min(ngram, 1.2), matched: matched };
  };

  /** 给问题打分并排序；命中与"最接近"两种结果都从这里出，避免两套判据打架。 */
  RulesEngine.prototype.rank = function (question) {
    var self = this;
    var tokens = tokenize(question);
    if (!tokens.length) return { tokens: tokens, scored: [], hit: null, minScore: 1.0 };
    var minScore = (window.APP_CONFIG && window.APP_CONFIG.ai.minScore) || 1.0;
    var scored = this.entries.map(function (entry) {
      var r = self.scoreEntry(entry, tokens);
      return { entry: entry, score: r.score, matched: r.matched };
    }).filter(function (s) { return s.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    // 命中必须"问题里真的出现了某个关键词"。只靠 2-gram 部分重合的不算命中——
    // 那是馆外话题蹭进了本地库，答非所问还挡住大模型。
    var top = scored[0] || null;
    var hit = (top && top.score >= minScore && top.matched.length > 0) ? top : null;
    return { tokens: tokens, scored: scored, minScore: minScore, hit: hit };
  };

  function headLine(answer, max) {
    var first = String(answer).split('\n')[0].trim();
    return first.length > (max || 46) ? first.slice(0, max || 46) + '…' : first;
  }

  /** 未命中时的答案：给馆内最接近的资料，绝不回"答不了/还在学习中"。 */
  RulesEngine.prototype.nearest = function (ranked, question) {
    // 只列关键词真的在问题里出现过的条目。没有一条对得上却硬凑前三，
    // 就会把「潮汕工夫茶」答成自我介绍——那是答非所问，不是兜底。
    var top = (ranked.scored || []).filter(function (s) { return s.matched.length > 0; }).slice(0, 3);
    if (!top.length) {
      return {
        text: '「' + String(question).slice(0, 24) + '」这个词阿蓝的馆内资料里还没收录，'
          + '龙南这几样手艺本来就缠在一起：蓝染的布要用竹编的染架，围屋的堂屋里唱着山歌。'
          + '换个说法，或者点上面任意一个话题，阿蓝都能讲一段。',
        source: 'rules',
        fallback: true,
        topics: true
      };
    }
    var lines = top.map(function (s) {
      return '· ' + s.entry.title + '：' + headLine(s.entry.answer);
    });
    return {
      text: '馆内资料里没有和「' + String(question).slice(0, 20) + '」完全对上的一条，'
        + '阿蓝先把最接近的几块讲给你：\n' + lines.join('\n')
        + '\n想听哪一块，说个名字，阿蓝展开讲。',
      source: 'rules',
      fallback: true,
      nearest: top.map(function (s) { return s.entry.title; })
    };
  };

  RulesEngine.prototype.ask = function (question) {
    var self = this;
    return mockDelay().then(function () {
      var ranked = self.rank(question);
      if (!ranked.scored.length) {
        return {
          text: '嗯嗯？阿蓝没听清，换个说法再问一次。',
          source: 'rules'
        };
      }
      var best = ranked.hit;
      if (best) {
        return {
          text: best.entry.answer,
          source: 'rules',
          matched: best.entry.title,
          score: best.score
        };
      }
      return self.nearest(ranked, question);
    });
  };

  /* ---------- API 引擎 ---------- */
  function ApiEngine() {
    this.name = 'api';
    this.label = 'AI 大模型';
    // 从 Store 读取合并后的 AI 配置（默认 + 管理员覆盖）
    this.cfg = window.Store ? window.Store.getEffectiveAi().api : ((window.APP_CONFIG && window.APP_CONFIG.ai.api) || {});
    // 本地知识库始终作为兜底：以前只在缺 apiKey 时才建，结果密钥在但接口挂了
    // 时 _fallback 是 undefined，catch 里拿不到它，只能回一句罐头话，
    // 明明库里有的答案就这么丢了。
    this._fallback = new RulesEngine();
    if (!this.cfg.apiKey) {
      console.warn('[answer-engine] 已选择 API 模式，但未配置 apiKey，将回退到本地知识库。');
    }
  }

  /** 把馆内最接近的资料节选塞进系统提示，让大模型贴着馆藏说，而不是自由发挥。 */
  function kbContext(ranked) {
    var top = (ranked.scored || []).slice(0, 3);
    if (!top.length) return '';
    return '\n\n【馆内资料节选，优先据此回答；资料没覆盖的可依据客家非遗通识作答，'
      + '但不要编造具体年代与人名】\n' + top.map(function (s) {
        return '· ' + s.entry.title + '：' + headLine(s.entry.answer, 90);
      }).join('\n');
  }

  ApiEngine.prototype.callApi = function (question, ranked) {
    var api = this.cfg;
    var messages = [
      { role: 'system', content: (api.systemPrompt || '你是非遗数字助手。') + kbContext(ranked) },
      { role: 'user', content: String(question || '') }
    ];

    // 带超时的 fetch（15 秒无响应则回退）
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
      clearTimeout(timer);   // 失败路径也要收表，否则 15 秒后会对已结束的请求补一枪
      throw err;
    });
  };

  /**
   * 本地优先：知识库命中就直接答（离线可用、确定性、省一次接口调用）；
   * 未命中才转大模型；接口没有 key、报错或超时，就回到馆内最接近的资料。
   * 三条路径都必须给出内容——任何情况下都不回"回答不了"。
   */
  ApiEngine.prototype.ask = function (question) {
    var self = this;
    var ranked = this._fallback.rank(question);

    if (ranked.hit) {
      var top = ranked.hit;
      return mockDelay().then(function () {
        return {
          text: top.entry.answer,
          source: 'rules',
          matched: top.entry.title,
          score: top.score
        };
      });
    }

    if (!this.cfg.apiKey) {
      return mockDelay().then(function () { return self._fallback.nearest(ranked, question); });
    }

    return this.callApi(question, ranked).catch(function (err) {
      console.error('[answer-engine] 大模型不可用，回到馆内资料：', err);
      return self._fallback.nearest(ranked, question);
    });
  };

  /* ---------- 工厂 ---------- */
  var current = null;

  function getEngine() {
    if (current) return current;
    var mode = 'rules';
    if (window.Store) {
      mode = window.Store.getEffectiveAi().mode || 'rules';
    } else if (window.APP_CONFIG) {
      mode = window.APP_CONFIG.ai.mode || 'rules';
    }
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
