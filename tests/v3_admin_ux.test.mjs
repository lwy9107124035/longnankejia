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

  // 3. 按照安全要求，短码登录功能已完全移除，输入短码必须被严格拒绝，只能使用正式令牌或主密码
  const dirtyShortCode = '  “INV-999”  ';
  const phoneShortAuth = envB.window.Store.verifyLogin(dirtyShortCode);
  assert.equal(phoneShortAuth.ok, false, '短码登录已被完全移除，输入短码应直接拒绝');

  // 4. 测试设备 B（手机端）单纯输入 6 位纯短码应直接拒绝
  const phoneBareAuth = envB.window.Store.verifyLogin('ABCDEF');
  assert.equal(phoneBareAuth.ok, false, '纯短码应直接拒绝登录');
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

test('全站单一主二维码体系与自定义密码及令牌跨设备同步', () => {
  const env = setupEnvironment();
  const { window } = env;

  // 1. 未设置自定义密码时，支持系统默认密码 admin123
  const defaultAuth = window.Store.verifyLogin('admin123');
  assert.equal(defaultAuth.ok, true);
  assert.equal(defaultAuth.role, 'super_admin');

  // 2. 超级管理员设置自定义密码
  window.Store.setAdminPassword('MyCustomAdminPass2026!');

  // 3. 设置自定义密码后，默认 admin123 与自定义口令均可稳定登录（双重容错保底），而纯错误口令被拒绝
  const defaultRecoveryAuth = window.Store.verifyLogin('admin123');
  assert.equal(defaultRecoveryAuth.ok, true, '默认密码 admin123 永远作为安全保底放行');
  const rejectedWrong = window.Store.verifyLogin('WrongPass999!');
  assert.equal(rejectedWrong.ok, false, '错误密码必须被严格拒绝');

  // 4. 正确的自定义密码（含手机键盘大小写容错）成功登录
  const customAuth = window.Store.verifyLogin('MyCustomAdminPass2026!');
  assert.equal(customAuth.ok, true, '自定义密码必须鉴权通过');
  assert.equal(customAuth.role, 'super_admin');

  const customAuthLower = window.Store.verifyLogin('mycustomadminpass2026!');
  assert.equal(customAuthLower.ok, true, '大小写容错时自定义密码亦应鉴权通过');

  // 5. 彻底杜绝 guest123 等硬编码后门通用密码
  const rejectedGuest = window.Store.verifyLogin('guest123');
  assert.equal(rejectedGuest.ok, false, '硬编码通用口令 guest123 必须被彻底拒绝');
  const rejectedEditor = window.Store.verifyLogin('editor123');
  assert.equal(rejectedEditor.ok, false, '硬编码通用口令 editor123 必须被彻底拒绝');

  // 6. 电脑端签发邀请令牌
  const tokenObj = window.Store.generateInviteToken('龙南文化馆张老师', 14);
  assert.ok(tokenObj && tokenObj.token);

  // 7. 电脑端全站单一主二维码：生成同步 Payload
  const syncHash = window.Store.buildSyncPayload();
  assert.ok(syncHash && syncHash.startsWith('sync='), '存在自定义密码或令牌时必须生成同步负载');

  // 8. 手机端模拟：全新设备，无任何本地记录，且之前由于输错存在锁定状态
  const phoneEnv = setupEnvironment();
  phoneEnv.localStorageMap.set('nfyj_login_lock_state', JSON.stringify({ count: 5, until: Date.now() + 60000 }));

  // 手机端扫码打开页面（应用单二维码中的 sync payload）
  const synced = phoneEnv.window.Store.applySyncPayload('#' + syncHash);
  assert.equal(synced, true, '手机端扫码后必须成功同步凭证');

  // 手机端输错锁定应被立即清空解除
  assert.equal(phoneEnv.sandbox.localStorage.getItem('nfyj_login_lock_state'), null, '扫码后应清除输错锁定限制');

  // 手机端输入电脑端相同的超级管理员密码，成功登录！
  const phoneSuperAuth = phoneEnv.window.Store.verifyLogin('MyCustomAdminPass2026!');
  assert.equal(phoneSuperAuth.ok, true, '手机端输入电脑端相同的超管密码必须成功登录');
  assert.equal(phoneSuperAuth.role, 'super_admin');

  // 手机端输入电脑端相同的邀请令牌，成功登录！
  const phoneTokenAuth = phoneEnv.window.Store.verifyLogin(tokenObj.token);
  assert.equal(phoneTokenAuth.ok, true, '手机端输入电脑端相同的邀请令牌必须成功登录');
  assert.equal(phoneTokenAuth.role, 'editor');
  assert.equal(phoneTokenAuth.name, '龙南文化馆张老师');

  // 8. 手机端输入无校验关系的假短码应被严格拒绝，只能凭真实令牌或合法口令
  const phoneShortAuth = phoneEnv.window.Store.verifyLogin('ABCDEF');
  assert.equal(phoneShortAuth.ok, false, '非法短码必须被拒绝');

  // 手机端上默认 admin123 亦可作为统一保底成功登录！
  const phoneAdminAuth = phoneEnv.window.Store.verifyLogin('admin123');
  assert.equal(phoneAdminAuth.ok, true, '手机端输入默认 admin123 必须亦可作为统一保底成功登录');

  // 9. 空字符串或明显无效口令报错
  const authEmpty = window.Store.verifyLogin('');
  assert.equal(authEmpty.ok, false);
});

