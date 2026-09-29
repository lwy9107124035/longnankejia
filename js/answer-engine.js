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

  // 中文没有空格，英文拒答话照样会整句出现，所以两边都按大小写不敏感找
  var REFUSAL_WORDS = ['回答不了', '我还不知道', '还在学习中', '不敢乱答', '暂时无法',
    '无法回答', '帮不上忙', '抱歉', 'as an ai', '作为人工智能'];
  function isRefusal(text) {
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < REFUSAL_WORDS.length; i++) {
      if (t.indexOf(REFUSAL_WORDS[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  /* ---------- 对比与分析类提问判定 ---------- */
  var COMPARATIVE_WORDS = [
    '对比', '比较', '区别', '不同', '差异', '相似', '相同', '异同',
    '比起', '相较', '有何区别', '有何不同', '有什么不一样', '哪点不同',
    '其他地方', '别的省', '各地', '全国'
  ];
  var DIFF_WORDS = ['区别', '不同', '差异', '有何区别', '有何不同', '有什么不一样', '哪点不同', '差别'];
  var SAME_WORDS = ['相似', '相同', '相通', '一致', '共同点', '共性', '相似之处', '相同之处', '一样的地方'];

  function isComparativeQuery(question) {
    var q = cleanQuestion(question);
    for (var i = 0; i < COMPARATIVE_WORDS.length; i++) {
      if (q.indexOf(COMPARATIVE_WORDS[i]) !== -1) return true;
    }
    return false;
  }

  function isDiffQuery(question) {
    var q = cleanQuestion(question);
    for (var i = 0; i < DIFF_WORDS.length; i++) {
      if (q.indexOf(DIFF_WORDS[i]) !== -1) return true;
    }
    return false;
  }

  function isSameQuery(question) {
    var q = cleanQuestion(question);
    for (var i = 0; i < SAME_WORDS.length; i++) {
      if (q.indexOf(SAME_WORDS[i]) !== -1) return true;
    }
    return false;
  }

  /* ---------- 规则引擎 ---------- */
  function RulesEngine() {
    this.name = 'rules';
    this.label = '本地知识库';
    // 从 Store 读取合并后的知识库（默认 + 管理员修改）
    this.entries = (window.Store ? window.Store.getEntries() : (window.KNOWLEDGE_BASE || [])).slice();
  }

  RulesEngine.prototype.scoreEntry = function (entry, tokens, hay) {
    var score = 0;
    var matched = [];
    var ngram = 0;

    entry.keywords.forEach(function (kw) {
      var kwLow = kw.toLowerCase();
      var variants = [kwLow].concat(expandKeywords(kw).map(function (s) {
        return s.toLowerCase();
      }));

      variants.forEach(function (v) {
        // 完整关键词出现在问题里 → 高权重。比的是清洗后的原句：tokens 是 2-gram
        // 和 3-gram 的集合，join 起来是「你们们在在做什什么…」，长关键词永远匹配不上。
        if (v.length >= 2 && hay.indexOf(v) !== -1) {
          score += v.length >= 4 ? 2.5 : 2.0;
          if (matched.indexOf(kw) === -1) matched.push(kw);
        } else if (v.length === 4) {
          // 4字复合词（如"蓝染区别"、"织带工艺"、"竹编工序"）：若前半与后半分别出现在问题中，同样计入高权重匹配
          var head = v.slice(0, 2), tail = v.slice(2);
          if (hay.indexOf(head) !== -1 && hay.indexOf(tail) !== -1) {
            score += 3.2;
            if (matched.indexOf(kw) === -1) matched.push(kw);
          }
        }
        // 2-gram 命中 → 累加
        tokens.forEach(function (t) {
          if (t.length >= 2 && v.indexOf(t) !== -1) {
            ngram += 0.45;
          }
        });
      });
    });

    // 定向意图加权：针对"区别/不同"与"相似/相同"进行精准定向分流，彻底解决同类对比混淆
    var hasDiffIntent = isDiffQuery(hay);
    var hasSameIntent = isSameQuery(hay);
    var entryTitle = entry.title || '';
    var isDiffEntry = entry.id.indexOf('diff') !== -1 || entryTitle.indexOf('区别') !== -1 || entryTitle.indexOf('不同') !== -1;
    var isSameEntry = entry.id.indexOf('same') !== -1 || entryTitle.indexOf('相似') !== -1 || entryTitle.indexOf('相同') !== -1 || entryTitle.indexOf('相通') !== -1;

    if (hasDiffIntent && !hasSameIntent) {
      if (isDiffEntry) {
        score += 8.0;
        if (matched.indexOf('区别') === -1) matched.push('区别');
      } else if (isSameEntry || entry.id === 'landye') {
        score -= 8.0;
      }
    } else if (hasSameIntent && !hasDiffIntent) {
      if (isSameEntry) {
        score += 8.0;
        if (matched.indexOf('相似') === -1) matched.push('相似');
      } else if (isDiffEntry || entry.id === 'landye') {
        score -= 8.0;
      }
    }

    // 工艺制作意图消歧：提问工艺制作时，专项工艺条目优先于泛化概括条目
    var hasCraftIntent = hay.indexOf('工艺') !== -1 || hay.indexOf('制作') !== -1 || hay.indexOf('怎么做') !== -1 || hay.indexOf('怎么织') !== -1 || hay.indexOf('怎么编') !== -1 || hay.indexOf('工序') !== -1;
    var isCraftEntry = entry.id.indexOf('craft') !== -1 || entryTitle.indexOf('工艺') !== -1 || entryTitle.indexOf('制作') !== -1;
    if (hasCraftIntent) {
      if (isCraftEntry) {
        score += 6.0;
        if (matched.indexOf('工艺') === -1) matched.push('工艺');
      } else if (entry.id === 'zhidai' || entry.id === 'zhubian') {
        score -= 6.0;
      }
    }

    // 传承人意图消歧：提问特定传承人时，传承人专项条目优先
    var hasInheritorIntent = hay.indexOf('传承人') !== -1 || hay.indexOf('老艺人') !== -1 || hay.indexOf('徐昌添') !== -1 || hay.indexOf('廖秋华') !== -1 || hay.indexOf('黄竹英') !== -1;
    var isInheritorEntry = entry.id.indexOf('inheritor') !== -1 || entryTitle.indexOf('传承人') !== -1;
    if (hasInheritorIntent) {
      if (isInheritorEntry) {
        score += 8.0;
        if (matched.indexOf('传承人') === -1) matched.push('传承人');
      } else if (entry.id === 'zhidai' || entry.id === 'zhubian') {
        score -= 6.0;
      }
    }

    // 2-gram 的部分重合封顶再计入。不封顶的话，问题越长分越高：
    // 实测「潮汕工夫茶的冲泡步骤是什么」靠 23 个 2-gram 蹭到 1.35，越过了阈值，
    // 把自我介绍当成答案端给一个馆外话题。
    return { score: score + Math.min(ngram, 1.2), matched: matched };
  };

  /** 给问题打分并排序；命中与"最接近"两种结果都从这里出，避免两套判据打架。 */
  RulesEngine.prototype.rank = function (question) {
    var self = this;
    var tokens = tokenize(question);
    var hay = cleanQuestion(question);
    if (!tokens.length) return { tokens: tokens, scored: [], hit: null, minScore: 1.0 };
    var minScore = (window.APP_CONFIG && window.APP_CONFIG.ai.minScore) || 1.0;
    var scored = this.entries.map(function (entry) {
      var r = self.scoreEntry(entry, tokens, hay);
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
    if (!canCallApi(this.cfg)) {
      console.warn('[answer-engine] 未配置 API 代理或本地 apiKey，将回退到本地知识库。');
    }
  }

  function canCallApi(api) {
    return !!(api && (api.apiKey || api.proxyUrl));
  }

  /** 把馆内最接近的资料节选塞进系统提示，让大模型贴着馆藏说，而不是自由发挥。 */
  function kbContext(ranked, question) {
    var top = (ranked.scored || []).slice(0, 3);
    if (!top.length) return '';
    var prompt = '\n\n【馆内资料节选，优先据此回答；资料没覆盖的可依据客家非遗通识作答，'
      + '但不要编造具体年代与人名】\n' + top.map(function (s) {
        return '· ' + s.entry.title + '：' + headLine(s.entry.answer, 90);
      }).join('\n');
    if (question && isComparativeQuery(question)) {
      if (isDiffQuery(question) && !isSameQuery(question)) {
        prompt += '\n【用户提问重点询问区别与不同特色，请针对客家非遗的独有特质（如产业与围屋相伴、山地劳作实用防护、跨项融合成靛蓝织带等）进行条理分明的对比分析，切勿泛泛重复相似点】';
      } else if (isSameQuery(question) && !isDiffQuery(question)) {
        prompt += '\n【用户提问重点询问相似与相通之处，请针对植物原料同源、自然发酵氧化原理、手工防染智慧与农耕造物观展开条理分明的对比分析，切勿偏题到不同之处】';
      } else {
        prompt += '\n【用户提问包含跨地域对比，请结合客家非遗与其他地区的工艺、原料或文化背景，明确分析相似之处与不同特色，条理分明地作答，切勿只重复单一地方资料】';
      }
    }
    return prompt;
  }

  ApiEngine.prototype.callApi = function (question, ranked) {
    var api = this.cfg;
    var messages = [
      { role: 'system', content: (api.systemPrompt || '你是非遗数字助手。') + kbContext(ranked, question) },
      { role: 'user', content: String(question || '') }
    ];

    // 带超时的 fetch（15 秒无响应则回退）
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);

    var endpoint = api.apiKey ? api.baseUrl : api.proxyUrl;
    var headers = { 'Content-Type': 'application/json' };
    if (api.apiKey) headers.Authorization = 'Bearer ' + api.apiKey;

    return fetch(endpoint, {
      method: 'POST',
      headers: headers,
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
      // 大模型偶尔会客套地拒答。这句话到了观众眼里就是本站答不上来，所以按
      // "没有可用答复"处理，让调用方回到馆内最接近的资料，而不是原样转述。
      if (isRefusal(text)) throw new Error('大模型回的是拒答话，改用馆内资料');
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
   * 本地优先：基础事实性知识库命中就直接答（离线可用、确定性、省一次接口调用）；
   * 提问涉及跨地域对比、异同分析或未命中时转大模型深度解答；
   * 接口没有 key、报错或超时，就回到馆内最接近的资料。
   * 三条路径都必须给出内容——任何情况下都不回"回答不了"。
   */
  ApiEngine.prototype.ask = function (question) {
    var self = this;
    var ranked = this._fallback.rank(question);
    var isComp = isComparativeQuery(question);

    // 只有在非对比类、非开放引申提问，且命中明确知识条目时，才直接走本地快速通道；
    // 一旦问题涉及跨地域对比或异同点分析，优先调度大模型生成针对性对比；大模型不可用时才回落到对应知识库。
    if (ranked.hit && !isComp) {
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

    if (!canCallApi(this.cfg)) {
      if (ranked.hit) {
        return mockDelay().then(function () {
          return {
            text: ranked.hit.entry.answer,
            source: 'rules',
            matched: ranked.hit.entry.title,
            score: ranked.hit.score
          };
        });
      }
      return mockDelay().then(function () { return self._fallback.nearest(ranked, question); });
    }

    return this.callApi(question, ranked).catch(function (err) {
      console.error('[answer-engine] 大模型不可用，回到馆内资料：', err);
      if (ranked.hit) {
        return {
          text: ranked.hit.entry.answer,
          source: 'rules',
          matched: ranked.hit.entry.title,
          score: ranked.hit.score
        };
      }
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
    isRefusal: isRefusal,
    reset: function () { current = null; }
  };
})();
