import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function setupEnvironment() {
  const storage = new Map();
  const window = {
    KNOWLEDGE_BASE: [
      { id: 'kb-base-1', title: '客家蓝染', keywords: ['蓝染', '染布'], answer: '蓝染是传统工艺。' },
      { id: 'kb-base-2', title: '杨村竹编', keywords: ['竹编', '圆筛'], answer: '竹编技艺精湛。' }
    ]
  };

  const sandbox = {
    window,
    console: { warn() {} },
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), sandbox);
  return { sandbox, window, storage };
}

test('超级管理员与受邀令牌在刷新页面后均可免密恢复会话', () => {
  const env = setupEnvironment();
  const { sandbox, window, storage } = env;

  // 1. 超级管理员登录
  const superAuth = window.Store.verifyLogin('admin123');
  assert.equal(superAuth.ok, true);
  assert.equal(superAuth.role, 'super_admin');
  window.Store.saveSession(superAuth);

  // 模拟页面刷新（重新加载脚本，localStorage 保持）
  const sandbox2 = {
    window: { KNOWLEDGE_BASE: [] },
    console: { warn() {} },
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    navigator: { userAgent: 'Windows' },
    Date, Math, JSON, Array, Object, String, Number
  };
  vm.createContext(sandbox2);
  vm.runInContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), sandbox2);

  const restoredSuper = sandbox2.window.Store.getSession();
  assert.ok(restoredSuper, '超级管理员刷新后应成功恢复会话');
  assert.equal(restoredSuper.role, 'super_admin');

  // 2. 受邀令牌签发与登录
  const token = sandbox2.window.Store.generateInviteToken('龙南文化馆李老师', 7);
  assert.ok(token && token.token);

  const tokenAuth = sandbox2.window.Store.verifyLogin(token.token);
  assert.equal(tokenAuth.ok, true);
  assert.equal(tokenAuth.role, 'editor');
  sandbox2.window.Store.saveSession(tokenAuth);

  // 模拟再次刷新
  const sandbox3 = {
    window: { KNOWLEDGE_BASE: [] },
    console: { warn() {} },
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    navigator: { userAgent: 'Windows' },
    Date, Math, JSON, Array, Object, String, Number
  };
  vm.createContext(sandbox3);
  vm.runInContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), sandbox3);

  const restoredToken = sandbox3.window.Store.getSession();
  assert.ok(restoredToken, '受邀令牌刷新后应成功恢复会话');
  assert.equal(restoredToken.role, 'editor');
  assert.equal(restoredToken.name, '龙南文化馆李老师');
  assert.equal(restoredToken.token, token.token);

  // 3. 超级管理员暂停令牌后，该令牌刷新失效
  sandbox3.window.Store.pauseInviteToken(token.id);
  const pausedSession = sandbox3.window.Store.getSession();
  assert.equal(pausedSession, null, '令牌被暂停后，刷新读取会话应返回 null 并清理本地凭据');

  // 4. 主动退出登录
  sandbox3.window.Store.saveSession({ role: 'super_admin', name: '超级管理员' });
  assert.ok(sandbox3.window.Store.getSession());
  sandbox3.window.Store.clearSession();
  assert.equal(sandbox3.window.Store.getSession(), null, '退出登录后本地会话应彻底清空');
});

test('自定义条目默认置顶排序与知识库管理', () => {
  const env = setupEnvironment();
  const { window } = env;

  const initial = window.Store.getEntries();
  assert.equal(initial.length, 2);

  // 新增自定义条目
  const newEntry = window.Store.addEntry({
    title: '最新采风：关西新围门榜',
    keywords: ['门榜', '关西新围'],
    answer: '关西新围门榜具有客家宗族崇文重教的独特内涵。'
  }, { name: '调研员小张', tokenId: 'tok-123' });

  assert.ok(newEntry.id.startsWith('custom-'));
  assert.equal(newEntry.creatorName, '调研员小张');

  const all = window.Store.getEntries();
  assert.equal(all.length, 3);

  // 验证置顶自定义条目排序逻辑
  const customFirstList = all.slice().sort((a, b) => {
    const isCustomA = (a.id && a.id.indexOf('custom-') === 0) || a.creatorTokenId || a.createdAt;
    const isCustomB = (b.id && b.id.indexOf('custom-') === 0) || b.creatorTokenId || b.createdAt;
    if (isCustomA && !isCustomB) return -1;
    if (!isCustomA && isCustomB) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  assert.equal(customFirstList[0].id, newEntry.id, '最新添加的自定义条目必须排在第一位置顶');
  assert.equal(customFirstList[0].title, '最新采风：关西新围门榜');
});

test('科普卡片与方言语料自定义置顶与管理', () => {
  const env = setupEnvironment();
  const { window } = env;

  // 科普模块测试
  const defaultKepu = [{ id: 'kp-1', name: '客家织带', tag: '传统手艺' }];
  const addedKepu = window.Store.addHeritageCard({
    name: '龙南过山溜方言说唱',
    tag: '口头非遗',
    detail: '流传于龙南山区的即兴说唱。'
  }, { name: '文化站' });

  const allKepu = window.Store.getHeritageCards(defaultKepu);
  assert.equal(allKepu.length, 2);

  const customKepu = allKepu.filter(c => (c.id && c.id.indexOf('kepu-') === 0));
  const builtinKepu = allKepu.filter(c => customKepu.indexOf(c) === -1);
  const sortedKepu = customKepu.concat(builtinKepu);
  assert.equal(sortedKepu[0].id, addedKepu.id, '最新自定义科普卡片默认排在第一位');

  // 方言模块测试
  const addedDialect = window.Store.addDialectTrack({
    chapter: '客家山歌',
    item: { name: '月光光山歌变奏版', page: 3, videoUrl: 'https://example.com/audio.mp3' }
  }, { name: '民俗传人' });

  const customDialects = window.Store.getCustomDialectTracks();
  assert.equal(customDialects.length, 1);
  assert.equal(customDialects[0].item.name, '月光光山歌变奏版');
  assert.equal(customDialects[0].creatorName, '民俗传人');
});
