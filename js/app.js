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

  // 对外暴露（详情弹层「问问阿蓝」会调用）
  window.App = { ask: ask };

  document.addEventListener('DOMContentLoaded', function () {
    try { window.UI.init(); } catch (e) { console.error('UI.init error:', e); }
    bind();
    try { window.Admin.init(); } catch (e) { console.error('Admin.init error:', e); }
    try { window.Showcase3D.init(); } catch (e) { console.error('3D.init error:', e); }
    try { window.Diancang.init(); } catch (e) { console.error('Diancang.init error:', e); }

    // 主内容 Tab 切换
    var tabs = document.querySelectorAll('.main-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var panelId = tab.getAttribute('data-panel');
        document.querySelectorAll('.tab-panel').forEach(function (p) {
          p.classList.toggle('active', p.id === panelId);
        });
      });
    });
  });
})();
