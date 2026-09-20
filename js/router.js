/**
 * 视图路由：把每个面板映射成一个可分享的 hash 地址。
 *
 * 只做「名字 ↔ 面板 id」的翻译和地址栏同步，真正的显示切换仍然走
 * App.switchPanel()，避免出现第二套切换逻辑互相打架。
 */
(function () {
  'use strict';

  var ROUTES = {
    chat: 'panelChat',
    science: 'panelHeritage',
    model3d: 'panel3d',
    diancang: 'panelDiancang',
    dialect: 'viewDialect'
  };

  var BY_PANEL = {};
  Object.keys(ROUTES).forEach(function (name) { BY_PANEL[ROUTES[name]] = name; });

  function current() {
    var h = String(window.location.hash || '').replace(/^#\/?/, '');
    return ROUTES[h] ? h : 'chat';
  }

  /** 按当前 hash 切换视图。
   *  没有 hash 时只应用默认视图，不去改写地址栏——曾经用 location.replace
   *  补一个 #/chat 会把正在加载的文档中止掉，等于首屏多刷一次。
   */
  function apply() {
    var name = current();
    if (window.App && window.App.switchPanel) window.App.switchPanel(ROUTES[name]);
    return name;
  }

  function go(name) {
    if (!ROUTES[name]) return false;
    var target = '#/' + name;
    if (window.location.hash === target) apply();
    else window.location.hash = target;
    return true;
  }

  window.Router = {
    ROUTES: ROUTES,
    BY_PANEL: BY_PANEL,
    current: current,
    apply: apply,
    go: go
  };
})();
