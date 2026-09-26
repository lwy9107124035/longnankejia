/**
 * UI 模块：聊天渲染 / 打字机 / 虚拟形象状态 / 语音 / 访问地址 / 弹层
 */
(function () {
  'use strict';


  /* ================================================================
     聊天 UI
     ================================================================ */
  var Chat = (function () {
    var windowEl, inputEl, sendBtn;
    var emptyHtml = '' +
      '<div class="chat-empty">' +
      '  <div class="chat-empty-icon">💬</div>' +
      '  <div class="chat-empty-title">问问阿蓝吧</div>' +
      '  <div class="chat-empty-hint">蓝染、竹编、织带、围屋，随便问<br>阿蓝知道多少就说多少</div>' +
      '</div>';

    var botAvatarImg = '<img class="msg-avatar-img" src="assets/avatar/alan-face.png" alt="阿蓝">';

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    }

    function ensureNotEmpty() {
      if (windowEl.querySelector('.chat-empty')) return;
      if (!windowEl.querySelector('.msg')) {
        windowEl.innerHTML = emptyHtml;
      }
    }

    function scrollToBottom() {
      windowEl.scrollTop = windowEl.scrollHeight;
    }

    function addUser(text) {
      ensureNotEmpty();
      var m = el('div', 'msg msg-user');
      m.appendChild(el('div', 'msg-avatar', '🧑'));
      var bubble = el('div', 'msg-bubble');
      bubble.textContent = text;
      m.appendChild(bubble);
      windowEl.appendChild(m);
      scrollToBottom();
      return bubble;
    }

    function addBotShell() {
      ensureNotEmpty();
      var m = el('div', 'msg msg-bot');
      m.appendChild(el('div', 'msg-avatar', botAvatarImg));
      var bubble = el('div', 'msg-bubble');
      bubble.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>';
      m.appendChild(bubble);
      windowEl.appendChild(m);
      scrollToBottom();
      return bubble;
    }

    // 打字机效果，返回 Promise
    function typewrite(bubble, text, onProgress) {
      return new Promise(function (resolve) {
        var lines = String(text).split('\n');
        bubble.textContent = '';
        var cursor = el('span', 'typing-cursor');
        bubble.appendChild(cursor);

        var flat = lines.map(function (l) { return l; });
        var li = 0, ci = 0;
        var timer = null;

        function step() {
          if (li >= flat.length) {
            if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
            if (onProgress) onProgress('done');
            scrollToBottom();
            resolve();
            return;
          }
          if (ci === 0 && li > 0) {
            bubble.insertBefore(document.createElement('br'), cursor);
          }
          var line = flat[li];
          if (ci < line.length) {
            cursor.insertAdjacentText('beforebegin', line.charAt(ci));
            ci++;
            // 快速输出，标点稍停
            var ch = line.charAt(ci - 1);
            var delay = '，。！？；：'.indexOf(ch) !== -1 ? 40 : 8;
            timer = setTimeout(step, delay);
          } else {
            li++;
            ci = 0;
            timer = setTimeout(step, 15);
          }
          scrollToBottom();
        }

        step();

        // 暴露取消（用户提前发新消息时可打断）
        bubble._cancelTypewriter = function () {
          if (timer) clearTimeout(timer);
          if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
          bubble.textContent = text;
          resolve();
        };
      });
    }

    function init() {
      windowEl = document.getElementById('chatWindow');
      inputEl = document.getElementById('chatInput');
      sendBtn = document.getElementById('sendBtn');
      ensureNotEmpty();
    }

    return {
      init: init,
      addUser: addUser,
      addBotShell: addBotShell,
      typewrite: typewrite,
      scrollToBottom: scrollToBottom
    };
  })();

  /* ================================================================
     虚拟形象状态
     ================================================================ */
  var Avatar = (function () {
    var wrap;
    function init() {
      wrap = document.getElementById('avatarWrap');
    }
    function talking(on) {
      if (!wrap) return;
      wrap.classList.toggle('is-talking', !!on);
    }
    function thinking(on) {
      if (!wrap) return;
      wrap.classList.toggle('is-thinking', !!on);
    }
    return { init: init, talking: talking, thinking: thinking };
  })();

  /* ================================================================
     语音朗读
     ================================================================ */
  var Voice = (function () {
    var supported = typeof window.speechSynthesis !== 'undefined';
    var checkbox;

    function init() {
      checkbox = document.getElementById('voiceToggle');
      if (!supported) {
        var row = document.querySelector('.voice-row');
        if (row) row.style.display = 'none';
      }
    }

    function enabled() {
      return supported && checkbox && checkbox.checked;
    }

    function speak(text) {
      if (!enabled()) return;
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(String(text).replace(/\n+/g, '，'));
        var cfg = (window.APP_CONFIG && window.APP_CONFIG.voice) || {};
        u.lang = cfg.lang || 'zh-CN';
        u.rate = cfg.rate || 1;
        u.pitch = cfg.pitch || 1;
        window.speechSynthesis.speak(u);
      } catch (e) {
        /* 忽略语音异常，不影响主流程 */
      }
    }

    function stop() {
      if (supported) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    }

    return { init: init, speak: speak, stop: stop, enabled: enabled };
  })();

  /* ================================================================
     非遗卡片
     ================================================================ */
  var Heritage = (function () {
    var CARDS = [
      {
        id: 'landye',
        name: '客家蓝染',
        icon: '🧵',
        tag: '草木染 · 板蓝根制靛',
        accent: '#2F5D50',
        bg: '#E4EFEA',
        detail:
          '<p>以板蓝根（蓼蓝）为原料，经浸泡制靛、布料浸染、氧化显色、晾晒固色等工序，染出深沉温润的蓝。</p>' +
          '<p>传承人李洁春老师向团队完整演示了制靛到晾晒的全流程，并展示扎染纹样设计：以扎缝防染，形成深浅相间的传统花纹。</p>' +
          '<p>2026 年暑期，团队专访蓝染传承人，采集工艺影像与口述资料，形成数字档案与双语宣传片素材。</p>',
        ask: '什么是客家蓝染？'
      },
      {
        id: 'zhubian',
        name: '客家竹编',
        icon: '🎋',
        tag: '就地取材 · 三年生毛竹',
        accent: '#6B8F4E',
        bg: '#EDF3E6',
        detail:
          '<p>赣南竹编历史悠久，多取三年生毛竹，经刮青、剖篾、编织、打磨等工序，化竹为器。</p>' +
          '<p>成品既有竹篮、竹筛、竹席等生活器具，也有工艺精巧的摆件，纹样多取吉祥寓意。</p>' +
          '<p>团队走访竹编传承人，记录了编制方法与代表性竹器，相关素材已进入数字助手知识库。</p>',
        ask: '竹编有什么工艺特色？'
      },
      {
        id: 'zhidai',
        name: '客家织带',
        icon: '🧶',
        tag: '女红技艺 · 几何纹花草纹',
        accent: '#C45C26',
        bg: '#FBEDE4',
        detail:
          '<p>客家织带是客家女红的重要技艺，常用木质织带机编织，图案以几何纹、花草纹为主。</p>' +
          '<p>不同纹样承载不同寓意：有的象征吉祥如意，有的祝福多子多福。织带广泛用于腰带、背带与节庆装饰，在客家婚俗中常见。</p>' +
          '<p>团队专访织带传承人，记录织带机操作与多种传统纹样，留下工艺影像。</p>',
        ask: '客家织带有什么寓意？'
      },
      {
        id: 'weiwu',
        name: '客家围屋',
        icon: '🏯',
        tag: '世界围屋之都 · 龙南',
        accent: '#8B6B4A',
        bg: '#F3EDE4',
        detail:
          '<p>龙南素有「世界围屋之都」美誉，现存客家围屋 376 座，是赣南客家文化的核心承载地。</p>' +
          '<p>围屋是客家先民聚族而居、御外自保的城堡式建筑，代表有关西新围、燕翼围等，中轴对称、方正厚重，融合中原营造技艺与客家智慧。</p>' +
          '<p>2006 年，客家围（龙南）被列入全国重点文物保护单位，如今也是重要的文旅打卡地。</p>',
        ask: '龙南为什么叫世界围屋之都？'
      },
      {
        id: 'opera',
        name: '客家戏曲与说唱',
        icon: '🎭',
        tag: '表演艺术 · 采茶戏 莲花调 落地花鼓 木偶戏',
        accent: '#9B3D5B',
        bg: '#FBEFF2',
        detail:
          '<p>采茶戏流行于江西、湖北、湖南、安徽、福建、广东、广西等省区，因地区不同而各冠地名，如粤北采茶戏、阳新采茶戏、黄梅采茶戏；其中以江西最为普遍、剧种最多。</p>' +
          '<p>莲花调流传于龙南东坑、里仁、龙南镇、汶龙、杨村一带，上世纪之初由粤之和平、连平及赣之全南三县传入。唱词以四句七言为主，音乐自由、即兴而歌，以竹板击节。</p>' +
          '<p>落地花鼓两百余年前由福建武平传入广东平远，生、旦、丑三人登场，音乐融合凤阳花鼓、汉调与客家山歌。杖头木偶戏以樟木雕偶头、装操纵杆，演员藏于屏后举杆而演，一人双脚踩打锣鼓、双手操控木偶，兼以说唱对白，2021 年列入省级非遗。</p>',
        ask: '龙南的采茶戏和莲花调各有什么特点？'
      },
      {
        id: 'food',
        name: '客家味道',
        icon: '🥢',
        tag: '味觉龙南 · 酿豆腐 黄元米果 四星望月 擂茶',
        accent: '#B4692B',
        bg: '#FBF1E6',
        detail:
          '<p>酿豆腐是客家菜之魂：豆腐挖坑填肉馅，煎而炖之，外皮焦黄、内里雪嫩。此乃客家人南迁后以豆腐代面皮的「无麦之饺」，藏着中原乡愁。</p>' +
          '<p>龙南人过年少不了黄元米果：取高山大禾米，以黄元柴草木灰滤碱水浸泡，反复上甑蒸熟，再入石臼人力捶打至软糯筋道。老话讲「过年吃米果，来年日子节节高」。</p>' +
          '<p>四星望月 1929 年由群众以「蒸笼粉鱼」招待毛泽东而来，竹笼似月、四碟如星。客家擂茶 2022 年列入联合国教科文组织人类非遗代表作名录。2019 年龙南第三届客家美食节从二十余道候选中评出十三道「龙南客家一桌菜」，其中凤眼珍珠汤在清代道光年间已列为贡品。</p>',
        ask: '酿豆腐为什么被叫作「无麦之饺」？'
      },
      {
        id: 'festival',
        name: '岁时节令',
        icon: '🏮',
        tag: '民俗活动 · 迎龙灯 烧瓦塔 走古事 九狮拜象',
        accent: '#C0392B',
        bg: '#FCEDEA',
        detail:
          '<p>迎龙灯是赣南客家逢年过节举办的传统民俗，已列入江西省省级非遗。龙灯以竹篾扎制骨架，糊纸或布，绘花鸟瑞兽等吉祥纹样并缀各式花灯。</p>' +
          '<p>龙南中秋流传老话「中秋烧瓦塔，岁岁家发达」：就地取砖瓦垒成空心高塔，暮色后引火内燃，再撒食盐谷壳助燃，漫天星火散落人间，火势越旺寓意日子越红火。</p>' +
          '<p>走古事始于明清之际，以「古装巡游＋仕子科考」为特色，孩童着汉服诵《三字经》与客家家训，琅琅书声漫过古巷。九狮拜象则是赣南客家传统民俗表演，2025 年 1 月「非遗贺新春」主会场在龙南世客围启动，37 名演员舞动雄狮与大象。</p>',
        ask: '中秋烧瓦塔的讲究是什么？'
      },
      {
        id: 'lifecustom',
        name: '人生礼俗',
        icon: '🧧',
        tag: '生命礼俗 · 寿诞 子孙袋 花帽 冬头帕',
        accent: '#7A4E9B',
        bg: '#F4EEF9',
        detail:
          '<p>客家寿诞承载敬老尊贤的文化精神。寿诞一般在 60 岁以上举行，称「大生日」，可提前不得推后，96 岁便可做百岁寿；一碗龙须面、一挂千子炮，尽显尊老敬贤的古朴民风。龙南妈祖信俗中，祝寿也是主要形式：每年农历三月二十三，香首们齐聚一堂给妈祖「过生日」。</p>' +
          '<p>子孙袋用红布缝成掌心大小，内装花生、红枣、莲子、桂圆取「早生贵子」谐音，再添几粒稻谷寓意五谷丰登。旧时女子出嫁，母亲在临行前亲手系在女儿腰间。</p>' +
          '<p>冬头帕是客家老年妇女常戴的头巾，以黑、蓝、灰棉布缝制，覆于额前垂至耳际，既挡风寒又添庄重。</p>',
        ask: '客家寿诞为什么要「可提前不得推后」？'
      },
      {
        id: 'dialect',
        name: '客家方言',
        icon: '🗣',
        tag: '语言活化石 · 宁龙片 · 16 段原声讲解',
        accent: '#2E6B6B',
        bg: '#E9F3F2',
        detail:
          '<p>龙南话属客家语宁龙片，保留了不少中古汉语的特点，被称作研究汉语演变的「活化石」。典藏里每件展品旁都印有一个二维码，扫开就是展品所在地口音的现场讲解录音，条目里还配了国际音标注音。</p>' +
          '<p>本应用把这 16 段原声直接列进了「方言」视图，不用扫码。「典藏」里还能打一个字词定位到讲它的展品：打「豆腐」会列出酿豆腐、黄姜豆腐，命中句同时标出来。</p>',
        ask: '龙南话属于客家语的哪个片？'
      },
      {
        id: 'dragonboat',
        name: '龙南龙舟',
        icon: '🚣',
        tag: '民俗体育 · 世界最小龙舟赛场 · 传承五百余年',
        accent: '#1F6F8B',
        bg: '#E8F2F6',
        detail:
          '<p>龙舟竞渡华夏遍有，龙南龙舟独异：其赛不在江河，而在杨村镇一方仅十五亩的池塘，有「世界最小龙舟赛场」之称。</p>' +
          '<p>此项习俗始于明弘治年间，源自杨村人赖思章的一段传奇：许愿木料速售，归必雕龙神金身、年年划船，后果验其言，遂率族人开挖池塘定为赛场，至今传承五百余年。</p>' +
          '<p>赛事有祀奉龙神、请龙神、龙船会、扫邪、决胜等八项仪轨，是一套完整的民间礼俗程序，而不只是一场竞速。届时赣粤两省三县民众纷至沓来，两岸人声与锣鼓相和。</p>' +
          '<p>「太平堡龙船会」已列为江西省省级非物质文化遗产代表性项目。</p>',
        ask: '龙南的龙舟为什么在池塘里赛？'
      },
      {
        id: 'lacquer',
        name: '龙南大漆',
        icon: '🏺',
        tag: '传统技艺 · 漆树天然漆 · 逾千年',
        accent: '#6B4226',
        bg: '#F4EDE7',
        detail:
          '<p>大漆又称天然漆，是漆树分泌的树脂，防腐、耐酸碱。《庄子·人世间》载「漆可用，故割之」，足见其用之久远。</p>' +
          '<p>龙南大漆技艺相传南宋时期随中原移民南迁传入，至今已逾千年，代代口手相传。工序极尽繁复：每上一道漆，须晾干后以砂纸细细打磨，反复十数次，前后历时六至二十四个月方得一件。成品光泽温润，耐热防潮。</p>' +
          '<p>旧时龙南人家，漆柜漆箱、围屋梁柱皆以大漆髹饰，经百年风雨色泽如新，围屋能撑到今天，这也是原因之一。</p>',
        ask: '龙南大漆技艺是什么时候传过来的？'
      },
      {
        id: 'hakkaconvention',
        name: '世界客属恳亲大会',
        icon: '🌏',
        tag: '客家纽带 · 始于 1971 · 龙南世客围',
        accent: '#3B6B3A',
        bg: '#EDF4EC',
        detail:
          '<p>世界客属恳亲大会的起源可追溯至 1971 年 9 月 28 日：当时香港崇正总会为庆祝成立五十周年暨「崇正大厦」落成，邀请世界各地 47 个客属社团的 250 多位乡亲代表齐聚香港。与会代表决议将其定为「世界客属第一届恳亲大会」，并决定以后每一至两年轮流在世界各地有关城市举办一届。</p>' +
          '<p>20 世纪基本每两年一届，进入 21 世纪改为每年一届，已在亚、美、非三大洲 11 个国家和地区成功举办多届，被称作客家人的「奥运会」。它也从最初的恳亲联谊，发展成融经济合作、文化交流与学术研讨于一体的综合性平台。</p>' +
          '<p>龙南的世客围即为此而建的文化地标，2025 年「非遗贺新春欢喜过大年」主会场活动便在此启动，九狮拜象率先登场。</p>',
        ask: '世界客属恳亲大会是从哪一年开始的？'
      }
    ];

    function init(onOpen) {
      var grid = document.getElementById('heritageGrid');
      if (!grid) return;
      CARDS.forEach(function (card) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'h-card';
        btn.style.setProperty('--card-accent', card.accent);
        btn.style.setProperty('--card-bg', card.bg);
        btn.innerHTML =
          '<div class="h-icon">' + card.icon + '</div>' +
          '<div class="h-name">' + card.name + '</div>' +
          '<div class="h-tag">' + card.tag + '</div>';
        btn.addEventListener('click', function () {
          if (onOpen) onOpen(card);
        });
        grid.appendChild(btn);
      });
    }

    function list() { return CARDS; }

    return { init: init, list: list };
  })();

  /* ================================================================
     二维码弹层
     ================================================================ */
  /* ================================================================
     访问地址面板
     ----------------------------------------------------------------
     顶栏「扫码访问」把站点地址画成二维码，同时给出可点链接，并按主机名如实
     说明这条地址谁能打开（公网 / 局域网 / 只有本机）。
     ================================================================ */
  var AccessPanel = (function () {
    var modal, addrRow, modeHint, canonRow;

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function currentUrl() {
      return window.location.href.split('#')[0];
    }

    // 固定入口地址：config.app.publicUrl 非空时以它为准，否则用当前网址自己推。
    // 这里不再提供"填一个地址存进 localStorage"的口子——那是还没有公网域名时的
    // 开发期脚手架，现在印展板用的固定地址是 config.app.canonicalUrl。
    function getPublicUrl() {
      var cfg = window.APP_CONFIG && window.APP_CONFIG.app;
      return (cfg && cfg.publicUrl) || '';
    }

    /** 谁能打开这条地址，只看主机名：私有网段出不了这个网，回环只有本机。 */
    function addrKind(u) {
      var h = (String(u || '').match(/^https?:\/\/([^\/:?#]+)/i) || [])[1] || '';
      if (!h) return 'file';
      if (/^127\./.test(h) || h === 'localhost' || h === '::1' || h === '[::1]') return 'loop';
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h)) return 'lan';
      if (/\.local$/i.test(h) || h.indexOf('.') === -1) return 'lan';
      return 'public';
    }

    var KIND_HINT = {
      public: '公网地址：任何网络都能打开，手机不必和电脑连同一个 Wi-Fi',
      lan: '局域网地址：手机要和电脑连同一个 Wi-Fi，出了这个网就打不开',
      loop: '本机地址：只有这台电脑能打开，别人扫了也进不来',
      file: '本地文件预览：请运行 qidong.bat 后用局域网地址'
    };

    function normalizeUrl(raw) {
      var u = String(raw || '').trim();
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      return u.replace(/\/+$/, '');
    }

    function isHttpUrl(u) {
      return /^https?:\/\/[^\s]+\.[^\s]+/i.test(u);
    }

    function target() {
      var t = normalizeUrl(getPublicUrl()) || currentUrl();
      if (!isHttpUrl(t)) {
        // 双击 index.html 直接预览时 location 是 file://，扫不出也打不开，退回永久地址
        var cfg = window.APP_CONFIG && window.APP_CONFIG.app;
        t = normalizeUrl((cfg && cfg.canonicalUrl) || '');
      }
      return t;
    }

    function copyAddress() {
      var t = target();
      var btn = document.getElementById('addrCopyBtn');
      function done(ok) { if (btn) btn.textContent = ok ? '已复制 ✓' : '复制失败，请手动选中'; }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    }

    /** 站点入口码：馆内观众扫它打开页面。与典藏 PDF 的印刷码无关。 */
    function renderQr(target) {
      var box = document.getElementById('addrQr');
      if (!box) return;
      box.innerHTML = '';
      if (!target || !isHttpUrl(target) || !window.QR) {
        box.innerHTML = '<div class="addr-empty">当前地址不可扫码，请用下方链接</div>';
        return;
      }
      var canvas = document.createElement('canvas');
      box.appendChild(canvas);
      if (!window.QR.render(target, canvas, 4)) {
        box.innerHTML = '<div class="addr-empty">地址过长，无法生成二维码，请用下方链接</div>';
      }
    }

    function renderAddress() {
      var pub = normalizeUrl(getPublicUrl());
      var t = pub || currentUrl();
      if (isHttpUrl(t)) {
        addrRow.innerHTML =
          '<a class="addr-link" href="' + esc(t) + '" target="_blank" rel="noopener">' + esc(t) + '</a>' +
          '<button class="addr-copy" id="addrCopyBtn" type="button">复制链接</button>';
        document.getElementById('addrCopyBtn').addEventListener('click', copyAddress);
      } else {
        addrRow.innerHTML = '<div class="addr-empty">当前是本地文件预览，无法生成可分享的地址</div>';
      }
      renderQr(isHttpUrl(t) ? t : '');
      modeHint.textContent = '当前：' + (KIND_HINT[addrKind(t)] || KIND_HINT.file);
      // 预览地址和印在展板上的那个不是一回事，扫错码的人会进到一个随时会换的地址
      var canon = normalizeUrl((window.APP_CONFIG && window.APP_CONFIG.app || {}).canonicalUrl || '');
      if (canon && normalizeUrl(canon) !== normalizeUrl(t)) {
        canonRow.hidden = false;
        canonRow.innerHTML = '展板上的码指向 <a class="addr-canon" href="' + esc(canon)
          + '" target="_blank" rel="noopener">' + esc(canon) + '</a>，那是永久地址；'
          + '上面这条是当前这个部署自己的地址。';
      } else {
        canonRow.hidden = true;
        canonRow.innerHTML = '';
      }
    }

    function init() {
      modal = document.getElementById('accessModal');
      addrRow = document.getElementById('addrRow');
      modeHint = document.getElementById('addrModeHint');
      canonRow = document.getElementById('addrCanonical');

      document.getElementById('accessBtn').addEventListener('click', open);
      document.getElementById('addrClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });
    }

    function open() {
      renderAddress();
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    return { init: init, open: open, close: close, addrKind: addrKind, target: target };
  })();

  /* ================================================================
     非遗详情弹层
     ================================================================ */
  var DetailModal = (function () {
    var modal, titleEl, bodyEl, iconEl, askBtn;
    var currentAsk = '';

    function init() {
      modal = document.getElementById('detailModal');
      titleEl = document.getElementById('detailTitle');
      bodyEl = document.getElementById('detailBody');
      iconEl = document.getElementById('detailIcon');
      askBtn = document.getElementById('askMoreBtn');

      document.getElementById('detailClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });
      askBtn.addEventListener('click', function () {
        close();
        // 只调 ask() 的话回答打在隐藏的问答面板里，用户看到的是「没反应」
        if (window.App && window.App.switchPanel) window.App.switchPanel('panelChat');
        if (window.App && window.App.ask) {
          setTimeout(function () { window.App.ask(currentAsk); }, 200);
        }
      });
    }

    function open(card) {
      titleEl.textContent = card.name;
      bodyEl.innerHTML = card.detail;
      iconEl.textContent = card.icon;
      iconEl.style.background = card.bg;
      currentAsk = card.ask;
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    return { init: init, open: open };
  })();

  /* ---------- 导出 ---------- */
  window.UI = {
    init: function () {
      Chat.init();
      Avatar.init();
      Voice.init();
      AccessPanel.init();
      DetailModal.init();
      Heritage.init(function (card) {
        DetailModal.open(card);
      });
    },
    Chat: Chat,
    Avatar: Avatar,
    Voice: Voice,
    Heritage: Heritage,
    Access: AccessPanel
  };
})();
