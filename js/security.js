/**
 * 前端安全与防逆向护盾 (Security & Anti-Reverse-Engineering Shield)
 * ------------------------------------------------------------
 * 1. 禁用恶意右键探测 (Context Menu Guard，允许 input/textarea 正常操作)
 * 2. 拦截调试与源码查看快捷键 (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S)
 * 3. 控制台安全警告告示 (Console Security Notice)
 * 4. 防点击劫持与非法跨域嵌套 (Anti-Clickjacking / Frame Buster)
 */
(function () {
  'use strict';

  // 1. 拦截右键菜单（展示页面防嗅探，但在输入框内保留原生剪贴板能力）
  document.addEventListener('contextmenu', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
      return; // 输入框允许原生菜单
    }
    e.preventDefault();
  }, { capture: true });

  // 2. 拦截常见调试快捷键（F12、Ctrl+Shift+I/J/C、Ctrl+U、Ctrl+S）
  document.addEventListener('keydown', function (e) {
    // F12
    if (e.keyCode === 123 || e.key === 'F12') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+Shift+I / J / C (DevTools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      var k = (e.key || '').toUpperCase();
      if (k === 'I' || k === 'J' || k === 'C') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
    // Ctrl+U (View Source) & Ctrl+S (Save Page)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      var keyLower = (e.key || '').toLowerCase();
      if (keyLower === 'u' || keyLower === 's') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, { capture: true });

  // 3. 控制台安全警示告示（防止非法调试与渗透）
  try {
    var styleTitle = 'color: #D32F2F; font-size: 18px; font-weight: bold;';
    var styleBody = 'color: #2F5D50; font-size: 12px; line-height: 1.6; font-weight: 500;';
    var styleHint = 'color: #888; font-size: 11px;';
    console.log('%c【系统安全提示】', styleTitle);
    console.log('%c本站点为龙南客家非遗保护产学研系统，代码受安全防护策略保护。\n严禁未经授权的逆向分析、接口嗅探、批量抓取或恶意渗透。', styleBody);
    console.log('%cSecurity Level: High | Edge Protected', styleHint);
  } catch (err) {}

  // 4. 防点击劫持与非法 iframe 嵌套 (Frame-Buster)
  try {
    if (window.top !== window.self) {
      try {
        var topOrigin = window.top.location.origin;
        if (topOrigin && topOrigin !== window.location.origin) {
          window.top.location = window.self.location;
        }
      } catch (crossError) {
        if (document.body) {
          document.body.style.display = 'none';
        }
        window.top.location = window.self.location;
      }
    }
  } catch (frameError) {}

  window.__SECURITY_INITIALIZED__ = true;
})();
