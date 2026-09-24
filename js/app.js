/**
 * 应用入口：装配聊天流程
 */
(function () {
  'use strict';

  var input, sendBtn;
  var busy = false;

  function setBusy(on) {
    busy = on;
    if (sendBtn) sendBtn.disabled = on;
    if (input) input.disabled = on;
  }

  /** 答案里提到有原声讲解的典藏展品，就把客家话视频挂在气泡下面 */
  function attachVideos(bubble, question, answer) {
    if (!window.Diancang || !window.Diancang.findRelatedVideos) return;
    var items = window.Diancang.findRelatedVideos(question, answer).slice(0, 2);
    if (!items.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'msg-videos';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'msg-video-chip';
      b.textContent = '🎬 ' + it.name + ' · 客家话原声讲解';
      b.addEventListener('click', function () { window.Diancang.playVideo(it); });
      wrap.appendChild(b);
    });
    bubble.appendChild(wrap);
  }

  function ask(question) {
    question = String(question || '').trim();
    if (!question || busy) return;

    // 清空输入、更新状态
    if (input) input.value = '';
    setBusy(true);

    // 用户气泡
    window.UI.Chat.addUser(question);

    // 阿蓝进入思考状态
    var bubble = window.UI.Chat.addBotShell();
    window.UI.Avatar.thinking(true);
    window.UI.Avatar.talking(false);
    window.UI.Voice.stop();

    var engine = window.AnswerEngine.getEngine();

    engine.ask(question).then(function (result) {
      window.UI.Avatar.thinking(false);
      window.UI.Avatar.talking(true);

      return window.UI.Chat.typewrite(bubble, result.text, function onProgress(state) {
        if (state === 'done') {
          window.UI.Avatar.talking(false);
        }
      }).then(function () {
        window.UI.Avatar.talking(false);
        window.UI.Voice.speak(result.text);

        // 引擎状态展示
        var statusEl = document.getElementById('engineStatus');
        if (statusEl) {
          var label = engine.label || engine.name;
          if (result.source === 'rules' && result.matched) {
            statusEl.textContent = '当前引擎：本地知识库 · 命中「' + result.matched + '」';
          } else if (result.fallback) {
            statusEl.textContent = '当前引擎：本地知识库 · 未命中，已启用兜底引导';
          } else {
            statusEl.textContent = '当前引擎：' + label;
          }
        }

        attachVideos(bubble, question, result.text);
      });
    }).catch(function (err) {
      console.error(err);
      window.UI.Avatar.thinking(false);
      window.UI.Avatar.talking(false);
      bubble.textContent = '阿蓝刚才走神了，抱歉~ 请再试一次。';
    }).then(function () {
      setBusy(false);
      if (input) input.focus();
    });
  }

  function bind() {
    input = document.getElementById('chatInput');
    sendBtn = document.getElementById('sendBtn');

    sendBtn.addEventListener('click', function () {
      ask(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        ask(input.value);
      }
    });

    // 快捷问题 chips
    document.getElementById('quickQuestions').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      ask(chip.getAttribute('data-q'));
    });
  }

  /** 切换主面板：Tab 点击、详情弹层「问问阿蓝」、典藏跳转共用这一条路径 */
  function switchPanel(panelId) {
    document.querySelectorAll('.main-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-panel') === panelId);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === panelId);
    });
    var main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    // 3D 的引擎与贴图（约 13MB）不在首屏拉，第一次切到本视图才加载
    if (panelId === 'panel3d' && window.Showcase3D && window.Showcase3D.reveal) {
      window.Showcase3D.reveal();
    }
    // 直接调用（例如「问问阿蓝」）也要让地址栏跟上，hash 相同则不会触发事件
    var routeName = window.Router && window.Router.BY_PANEL[panelId];
    if (routeName && window.location.hash !== '#/' + routeName) {
      window.location.hash = '#/' + routeName;
    }
  }

  // 对外暴露（详情弹层「问问阿蓝」会调用）
  window.App = { ask: ask, switchPanel: switchPanel };

  document.addEventListener('DOMContentLoaded', function () {
    try { window.UI.init(); } catch (e) { console.error('UI.init error:', e); }
    bind();
    try { window.Admin.init(); } catch (e) { console.error('Admin.init error:', e); }
    try { window.Showcase3D.init(); } catch (e) { console.error('3D.init error:', e); }
    try { window.Diancang.init(); } catch (e) { console.error('Diancang.init error:', e); }
    try { window.Dialect.init(); } catch (e) { console.error('Dialect.init error:', e); }

    // 主内容 Tab 切换：走 Router，让每个视图都有可分享的地址
    var tabs = document.querySelectorAll('.main-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var panelId = tab.getAttribute('data-panel');
        var name = window.Router && window.Router.BY_PANEL[panelId];
        if (name) window.Router.go(name);
        else switchPanel(panelId);
      });
    });

    if (window.Router) {
      window.addEventListener('hashchange', window.Router.apply);
      window.Router.apply();
    }
  });
})();