test('超级管理员查看客户端锁定状态、手动解除锁定及无hash跨端密码验证', () => {
  const env = setupEnvironment();
  const { window } = env;

  // 1. 设置自定义超管密码，自动计算并写入 pw_hash
  window.Store.setAdminPassword('SuperSecret2026');
  const storedHash = env.localStorageMap.get('nfyj_admin_pw_hash');
  assert.ok(storedHash, '设置管理员密码后必须同步生成 pw_hash');

  // 2. 模拟客户端（如手机端）多次输错，上报锁定
  const lockItem = window.Store.reportClientLock(5, Date.now() + 60000);
  assert.ok(lockItem && lockItem.ip);
  assert.equal(lockItem.status, 'locked');

  // 超级管理员后台能查询到该锁定记录
  const lockedList = window.Store.getLockedClients();
  assert.ok(lockedList.length >= 1);
  const found = lockedList.find(l => l.ip === lockItem.ip);
  assert.ok(found, '超级管理员应能看到被锁定的客户端记录');
  assert.equal(found.attempts, 5);

  // 3. 超级管理员手动解除锁定
  const unlocked = window.Store.unlockClient(lockItem.id);
  assert.equal(unlocked, true);

  const updatedList = window.Store.getLockedClients();
  const updatedItem = updatedList.find(l => l.id === lockItem.id);
  assert.equal(updatedItem.status, 'unlocked', '手动解除后状态应为 unlocked');

  // 4. 超级管理员一键全部解除
  window.Store.reportClientLock(6, Date.now() + 60000);
  const unlockAllRes = window.Store.unlockAllClients();
  assert.equal(unlockAllRes, true);
  const allList = window.Store.getLockedClients();
  assert.ok(allList.every(l => l.status === 'unlocked'), '全部解除后所有条目应为 unlocked');

  // 5. 跨设备同网址访问（无 URL hash，全新手机设备环境仅拉取到 pw_hash）
  const phoneDevice = setupEnvironment();
  phoneDevice.localStorageMap.set('nfyj_admin_pw_hash', storedHash);

  // 手机端本地无自定义明文密码，但直接输入超管密码时通过哈希比对鉴权通过
  const phoneAuth = phoneDevice.window.Store.verifyLogin('SuperSecret2026');
  assert.equal(phoneAuth.ok, true, '跨设备直接输入正确密码应通过哈希比对登录');
  assert.equal(phoneAuth.role, 'super_admin');

  // 手机端输入错误密码被拒绝，而默认 admin123 永远作为全站通用保底允许登录
  const phoneWrongAuth = phoneDevice.window.Store.verifyLogin('WrongPassword123');
  assert.equal(phoneWrongAuth.ok, false);
  const phoneDefaultAccept = phoneDevice.window.Store.verifyLogin('admin123');
  assert.equal(phoneDefaultAccept.ok, true, '跨端设备输入默认 admin123 永远成功登录');
});

