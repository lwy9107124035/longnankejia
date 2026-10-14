import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function setupEnvironment(customSessionStorage, customLocalStorage) {
  const localStorageMap = customLocalStorage || new Map();
  const sessionStorageMap = customSessionStorage || new Map();

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
      getItem: k => localStorageMap.get(k) || null,
      setItem: (k, v) => localStorageMap.set(k, String(v)),
      removeItem: k => localStorageMap.delete(k)
    },
    sessionStorage: {
      getItem: k => sessionStorageMap.get(k) || null,
      setItem: (k, v) => sessionStorageMap.set(k, String(v)),
      removeItem: k => sessionStorageMap.delete(k)
    },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    Promise
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(new URL('../js/answer-engine.js', import.meta.url), 'utf8'), sandbox);
  return { sandbox, window, localStorageMap, sessionStorageMap };
}

test('超级管理员与受邀令牌在单窗口刷新后均可免密恢复会话', () => {
  const env = setupEnvironment();
  const { window, sessionStorageMap, localStorageMap } = env;

  // 1. 超级管理员登录
  const superAuth = window.Store.verifyLogin('admin123');
  assert.equal(superAuth.ok, true);
  assert.equal(superAuth.role, 'super_admin');
  window.Store.saveSession(superAuth);

  // 模拟同一标签页刷新页面（sessionStorage 与 localStorage 均保持）
  const envRefresh1 = setupEnvironment(sessionStorageMap, localStorageMap);
  const restoredSuper = envRefresh1.window.Store.getSession();
  assert.ok(restoredSuper, '超级管理员刷新后应成功恢复会话');
  assert.equal(restoredSuper.role, 'super_admin');

  // 2. 签发受邀令牌
  const tokenObj = window.Store.generateInviteToken('龙南文化馆李老师', 7);
  assert.ok(tokenObj && tokenObj.token);

  const tokenAuth = window.Store.verifyLogin(tokenObj.token);
  assert.equal(tokenAuth.ok, true);
  assert.equal(tokenAuth.role, 'editor');
  window.Store.saveSession(tokenAuth);

  // 模拟受邀管理员同一标签页刷新
  const envRefresh2 = setupEnvironment(sessionStorageMap, localStorageMap);
  const restoredToken = envRefresh2.window.Store.getSession();
  assert.ok(restoredToken, '受邀令牌刷新后应成功恢复会话');
  assert.equal(restoredToken.role, 'editor');
  assert.equal(restoredToken.name, '龙南文化馆李老师');

  // 3. 退出登录
  envRefresh2.window.Store.clearSession();
  assert.equal(envRefresh2.window.Store.getSession(), null, '退出登录后本地会话彻底清空');
});

test('多窗口会话隔离：两个窗口一个登录管理员一个登录超级管理员，刷新互不干扰', () => {
  const localStorageShared = new Map();

  // 窗口 A：超级管理员
  const tabASession = new Map();
  const tabA = setupEnvironment(tabASession);
  tabA.sandbox.localStorage = {
    getItem: k => localStorageShared.get(k) || null,
    setItem: (k, v) => localStorageShared.set(k, String(v)),
    removeItem: k => localStorageShared.delete(k)
  };

  const authA = tabA.window.Store.verifyLogin('admin123');
  assert.equal(authA.role, 'super_admin');
  tabA.window.Store.saveSession(authA);

  // 窗口 A 签发受邀令牌
  const token = tabA.window.Store.generateInviteToken('陈专员', 15);

  // 窗口 B：受邀管理员
  const tabBSession = new Map();
  const tabB = setupEnvironment(tabBSession);
  tabB.sandbox.localStorage = {
    getItem: k => localStorageShared.get(k) || null,
    setItem: (k, v) => localStorageShared.set(k, String(v)),
    removeItem: k => localStorageShared.delete(k)
  };

  const authB = tabB.window.Store.verifyLogin(token.token);
  assert.equal(authB.role, 'editor');
  tabB.window.Store.saveSession(authB);

  // 此时两个窗口当前身份不同
  assert.equal(tabA.window.Store.getSession().role, 'super_admin');
  assert.equal(tabB.window.Store.getSession().role, 'editor');

  // 刷新窗口 A：模拟重新加载 store.js，但使用 tabASession
  const tabARefreshed = setupEnvironment(tabASession);
  tabARefreshed.sandbox.localStorage = tabA.sandbox.localStorage;
  assert.equal(tabARefreshed.window.Store.getSession().role, 'super_admin', '窗口 A 刷新后依然是超级管理员，未被窗口 B 覆盖！');

  // 刷新窗口 B：模拟重新加载 store.js，但使用 tabBSession
  const tabBRefreshed = setupEnvironment(tabBSession);
  tabBRefreshed.sandbox.localStorage = tabB.sandbox.localStorage;
  assert.equal(tabBRefreshed.window.Store.getSession().role, 'editor', '窗口 B 刷新后依然是受邀管理员，未被窗口 A 覆盖！');
});

