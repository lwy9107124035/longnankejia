(function (root) {
  'use strict';
  var fields = {
    kbCustom: [], kbEdited: {}, kbDeleted: [], kepuCustom: [], kepuEdited: {}, kepuDeleted: [],
    dialectCustom: [], dialectDeleted: [], apiConfig: {}, workflowConfig: {}
  };
  var reserved = {"kb":["about-project","longnan-feiyi-overview","hakka-food-overview","landye","v2-zhidai","v2-zhubian","v2-nantong-blue-print","v2-dali-bai-tie-dye","pattern-overview","zhubian","zhidai","weiwu","shange","tongyao","fangyan","api-basics","experience","guangzhou-project","qr-guide","weixin-gzh","diancang","jingshen","platform","dc-shoudan","dc-daqi","dc-xiqu","dc-luodihuagu","dc-huangjiangdoufu","dc-xianshuidong","dc-sanjidi","dc-yizhuocai","dc-lingmao","dc-zisundai","dc-wushiwei","dc-huxingwei","dc-caichaxi","dc-lianhuadiao","dc-muou","dc-niangdoufu","dc-leicha","dc-meicaikouro","dc-sijingwangyue","dc-huangyuanmiguo","dc-huadai","dc-bandenglong","dc-shaowata","dc-longzhou","dc-shikehui","dc-huomao","dc-huolong","dc-zougushi","dc-jiushibaixiang","jiangyi-weiwu-overview","jiangyi-weiwu-defense","jiangyi-weiwu-windows","jiangyi-weiwu-red","jiangyi-costume-dialect","jiangyi-liangmao-dialect","jiangyi-clothing-colors","jiangyi-dialect-wu","jiangyi-dialect-ancient-words","jiangyi-toponym-culture","jiangyi-liyuanwei-grains","longnan-wenbao-count","weave-tools","weave-process","weave-patterns","weave-people","bamboo-material","bamboo-tools","bamboo-process","bamboo-inheritance","indigo-process","indigo-status","winter-cloth","photo-dajinshan","photo-bowei","photo-zisundai","pattern-clothing","pattern-nature","pattern-cultivation","pattern-door","pattern-safety","pattern-family","pattern-practice"],"kepu":["landye","zhubian","zhidai","lacquer","weiwu","guanxi","opera","festival","lifecustom","dialect","dragonboat","hakkaconvention","food","huangyuan","zhenzhu"]};
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\/\\\u0000-\u0020\u007f]/.test(value) && !/^(?:__proto__|prototype|constructor)$/.test(value); }
  function safeUrl(value, image) {
    if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return false;
    if (!value) return true;
    if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value)) return true;
    if (/^https?:\/\//i.test(value)) return true;
    return /^(?:\.?\.?\/|\/|assets\/)/.test(value) && !/^\/\//.test(value) && !value.includes('\\');
  }
  function fail(path) { throw new Error('内容格式不正确：' + path); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function tree(value, path, depth) {
    if (depth > 8) fail(path + ' 层级过深');
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!object(value) && !Array.isArray(value)) fail(path);
    Object.keys(value).forEach(function (key) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(path + '.' + key);
      tree(value[key], path + '.' + key, depth + 1);
    });
  }
  function record(value, type, path, partial) {
    if (!object(value) || !id(value.id)) fail(path + '.id');
    var name = type === 'kb' ? 'title' : 'name';
    if (!partial && type !== 'dialect' && (typeof value[name] !== 'string' || !value[name].trim())) fail(path + '.' + name);
    if (type === 'dialect' && (!object(value.item) || typeof value.item.name !== 'string' || !value.item.name.trim())) fail(path + '.item.name');
    Object.keys(value).forEach(function (key) {
      var v = value[key];
      if (['keywords', 'topics', 'aliases', 'relatedTopics'].includes(key)) {
        if (!Array.isArray(v) || v.length > 200 || v.some(function (s) { return typeof s !== 'string' || s.length > 500; })) fail(path + '.' + key);
      } else if (key === 'sources') {
        if (!Array.isArray(v) || v.length > 100) fail(path + '.sources');
        v.forEach(function (s) { if (!object(s) || typeof s.title !== 'string' || (s.url !== undefined && !safeUrl(s.url, false))) fail(path + '.sources'); });
      } else if (key === 'item') {
        if (!object(v) || typeof v.name !== 'string') fail(path + '.item');
        Object.keys(v).forEach(function (k) {
          if (['videoUrl', 'audioUrl', 'imageUrl'].includes(k)) { if (!safeUrl(v[k], k === 'imageUrl')) fail(path + '.item.' + k); }
          else if (k === 'page' || k === 'sheet') { if (!Number.isFinite(v[k])) fail(path + '.item.' + k); }
          else if (typeof v[k] !== 'string') fail(path + '.item.' + k);
        });
      } else if (['createdAt', 'updatedAt', 'page', 'sheet'].includes(key)) {
        if (!Number.isFinite(v)) fail(path + '.' + key);
      } else if (['isCustom'].includes(key)) {
        if (typeof v !== 'boolean') fail(path + '.' + key);
      } else if (['accent', 'bg'].includes(key)) {
        if (typeof v !== 'string' || (v && !/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,% ]+\)|hsla?\([\d.,% ]+\)|[a-z]+)$/i.test(v))) fail(path + '.' + key);
      } else {
        var limit = ['detail', 'answer'].includes(key) ? 1000000 : ['image', 'imageUrl'].includes(key) ? 5000000 : 4000;
        if (typeof v !== 'string' || v.length > limit) fail(path + '.' + key);
        if (['image', 'imageUrl', 'video', 'videoUrl', 'audioUrl', 'url'].includes(key) && !safeUrl(v, key === 'image' || key === 'imageUrl')) fail(path + '.' + key);
      }
    });
    tree(value, path, 0);
    return value;
  }
  function validateBundle(input) {
    var result = {};
    Object.keys(fields).forEach(function (key) {
      var value = input[key];
      if (Array.isArray(fields[key]) ? !Array.isArray(value) : !object(value)) fail(key);
      result[key] = value;
    });
    ['kb', 'kepu', 'dialect'].forEach(function (type) {
      var custom = result[type + 'Custom'], seen = new Set();
      if (custom.length > 10000) fail(type + 'Custom 数量过多');
      custom.forEach(function (v, i) {
        record(v, type, type + 'Custom[' + i + ']', false);
        if (seen.has(v.id) || (reserved[type] || []).includes(v.id)) fail(type + 'Custom 重复或内置 ID：' + v.id);
        seen.add(v.id);
      });
      var deleted = result[type + 'Deleted'];
      if (deleted.some(function (v) { return !id(v); }) || new Set(deleted).size !== deleted.length) fail(type + 'Deleted');
      if (type !== 'dialect') Object.keys(result[type + 'Edited']).forEach(function (key) {
        var v = result[type + 'Edited'][key];
        record(v, type, type + 'Edited.' + key, true);
        if (key !== v.id || seen.has(key) || deleted.includes(key)) fail(type + 'Edited.' + key);
      });
    });
    tree(result.apiConfig, 'apiConfig', 0); tree(result.workflowConfig, 'workflowConfig', 0);
    if (Object.keys(result.apiConfig).some(function (k) { return !['mode', 'model', 'temperature', 'maxTokens'].includes(k); })) fail('apiConfig');
    if (result.apiConfig.model !== undefined && typeof result.apiConfig.model !== 'string') fail('apiConfig.model');
    if (result.apiConfig.mode !== undefined && typeof result.apiConfig.mode !== 'string') fail('apiConfig.mode');
    ['temperature', 'maxTokens'].forEach(function (k) { if (result.apiConfig[k] !== undefined && !Number.isFinite(result.apiConfig[k])) fail('apiConfig.' + k); });
    Object.keys(result.workflowConfig).forEach(function (k) {
      var v = result.workflowConfig[k];
      if (k === 'systemPrompt' ? typeof v !== 'string' || v.length > 20000 : k === 'minScore' ? !Number.isFinite(v) : !['strictMode', 'enableThinking'].includes(k) || typeof v !== 'boolean') fail('workflowConfig.' + k);
    });
    return result;
  }
  function rawComparable(value) {
    if (object(value)) {
      value = Object.assign({}, value);
      ['creatorName', 'creatorTokenId', 'createdAt'].forEach(function (key) { delete value[key]; });
    }
    return canonical(value === undefined ? null : value);
  }
  function comparable(value) { return rawComparable(value && typeof value === 'object' && mediaForms.get(value) || value); }
  function contentCells(content) {
    var result = new Map();
    Object.keys(fields).forEach(function (field) {
      var value = content && content[field];
      if (field.endsWith('Custom')) (value || []).forEach(function (entry) { if (entry && entry.id) result.set(field + '/' + entry.id, entry); });
      else if (field.endsWith('Deleted')) (value || []).forEach(function (id) { result.set(field + '/' + id, true); });
      else if (field.endsWith('Edited')) Object.keys(value || {}).forEach(function (id) { result.set(field + '/' + id, value[id]); });
      else result.set(field, value || {});
    });
    return result;
  }
  function setContentCell(content, key, value) {
    var slash = key.indexOf('/'), field = slash < 0 ? key : key.slice(0, slash), entryId = key.slice(slash + 1);
    if (!Object.prototype.hasOwnProperty.call(fields, field) || (slash < 0 ? !['apiConfig', 'workflowConfig'].includes(field) : !id(entryId))) fail('保存条目');
    if (field.endsWith('Custom')) {
      content[field] = (content[field] || []).filter(function (entry) { return entry.id !== entryId; });
      if (value !== null) { if (!object(value) || value.id !== entryId) fail(key); content[field].push(value); }
    } else if (field.endsWith('Deleted')) {
      if (value !== null && value !== true) fail(key);
      content[field] = (content[field] || []).filter(function (id) { return id !== entryId; });
      if (value !== null) content[field].push(entryId);
    } else if (field.endsWith('Edited')) {
      if (value === null) delete content[field][entryId];
      else { if (!object(value) || value.id !== entryId) fail(key); content[field][entryId] = value; }
    } else { if (slash >= 0 || !object(value)) fail(key); content[field] = value; }
  }
  async function cellHash(value, raw) {
    if (!raw) await prepareMediaRecord(value);
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw ? rawComparable(value) : comparable(value)));
    return Array.from(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  var mediaForms = new WeakMap();
  function mediaPath(value) {
    if (typeof value !== 'string') return '';
    var match = /^(?:https:\/\/(?:[a-z0-9-]+\.)?longnankejia(?:-dev)?\.pages\.dev)?(\/api\/media\/[a-f0-9]{64})$/.exec(value);
    return match ? match[1] : '';
  }
  async function mediaIdentity(data) {
    if (mediaPath(data)) return mediaPath(data);
    var match = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z0-9+/=]+)$/i.exec(data || '');
    if (!match) return data;
    var canonicalData = 'data:' + match[1].toLowerCase() + ';base64,' + match[2];
    var bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalData));
    return '/api/media/' + Array.from(new Uint8Array(bytes), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function prepareMediaRecord(value) {
    if (!object(value) || mediaForms.has(value)) return;
    if (!['image', 'imageUrl'].some(function (key) { return typeof value[key] === 'string'; }) && !(object(value.item) && typeof value.item.imageUrl === 'string')) return;
    var result = Object.assign({}, value);
    for (var key of ['image', 'imageUrl']) if (typeof value[key] === 'string') result[key] = await mediaIdentity(value[key]);
    if (object(value.item) && typeof value.item.imageUrl === 'string') result.item = Object.assign({}, value.item, { imageUrl: await mediaIdentity(value.item.imageUrl) });
    mediaForms.set(value, result);
  }
  async function prepareMediaBundle(value) {
    var cells = contentCells(value);
    for (var entry of cells.values()) await prepareMediaRecord(entry);
  }
  root.HeritageContent = { defaults: fields, validateBundle: validateBundle, record: record, safeUrl: safeUrl, reserved: reserved, canonical: canonical,
    comparable: comparable, rawComparable: rawComparable, contentCells: contentCells, setContentCell: setContentCell, cellHash: cellHash,
    mediaIdentity: mediaIdentity, mediaPath: mediaPath, prepareMediaRecord: prepareMediaRecord, prepareMediaBundle: prepareMediaBundle };
})(globalThis);