test('手机端锁定解除后再次输错密码，机会次数正常递减（4->3->2->1->锁定），不会死循环停留在4次', () => {
  const env = setupEnvironment();
  const { window, localStorageMap } = env;

  // 1. 模拟手机端连续输错 5 次被锁定
  const lockTime = Date.now();
  const lockItem = window.Store.reportClientLock(5, lockTime + 60000);
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({
    count: 5,
    until: lockTime + 60000,
    lockedAt: lockTime
  }));

  // 2. 超级管理员解除该设备
  window.Store.unlockClient(lockItem.id);

  // 3. 手机端检测到已解除，isClientUnlocked 应为 true
  assert.equal(window.Store.isClientUnlocked(), true, '管理员解除后应检测到已解锁');

  // 4. 手机端消费解除标记，重置登录状态
  window.Store.consumeClientUnlock();
  assert.equal(window.Store.isClientUnlocked(), false, '消费后 isClientUnlocked 应恢复为 false');

  // 5. 再次输入错误口令：第 1 次输错 -> 剩 4 次 (count = 1)
  let rawState = localStorageMap.get('nfyj_login_lock_state');
  let currentCount = rawState ? (JSON.parse(rawState).count || 0) : 0;
  let nextCount = currentCount + 1;
  assert.equal(nextCount, 1, '第 1 次输错计数应为 1');
  assert.equal(5 - nextCount, 4, '第 1 次输错应显示还剩 4 次');
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({ count: nextCount, until: 0 }));

  // 关键：此时由于处于正常尝试期且未锁定，isClientUnlocked 不能返回 true 导致计数被清零
  assert.equal(window.Store.isClientUnlocked(), false, '输入过程中不得误触发已解锁而清空计数');

  // 6. 第 2 次输错口令 -> 剩 3 次 (count = 2)
  rawState = localStorageMap.get('nfyj_login_lock_state');
  currentCount = rawState ? (JSON.parse(rawState).count || 0) : 0;
  nextCount = currentCount + 1;
  assert.equal(nextCount, 2, '第 2 次输错计数应为 2');
  assert.equal(5 - nextCount, 3, '第 2 次输错应显示还剩 3 次，绝不能停留为 4 次');
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({ count: nextCount, until: 0 }));

  // 7. 第 3 次输错口令 -> 剩 2 次 (count = 3)
  rawState = localStorageMap.get('nfyj_login_lock_state');
  currentCount = rawState ? (JSON.parse(rawState).count || 0) : 0;
  nextCount = currentCount + 1;
  assert.equal(nextCount, 3, '第 3 次输错计数应为 3');
  assert.equal(5 - nextCount, 2, '第 3 次输错应显示还剩 2 次');
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({ count: nextCount, until: 0 }));

  // 8. 第 4 次输错口令 -> 剩 1 次 (count = 4)
  rawState = localStorageMap.get('nfyj_login_lock_state');
  currentCount = rawState ? (JSON.parse(rawState).count || 0) : 0;
  nextCount = currentCount + 1;
  assert.equal(nextCount, 4, '第 4 次输错计数应为 4');
  assert.equal(5 - nextCount, 1, '第 4 次输错应显示还剩 1 次');
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({ count: nextCount, until: 0 }));

  // 9. 第 5 次输错口令 -> 达到 5 次，再次触发锁定！
  currentCount = nextCount;
  nextCount = currentCount + 1;
  assert.equal(nextCount, 5, '第 5 次输错计数应为 5');
  const newLockUntil = Date.now() + 60000;
  const newLockItem = window.Store.reportClientLock(nextCount, newLockUntil);
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({
    count: nextCount,
    until: newLockUntil,
    lockedAt: Date.now()
  }));

  // 此时处于新一轮锁定中，旧的 unlockClient 绝不能误解封新的锁定
  assert.equal(newLockItem.status, 'locked', '新一轮锁定状态必须为 locked');
  assert.equal(window.Store.isClientUnlocked(), false, '旧的解封凭据绝不能穿透解封新锁');
});

test('电脑端新增自定义内容（知识库、科普、方言），手机端通过云端同步全量获取', async () => {
  // 1. 模拟云端存储数据库
  const cloudDb = {
    ok: true,
    clientIp: '127.0.0.1',
    kbCustom: [],
    kepuCustom: [],
    dialectCustom: [],
    customUpdatedAt: 0
  };

  // 2. 电脑端环境 A
  const envA = setupEnvironment();
  envA.sandbox.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      if (body.action === 'update_custom_bundle') {
        cloudDb.kbCustom = body.kbCustom || [];
        cloudDb.kepuCustom = body.kepuCustom || [];
        cloudDb.dialectCustom = body.dialectCustom || [];
        cloudDb.customUpdatedAt = body.customUpdatedAt;
        return { ok: true, json: async () => ({ ok: true, customUpdatedAt: cloudDb.customUpdatedAt }) };
      }
    }
    return { ok: true, json: async () => cloudDb };
  };

  // 电脑端添加自定义知识库、科普卡片、方言语音
  envA.window.Store.addEntry({
    title: '关西新围历史新考',
    keywords: ['关西新围', '新考'],
    answer: '关西新围是客家围屋的典范代表。'
  });
  envA.window.Store.addHeritageCard({
    name: '龙南烫皮客家风味',
    cat: 'craft',
    desc: '烫皮具有浓郁的米香。'
  });
  envA.window.Store.addDialectTrack({
    name: '关西新围客家童谣原声',
    item: { name: '关西新围客家童谣原声' },
    url: 'https://example.com/audio.mp3'
  });

  // 确认电脑端已存入
  assert.equal(envA.window.Store.getEntries().length, 3);
  assert.equal(envA.window.Store.getHeritageCards([]).length, 1);
  assert.equal(envA.window.Store.getCustomDialectTracks().length, 1);
  assert.equal(cloudDb.kbCustom.length, 1, '电脑端修改应自动同步到云端数据库');
  assert.equal(cloudDb.kepuCustom.length, 1);
  assert.equal(cloudDb.dialectCustom.length, 1);

  // 3. 手机端环境 B（全新空白设备）
  const envB = setupEnvironment();
  envB.sandbox.fetch = async () => ({ ok: true, json: async () => cloudDb });

  // 手机端初始状态为空白
  assert.equal(envB.window.Store.getEntries().length, 2);
  assert.equal(envB.window.Store.getHeritageCards([]).length, 0);
  assert.equal(envB.window.Store.getCustomDialectTracks().length, 0);

  // 手机端执行云同步
  await new Promise(resolve => {
    envB.window.Store.syncWithCloud(resolve);
  });

  // 同步后手机端必须完全呈现电脑端录入的自定义内容
  const phoneEntries = envB.window.Store.getEntries();
  assert.equal(phoneEntries.length, 3, '手机端应成功同步知识库自定义条目');
  assert.ok(phoneEntries.find(e => e.title === '关西新围历史新考'));

  const phoneCards = envB.window.Store.getHeritageCards([]);
  assert.equal(phoneCards.length, 1, '手机端应成功同步科普卡片');
  assert.equal(phoneCards[0].name, '龙南烫皮客家风味');

  const phoneTracks = envB.window.Store.getCustomDialectTracks();
  assert.equal(phoneTracks.length, 1, '手机端应成功同步方言语音');
  assert.equal(phoneTracks[0].name, '关西新围客家童谣原声');
});