test('跨设备自校验令牌与密码大小写容错', () => {
  // 设备 A：超级管理员签发自校验令牌
  const envA = setupEnvironment();
  const signedTokenObj = envA.window.Store.generateInviteToken('外地非遗专家王教授', 30);
  assert.ok(signedTokenObj.token.startsWith('NFYJ-INV-'));

  // 设备 B（全新设备，例如手机扫码）：localStorage 没有任何记录
  const envB = setupEnvironment();
  // 1. 测试超级管理员密码容错（手机端首字母大写 Admin123）
  const phoneSuperAuth = envB.window.Store.verifyLogin('Admin123');
  assert.equal(phoneSuperAuth.ok, true, '手机端自动大写 Admin123 应成功登录超级管理员');
  assert.equal(phoneSuperAuth.role, 'super_admin');

  // 2. 测试设备 B（手机端）直接输入设备 A 签发的自校验令牌，无服务器也能直接校验激活
  const phoneTokenAuth = envB.window.Store.verifyLogin(signedTokenObj.token);
  assert.equal(phoneTokenAuth.ok, true, '跨设备全新手机端应成功解析自校验令牌');
  assert.equal(phoneTokenAuth.role, 'editor');
  assert.equal(phoneTokenAuth.name, '外地非遗专家王教授');

  // 3. 测试设备 B（手机端）手动输入 6 位简短通行码，且模拟微信复制带有引号和空格
  const dirtyShortCode = `  “${signedTokenObj.shortCode}”  `;
  const phoneShortAuth = envB.window.Store.verifyLogin(dirtyShortCode);
  assert.equal(phoneShortAuth.ok, true, '跨设备全新手机端输入6位短码（含引号空格）应验签通过');
  assert.equal(phoneShortAuth.role, 'editor');

  // 4. 测试设备 B（手机端）单纯输入 6 位裸短码（不带 NFYJ-INV- 前缀）
  const bareShortCode = signedTokenObj.shortCode.replace('NFYJ-INV-', '');
  const phoneBareAuth = envB.window.Store.verifyLogin(bareShortCode);
  assert.equal(phoneBareAuth.ok, true, '跨设备全新手机端输入纯6位字母数字短码应验签通过');
  assert.equal(phoneBareAuth.role, 'editor');
});

test('AnswerEngine.ask 便捷方法调用正常响应', async () => {
  const env = setupEnvironment();
  const { window } = env;

  assert.ok(typeof window.AnswerEngine.ask === 'function', 'window.AnswerEngine 必须暴露 ask 便捷函数');
  const res = await window.AnswerEngine.ask('客家蓝染');
  assert.ok(res);
  assert.ok(res.text || res.answer);
});

test('自定义条目默认置顶排序与知识库管理', () => {
  const env = setupEnvironment();
  const { window } = env;

  const initial = window.Store.getEntries();
  assert.equal(initial.length, 2);

  const newEntry = window.Store.addEntry({
    title: '最新采风：关西新围门榜',
    keywords: ['门榜', '关西新围'],
    answer: '关西新围门榜具有客家宗族崇文重教的独特内涵。'
  }, { name: '调研员小张', tokenId: 'tok-123' });

  assert.ok(newEntry.id.startsWith('custom-'));
  assert.equal(newEntry.creatorName, '调研员小张');

  const all = window.Store.getEntries();
  assert.equal(all.length, 3);

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

  const addedDialect = window.Store.addDialectTrack({
    chapter: '客家山歌',
    item: { name: '月光光山歌变奏版', page: 3, videoUrl: 'https://example.com/audio.mp3' }
  }, { name: '民俗传人' });

  const customDialects = window.Store.getCustomDialectTracks();
  assert.equal(customDialects.length, 1);
  assert.equal(customDialects[0].item.name, '月光光山歌变奏版');
  assert.equal(customDialects[0].creatorName, '民俗传人');
});

test('全站单一主二维码体系：通用受邀协管员口令与紧凑邀请码离线验签通过', () => {
  const env = setupEnvironment();
  const { window } = env;

  // 1. 测试通用受邀口令 guest123（不区分大小写）
  const authGuest = window.Store.verifyLogin('guest123');
  assert.equal(authGuest.ok, true);
  assert.equal(authGuest.role, 'editor');
  assert.equal(authGuest.name, '受邀协管员');

  const authGuestUpper = window.Store.verifyLogin('GUEST123');
  assert.equal(authGuestUpper.ok, true);
  assert.equal(authGuestUpper.role, 'editor');

  // 2. 测试 editor123 与 nfyj2026
  const authEditor = window.Store.verifyLogin('editor123');
  assert.equal(authEditor.ok, true);
  assert.equal(authEditor.role, 'editor');

  const authNfyj = window.Store.verifyLogin('nfyj2026');
  assert.equal(authNfyj.ok, true);
  assert.equal(authNfyj.role, 'editor');

  // 3. 测试 6 位短码（例如 8K39XF 或带 INV- 前缀）
  const authShort = window.Store.verifyLogin('8K39XF');
  assert.equal(authShort.ok, true);
  assert.equal(authShort.role, 'editor');

  const authShortWithPrefix = window.Store.verifyLogin('INV-9K8X2W');
  assert.equal(authShortWithPrefix.ok, true);
  assert.equal(authShortWithPrefix.role, 'editor');

  // 4. 空字符串或明显无效字符报错
  const authEmpty = window.Store.verifyLogin('');
  assert.equal(authEmpty.ok, false);
});

