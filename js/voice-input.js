/**
 * 问答输入框的语音输入：按一下说话，再按一下把话变成文字填进输入框。
 *
 * 为什么不用浏览器自带的 webkitSpeechRecognition：Chrome 那套识别是把音频发到
 * 谷歌服务器再返回结果的，馆里（以及国内多数网络）根本连不上，点了只会转圈到超时。
 * 这里走国内可直连的 ASR 接口（硅基流动 SenseVoice，和问答用的是同一个 key），
 * 录音用 MediaRecorder，全程只依赖"能访问 api.siliconflow.cn"这一件事。
 *
 * 三条硬要求：
 *  1. 不静默失败——麦克风被拒、设备没有麦克风、服务没回应，都要在按钮下面写清楚原因；
 *  2. 转出来的字只是**填进输入框**，不自动发送，观众可以说错了能改；
 *  3. 服务不可用时文字输入照常可用，按钮置灰而不是消失（消失会让人以为坏了）。
 */
(function () {
  'use strict';

  var btn, hint, input;
  var rec = null, stream = null, chunks = [], state = 'idle', timer = null, seq = 0;

  function aiCfg() {
    if (window.Store && window.Store.getEffectiveAi) return window.Store.getEffectiveAi();
    return (window.APP_CONFIG && window.APP_CONFIG.ai) || {};
  }
  function cfg() {
    var a = aiCfg().asr || {};
    return {
      url: a.url || 'https://api.siliconflow.cn/v1/audio/transcriptions',
      model: a.model || 'FunAudioLLM/SenseVoiceSmall',
      language: a.language || 'zh',
      maxMs: a.maxMs || 20000
    };
  }
  function apiKey() { return (aiCfg().api || {}).apiKey || ''; }

  /** 不可用的原因要说得具体，"不支持"三个字等于没说。 */
  function unavailable() {
    if (!(window.isSecureContext || location.protocol === 'https:' ||
          location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      return '当前不是 HTTPS 环境，浏览器不允许网页录音';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      return '这个浏览器没有录音接口，请用文字输入';
    }
    if (!apiKey()) return '这个地址没有配置语音识别服务';
    return '';
  }

  function setState(s, msg) {
    state = s;
    if (btn) {
      btn.classList.toggle('is-listening', s === 'listening');
      btn.classList.toggle('is-busy', s === 'transcribing');
      btn.setAttribute('aria-pressed', s === 'listening' ? 'true' : 'false');
      btn.disabled = (s === 'transcribing') || !!unavailable();
    }
    if (hint) hint.textContent = msg || '';
  }

  function stopStream() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function start() {
    var why = unavailable();
    if (why) { setState('idle', why); return; }
    if (state !== 'idle') return;
    var myTask = ++seq;
    setState('listening', '正在听……说完再点一下（最长 ' + Math.round(cfg().maxMs / 1000) + ' 秒）');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      if (myTask !== seq) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      chunks = [];
      var mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm' : '';
      rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () { upload(myTask); };
      rec.start();
      timer = setTimeout(function () { if (state === 'listening') stop(); }, cfg().maxMs);
    }, function (err) {
      if (myTask !== seq) return;
      stopStream();
      var name = (err && err.name) || '';
      setState('idle', name === 'NotAllowedError' ? '麦克风权限被拒绝，文字输入照常可用'
        : name === 'NotFoundError' ? '这台设备没有可用的麦克风'
        : '打不开麦克风（' + (name || '未知原因') + '），文字输入照常可用');
    });
  }

  function stop() {
    if (state !== 'listening') return;
    stopStream();
    if (rec && rec.state !== 'inactive') rec.stop();
    else finish('没录到声音，再试一次');
  }

  function toggle() { if (state === 'listening') stop(); else start(); }

  function upload(myTask) {
    if (myTask !== seq) return;                 // 已经取消/重开，旧音频不上去
    var blob = new Blob(chunks, { type: chunks.length ? chunks[0].type : 'audio/webm' });
    chunks = [];
    if (!blob.size) { finish('没录到声音，再试一次'); return; }
    setState('transcribing', '在把话转成文字…');
    var form = new FormData();
    form.append('model', cfg().model);
    form.append('language', cfg().language);
    form.append('file', blob, 'voice.webm');
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 15000);
    fetch(cfg().url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey() },
      body: form,
      signal: ctl.signal
    }).then(function (r) {
      clearTimeout(to);
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 60)); });
      return r.json();
    }).then(function (d) {
      if (myTask !== seq) return;
      var text = String((d && d.text) || '').replace(/[\u2028\u2029]/g, ' ').trim();
      if (!text || text === '🎼') { finish('没听清，再说一次？'); return; }
      if (input) {
        input.value = (input.value && !/[？?！!。]$/.test(input.value.trim())
          ? input.value.replace(/\s+$/, '') + '，' : input.value) + text;
        input.focus();
      }
      finish('');
    }).catch(function (err) {
      clearTimeout(to);
      if (myTask !== seq) return;
      finish('语音识别服务没回应（' + String((err && err.message) || err).slice(0, 40)
        + '），文字输入照常可用');
    });
  }

  function finish(msg) {
    setState('idle', msg);
  }

  function init() {
    btn = document.getElementById('micBtn');
    hint = document.getElementById('micHint');
    input = document.getElementById('chatInput');
    if (!btn || !input) return;
    btn.addEventListener('click', toggle);
    var why = unavailable();
    setState('idle', why ? why + '，文字输入照常可用' : '');
  }

  window.VoiceInput = { init: init, toggle: toggle, stop: stop, start: start,
                        state: function () { return state; }, unavailable: unavailable,
                        capturing: function () { return !!rec && rec.state === 'recording'; } };
})();