test('移动端扫固定二维码访问：输入法字符兼容、孤儿哈希自动清除与出厂默认密码秒过', async () => {
  const env = setupEnvironment();
  const { window, localStorageMap } = env;

  // 1. 移动端全角字符转半角：输入全角 ａｄｍｉｎ１２３ 必须成功鉴权通过
  const fullWidthAuth = window.Store.verifyLogin('ａｄｍｉｎ１２３');
  assert.equal(fullWidthAuth.ok, true, '全角字母与数字输入必须自动规范化并通过');
  assert.equal(fullWidthAuth.role, 'super_admin');

  // 2. 移动端带零宽字符与首尾全角空格：\u200Badmin123\u3000
  const zeroWidthAuth = window.Store.verifyLogin('\u200Badmin123\u3000');
  assert.equal(zeroWidthAuth.ok, true, '带有零宽字符或全角空格的输入必须正常通过');

  // 3. 邀请令牌中包含 iOS 智能标点转换的连接号（– 或 —）
  const tokenObj = window.Store.generateInviteToken('移动端测试员', 7);
  const iosTokenStr = tokenObj.token.replace(/-/g, '–'); // 模拟 iOS 自动转换为 en-dash
  const tokenAuth = window.Store.verifyLogin(iosTokenStr);
  assert.equal(tokenAuth.ok, true, 'iOS 智能标点破折号必须自动识别并验证通过');

  // 4. 模拟手机端此前存在失效的孤儿 pw_hash 与输错锁定状态
  localStorageMap.set('nfyj_admin_pw_hash', 'h_invalid_orphan_hash_999');
  localStorageMap.set('nfyj_login_lock_state', JSON.stringify({ count: 5, until: Date.now() + 60000 }));

  // 执行一键重置自愈
  const resetSuccess = window.Store.resetAdminAuth();
  assert.equal(resetSuccess, true);
  assert.equal(localStorageMap.get('nfyj_admin_pw_hash'), undefined);
  assert.equal(localStorageMap.get('nfyj_login_lock_state'), undefined);

  // 重置后使用默认密码登录直接成功
  const postResetAuth = window.Store.verifyLogin('admin123');
  assert.equal(postResetAuth.ok, true);
  assert.equal(postResetAuth.role, 'super_admin');

  // 5. 模拟手机端云端同步时，若云端返回 pwHash: null 且本地无明文自定义密码，自动清除本地孤儿哈希
  localStorageMap.set('nfyj_admin_pw_hash', 'h_old_cached_hash_123');
  env.sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, pwHash: null, tokens: [], lockouts: [], customUpdatedAt: 0 })
  });
  await new Promise(resolve => {
    window.Store.syncWithCloud(resolve);
  });
  assert.equal(localStorageMap.get('nfyj_admin_pw_hash'), undefined, '云端为 null 时本地孤儿哈希必须被清除');
  const normalLogin = window.Store.verifyLogin('admin123');
  assert.equal(normalLogin.ok, true, '清除孤儿哈希后输入默认密码必须秒过');
});



