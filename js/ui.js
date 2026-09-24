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
      '  <div class="chat-empty-hint">关于蓝染、竹编、织带、围屋的任何问题<br>都可以在这里得到回答</div>' +
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
        tag: '草木染 · 靛蓝匠心',
        accent: '#2F5D50',
        bg: '#E4EFEA',
        detail:
          '<p>以板蓝根（蓼蓝）为原料，经浸泡制靛、布料浸染、氧化显色、晾晒固色等工序，染出深沉温润的蓝。</p>' +
          '<p>传承人李洁春老师向团队完整演示了制靛到晾晒的全流程，并展示扎染纹样设计——以扎缝防染，形成深浅相间的传统花纹。</p>' +
          '<p>2026 年暑期，团队专访蓝染传承人，采集工艺影像与口述资料，形成数字档案与双语宣传片素材。</p>',
        ask: '什么是客家蓝染？'
      },
      {
        id: 'zhubian',
        name: '客家竹编',
        icon: '🎋',
        tag: '就地取材 · 匠心编织',
        accent: '#6B8F4E',
        bg: '#EDF3E6',
        detail:
          '<p>赣南竹编历史悠久，多取三年生毛竹，经刮青、剖篾、编织、打磨等工序，化竹为器。</p>' +
          '<p>成品既有竹篮、竹筛、竹席等生活器具，也有工艺精巧的摆件，编织纹样蕴含吉祥寓意，体现客家人就地取材的生活智慧。</p>' +
          '<p>团队走访竹编传承人，记录了编制方法与代表性竹器，相关素材已进入数字助手知识库。</p>',
        ask: '竹编有什么工艺特色？'
      },
      {
        id: 'zhidai',
        name: '客家织带',
        icon: '🧶',
        tag: '女红技艺 · 纹样寄情',
        accent: '#C45C26',
        bg: '#FBEDE4',
        detail:
          '<p>客家织带是客家女红的重要技艺，常用木质织带机编织，图案以几何纹、花草纹为主。</p>' +
          '<p>不同纹样承载不同寓意：有的象征吉祥如意，有的祝福多子多福。织带广泛用于腰带、背带与节庆装饰，在客家婚俗中尤为常见——把祝福织进带子里。</p>' +
          '<p>团队专访织带传承人，记录织带机操作与多种传统纹样，留存珍贵的工艺影像。</p>',
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
     站点不再渲染任何二维码：地址和书里那些二维码背后的内容，一律
     直接以可点开的链接列出来。
     ================================================================ */
  var AccessPanel = (function () {
    var modal, addrRow, modeHint, listEl;
    var publicInput, publicSave, publicHint;
    var LS_KEY = 'nfyj_public_url';

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function currentUrl() {
      return window.location.href.split('#')[0];
    }

    // 读取公网地址：localStorage > config.app.publicUrl
    function getPublicUrl() {
      try {
        var saved = localStorage.getItem(LS_KEY);
        if (saved) return saved;
      } catch (e) {}
      var cfg = window.APP_CONFIG && window.APP_CONFIG.app;
      return (cfg && cfg.publicUrl) || '';
    }

    function setPublicUrl(url) {
      try {
        if (url) localStorage.setItem(LS_KEY, url);
        else localStorage.removeItem(LS_KEY);
      } catch (e) {}
    }

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
      modeHint.textContent = pub
        ? '当前：公网地址（任何网络都能打开，扫码即进）'
        : (/^https?:\/\//i.test(t)
            ? '当前：局域网地址（手机需与电脑同一 Wi-Fi）'
            : '当前：本地文件预览（请运行 qidong.bat）');
      publicInput.value = pub;
      publicHint.classList.toggle('is-public', !!pub);
    }

    /** 书里每个展品旁的二维码，解码后就是这条客家话讲解链接，这里直接列出来 */
    function renderExhibitLinks() {
      var items = [];
      var data = window.DIANCANG;
      if (data && data.chapters) {
        data.chapters.forEach(function (ch) {
          (ch.items || []).forEach(function (it) { if (it.videoUrl) items.push(it); });
        });
      }
      var countEl = document.getElementById('addrLinkCount');
      if (countEl) countEl.textContent = items.length;
      if (!items.length) {
        listEl.innerHTML = '<li class="addr-empty">暂无讲解链接</li>';
        return;
      }
      listEl.innerHTML = items.map(function (it) {
        return '<li class="addr-item">' +
          '<span class="addr-item-page">第 ' + esc(it.page) + ' 页</span>' +
          '<span class="addr-item-name">' + esc(it.name) + '</span>' +
          '<a class="addr-item-link" href="' + esc(it.videoUrl) + '" target="_blank" rel="noopener">客家话讲解 →</a>' +
          '</li>';
      }).join('');
    }

    function init() {
      modal = document.getElementById('accessModal');
      addrRow = document.getElementById('addrRow');
      modeHint = document.getElementById('addrModeHint');
      listEl = document.getElementById('addrLinkList');
      publicInput = document.getElementById('addrPublicInput');
      publicSave = document.getElementById('addrPublicSave');
      publicHint = document.getElementById('addrPublicHint');

      document.getElementById('accessBtn').addEventListener('click', open);
      document.getElementById('addrClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });

      publicSave.addEventListener('click', function () {
        var u = normalizeUrl(publicInput.value);
        if (u && !isHttpUrl(u)) {
          publicHint.textContent = '地址格式不正确，请以 https:// 开头';
          publicHint.classList.remove('is-public');
          return;
        }
        setPublicUrl(u);
        renderAddress();
        publicHint.textContent = u
          ? '已保存，链接已切换为公网地址（任何网络可打开）'
          : '已清除公网地址，恢复局域网模式';
        publicHint.classList.toggle('is-public', !!u);
      });

      publicInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); publicSave.click(); }
      });
    }

    function open() {
      renderAddress();
      renderExhibitLinks();
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    return { init: init, open: open, close: close };
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
    Access: AccessPanel
  };
})();
