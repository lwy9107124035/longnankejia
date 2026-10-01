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

  /* ---------- 规则引擎 ---------- */
  function RulesEngine() {
    this.name = 'rules';
    this.label = '本地知识库';
    // 从 Store 读取合并后的知识库（默认 + 管理员修改）
    this.entries = (window.Store ? window.Store.getEntries() : (window.KNOWLEDGE_BASE || [])).slice();
    this.lastTopicId = '';
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

  /* ---------- v2：问句意图路由与定向检索 ---------- */
  function norm(q) {
    return String(q || '').toLowerCase().replace(/[\s？?！!。，,；;：:、"“”‘’（）()《》]/g, '');
  }

  function pickEntry(entries, id) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  function topicId(question) {
    var q = norm(question);
    if (/蓝染|蓝靛|靛蓝|蓝印花/.test(q)) return 'landye';
    if (/织带|花带|冬头帕/.test(q)) return 'v2-zhidai';
    if (/竹编|竹篾|篾匠|竹艺|竹制/.test(q)) return 'v2-zhubian';
    if (/围屋|土楼|关西新围|燕翼围/.test(q)) return 'weiwu';
    return '';
  }

  function withRecentTopic(question, recentTopic, entries) {
    if (topicId(question) || !recentTopic) return String(question || '');
    var q = norm(question);
    if (!/^(那|它|这个|这项|其|还有|另外|然后|再说)/.test(q)
      && !/(呢|怎么样|怎么做|如何做|什么寓意|有什么寓意|哪些步骤|什么步骤)$/.test(q)) return String(question || '');
    var entry = pickEntry(entries, recentTopic);
    return entry ? entry.title + ' ' + String(question || '') : String(question || '');
  }

  function collectSources(entries) {
    var refs = [];
    (entries || []).forEach(function (entry) {
      (entry.sources || []).forEach(function (source) {
        if (!source.title && !source.url) return;
        if (refs.some(function (ref) { return ref.title === source.title && ref.url === source.url; })) return;
        refs.push({ title: source.title || source.url, url: source.url || '' });
      });
    });
    return refs;
  }

  function intentResult(text, title, refs, options) {
    return {
      text: text,
      source: 'rules',
      matched: title,
      intent: true,
      references: (refs || []).map(function (entry) { return entry.title; }),
      sources: collectSources(refs),
      needsApi: !!(options && options.needsApi)
    };
  }

  function questionIntent(question, entries) {
    var q = norm(question);
    var compare = /比较|对比|相比|相较|区别|差异|不同|不一样|相似|相同|共同|类似|相近|异同/.test(q);
    var same = /相似|相同|共同|类似|相近|共通/.test(q);
    var both = /异同|既.*又|相似.*区别|区别.*相似|相同.*不同|不同.*相同|共同点.*不同点|相同点.*不同点/.test(q);
    var process = /工艺|步骤|工序|怎么做|如何制作|制作方法|流程|原料|材料|做法/.test(q);
    var inheritor = /传承人|谁在传|谁传承|谁来传|传给谁|代表性传承|传承者|老师是谁|师傅是谁|谁在做/.test(q);
    var hasBlue = /蓝染|蓝印花|靛蓝|蓝靛|植物染蓝|扎染/.test(q);
    var hasWeave = /织带|手织带|花带|彩带|冬头帕/.test(q);
    var hasBamboo = /竹编|竹篾|篾匠|竹艺|竹制/.test(q);
    var nantong = /南通|蓝印花布/.test(q);
    var dali = /白族|大理|周城/.test(q);
    var references = [];
    var text = '';

    // A multi-topic craft question must be answered as a comparison before any
    // single keyword can win the ordinary ranker.
    if (compare && hasWeave && hasBamboo) {
      var strap = pickEntry(entries, 'v2-zhidai');
      var bamboo = pickEntry(entries, 'v2-zhubian');
      if (strap && bamboo) {
        references = [strap, bamboo];
        if (same && !both) {
          text = '相似处：两者都靠手工安排经纬、挑压编织，也都把日常生活和祝愿带进器物与纹样。区别在材料和用途：织带以丝线织成窄幅带子，常与冬头帕、婚俗相连；竹编先把竹材劈成篾条，再编成篮、筛等生活器具。这里说的是龙南资料中的做法。';
        } else if (both) {
          text = '相似处：两者都靠手工安排经纬、挑压编织，也都把生活需求和纹样寓意带进作品。区别在材料和用途：织带以丝线织成窄幅带子，常与冬头帕、婚俗相连；竹编先把竹材劈成篾条，再编成篮、筛等器具。这里比较的是龙南资料中的做法。';
        } else {
          text = '两种技艺的材料和步骤不同。客家织带把丝线架在绠瓠子上，用带尺挑线、穿梭编出带状纹样；竹编先选竹、破篾和打磨，再用篾条挑压编成篮、筛等器物。织带常用于冬头帕并承载婚俗祝愿，竹编则多做日用器具。以上是龙南资料中的做法。';
        }
        return intentResult(text, '织带与竹编工艺比较', references);
      }
    }

    if (compare && hasBlue) {
      var hakka = pickEntry(entries, 'landye');
      var nt = nantong ? pickEntry(entries, 'v2-nantong-blue-print') : null;
      var dl = dali ? pickEntry(entries, 'v2-dali-bai-tie-dye') : null;
      var generalOther = /其他地方|别的地方|其他地区|外地|各地|不同地区|相近的地方|相似的地方|地方(?:染艺|做法|蓝染|蓝靛|染布)|别处|他处/.test(q);
      var explicitlyUnknown = /日本|日本蓝染|江户|琉球|福建|土楼|围屋/.test(q);
      if (!nantong && !dali && generalOther && !explicitlyUnknown) {
        nt = pickEntry(entries, 'v2-nantong-blue-print');
        dl = pickEntry(entries, 'v2-dali-bai-tie-dye');
      }
      references = [hakka, nt, dl].filter(Boolean);
      if (hakka && references.length > 1 && !explicitlyUnknown) {
        var places = [];
        if (nt) places.push('南通蓝印花布');
        if (dl) places.push('大理白族扎染');
        var scope = places.join('、');
        var common = '客家蓝染与' + scope + '都以植物蓝靛染色，并通过局部防染呈现蓝白或深浅纹样。';
        var differenceParts = [];
        if (nt) differenceParts.push('南通蓝印花布以刻花版和防染浆印花');
        if (dl) differenceParts.push('大理白族扎染先扎缝布面再浸染、拆线');
        var differences = '工艺各有路径：龙南客家蓝染资料记载制靛泥、蜡染模板及与织带融合；' + differenceParts.join('；') + '。';
        if (same && !both) {
          text = '相似处：' + common + '这里仅按' + scope + '的有来源资料比较，不代表其他地区都一样。';
        } else if (both) {
          text = '相似处：' + common + '\n区别：' + differences + '这里只比较' + scope + '，不把这些样本推广为所有地方的做法。';
        } else {
          text = '以' + scope + '为参照，龙南客家蓝染资料记载以蓝草制靛，李洁春用“三浸三晒三发酵”制靛泥，并有蜡染模板及与织带融合的做法；' + differences + '客家资料没有完整说明各类布料的全部防染细节；“其他地方”也不是单一工艺，以上只比较有来源的具体样本。';
        }
        return intentResult(text, same ? '客家蓝染与其他地方蓝染的相似之处' : '客家蓝染与其他地方蓝染的工艺比较', references);
      }
      if (hakka && explicitlyUnknown) {
        text = '现有龙南资料能说明客家蓝染以蓝草制靛，李洁春采用“三浸三晒三发酵”制靛泥，并有蜡染模板和靛蓝织带实践；但馆内资料没有覆盖你提到的地区，暂时不能据此判断双方异同。若你愿意，我可以按该地非遗或官方资料再核对。';
        return intentResult(text, '蓝染跨地区比较（本地资料有限）', [hakka], { needsApi: true });
      }
    }

    if (compare && (/围屋|土楼/.test(q) || hasWeave || hasBamboo)) {
      var knownSide = /竹编|竹篾|篾匠/.test(q) ? pickEntry(entries, 'v2-zhubian')
        : (/织带|花带|冬头帕/.test(q) ? pickEntry(entries, 'v2-zhidai')
          : (hasBlue ? pickEntry(entries, 'landye') : pickEntry(entries, 'weiwu')));
      if (knownSide && /日本|福建|土楼|围屋|外地|其他地区|其他地方|相较|相比|比较|对比|区别|不同/.test(q)) {
        text = '龙南资料记载：' + headLine(knownSide.answer, 145) + '。馆内资料没有覆盖你提到的另一方，因此我先不推断差异；可以按该地官方或非遗资料再核对。';
        return intentResult(text, knownSide.title + '比较（本地资料有限）', [knownSide], { needsApi: true });
      }
    }

    if (inheritor) {
      var personEntry = hasBlue ? pickEntry(entries, 'landye') : (hasWeave ? pickEntry(entries, 'v2-zhidai') : (hasBamboo ? pickEntry(entries, 'v2-zhubian') : null));
      if (personEntry) {
        text = hasBlue
          ? '龙南蓝染资料记载，李洁春传习蓝染技艺，实践包括古法制靛、蜡染模板和靛蓝织带合作。若想了解其官方代表性传承人级别，需以公布的名录为准。'
          : (hasWeave
            ? '龙南织带资料记载，廖秋华、黄竹英长期传习客家织带。具体官方代表性传承人级别，请以公布的名录为准。'
            : '杨村竹编资料记载，徐昌添长期展示并传习竹编技艺。具体官方代表性传承人级别，请以公布的名录为准。');
        return intentResult(text, personEntry.title + '传承信息', [personEntry]);
      }
    }

    if (process) {
      var processEntry = hasBlue ? (nantong ? pickEntry(entries, 'v2-nantong-blue-print') : (dali ? pickEntry(entries, 'v2-dali-bai-tie-dye') : pickEntry(entries, 'landye')))
        : (hasWeave ? pickEntry(entries, 'v2-zhidai') : (hasBamboo ? pickEntry(entries, 'v2-zhubian') : null));
      if (processEntry) {
        if (hasBlue && !nantong && !dali) {
          text = '客家蓝染的资料步骤是：用蓝草制取靛蓝；李洁春以“三浸三晒三发酵”制靛泥；再以蜡染模板等方式制作纹样并进行染制。与织带结合的靛蓝织带资料称有24道染制工序。';
        } else if (hasBlue && nantong) {
          text = '南通二甲蓝印花布的地方资料记载：在白布上用刻花版刮防染浆，再用靛蓝染色，洗去防染浆后显出蓝白纹样。';
        } else if (hasBlue && dali) {
          text = '大理白族扎染先按纹样扎、撮、缝布，再反复浸染；拆开扎线后，未染部分留白成花。传统染料包括植物蓝靛或土靛。';
        } else if (hasWeave) {
          text = '客家冬头帕织带分三步：①架线，把多色丝线固定在绠瓠子上；②编织，用带尺挑线、穿梭织出纹样；③下架，取下织带并处理余线。';
        } else {
          text = '杨村竹编从选竹、截竹和刮节开始；竹筒破片后分层劈篾，再用“度篾齿”磨边、定宽。随后起底、挑压编织，最后收边、缠边并安装提手。';
        }
        return intentResult(text, processEntry.title + '工艺', [processEntry]);
      }
    }
    return null;
  }

  function contextEntries(ranked, question) {
    var q = norm(question);
    var requested = [];
    if (/南通|蓝印花布/.test(q)) requested.push('v2-nantong-blue-print');
    if (/白族|大理|周城/.test(q)) requested.push('v2-dali-bai-tie-dye');
    if (/蓝染|蓝印花|靛蓝|扎染/.test(q)) requested.push('landye');
    if (/织带|花带|冬头帕/.test(q)) requested.push('zhidai');
    if (/竹编|竹篾|篾匠/.test(q)) requested.push('v2-zhubian');
    var selected = [];
    requested.forEach(function (id) {
      (ranked.scored || []).forEach(function (score) {
        if (score.entry.id === id && selected.indexOf(score.entry) === -1) selected.push(score.entry);
      });
    });
    (ranked.scored || []).forEach(function (score) {
      if (selected.length < 4 && selected.indexOf(score.entry) === -1) selected.push(score.entry);
    });
    return selected.slice(0, 4);
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
    var resolvedQuestion = withRecentTopic(question, this.lastTopicId, this.entries);
    this.lastTopicId = topicId(resolvedQuestion) || this.lastTopicId;
    return mockDelay().then(function () {
      var intent = questionIntent(resolvedQuestion, self.entries);
      if (intent) return intent;
      var ranked = self.rank(resolvedQuestion);
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
    this.lastTopicId = '';
    if (!canCallApi(this.cfg)) {
      console.warn('[answer-engine] 未配置 API 代理或本地 apiKey，将回退到本地知识库。');
    }
  }

  function canCallApi(api) {
    return !!(api && (api.apiKey || api.proxyUrl));
  }

  /** 把馆内最接近的资料节选塞进系统提示，让大模型贴着馆藏说，而不是自由发挥。 */
  function kbContext(ranked, question) {
    var top = contextEntries(ranked, question);
    if (!top.length) return '';
    return '\n\n【检索到的馆内资料，优先逐项据此回答；涉及比较时只比较资料明确提到的地方样本，不泛化到所有地区；不得补造名录级别、年代、年龄或人名】\n' + top.map(function (entry) {
        var refs = (entry.sources || []).map(function (source) {
          return (source.title || source.label || '') + (source.url ? ' ' + source.url : '');
        }).filter(Boolean).join('；');
        return '· ' + entry.title + '：' + String(entry.answer || '').slice(0, 650)
          + (refs ? '\n  来源：' + refs : '');
      }).join('\n');
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
   * 本地优先：知识库命中就直接答（离线可用、确定性、省一次接口调用）；
   * 未命中才转大模型；接口没有 key、报错或超时，就回到馆内最接近的资料。
   * 三条路径都必须给出内容——任何情况下都不回"回答不了"。
   */
  ApiEngine.prototype.ask = function (question) {
    var self = this;
    var resolvedQuestion = withRecentTopic(question, this.lastTopicId, this._fallback.entries);
    this.lastTopicId = topicId(resolvedQuestion) || this.lastTopicId;
    var ranked = this._fallback.rank(resolvedQuestion);
    var intent = questionIntent(resolvedQuestion, this._fallback.entries);

    // 复杂或多主题意图先从有出处的条目组成针对性回答；无论 API 配置如何，
    // 相似/区别/工艺/传承人问法都可离线给出同一条可追溯答案。
    if (intent) {
      return mockDelay().then(function () { return intent; });
    }

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

    if (!canCallApi(this.cfg)) {
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
    isRefusal: isRefusal,
    reset: function () { current = null; }
  };
})();
