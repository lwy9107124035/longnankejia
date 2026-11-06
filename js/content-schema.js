(function (root) {
  'use strict';
  var fields = {
    kbCustom: [], kbEdited: {}, kbDeleted: [], kepuCustom: [], kepuEdited: {}, kepuDeleted: [],
    dialectCustom: [], dialectDeleted: [], apiConfig: {}, workflowConfig: {}
  };
  var reserved = {"kb":["about-project","longnan-feiyi-overview","hakka-food-overview","landye","v2-zhidai","v2-zhubian","v2-nantong-blue-print","v2-dali-bai-tie-dye","pattern-overview","zhubian","zhidai","weiwu","shange","tongyao","fangyan","api-basics","experience","guangzhou-project","qr-guide","weixin-gzh","diancang","jingshen","platform","dc-shoudan","dc-daqi","dc-xiqu","dc-luodihuagu","dc-huangjiangdoufu","dc-xianshuidong","dc-sanjidi","dc-yizhuocai","dc-lingmao","dc-zisundai","dc-wushiwei","dc-huxingwei","dc-caichaxi","dc-lianhuadiao","dc-muou","dc-niangdoufu","dc-leicha","dc-meicaikouro","dc-sijingwangyue","dc-huangyuanmiguo","dc-huadai","dc-bandenglong","dc-shaowata","dc-longzhou","dc-shikehui","dc-huomao","dc-huolong","dc-zougushi","dc-jiushibaixiang","jiangyi-weiwu-overview","jiangyi-weiwu-defense","jiangyi-weiwu-windows","jiangyi-weiwu-red","jiangyi-costume-dialect","jiangyi-liangmao-dialect","jiangyi-clothing-colors","jiangyi-dialect-wu","jiangyi-dialect-ancient-words","jiangyi-toponym-culture","jiangyi-liyuanwei-grains","longnan-wenbao-count","weave-tools","weave-process","weave-patterns","weave-people","bamboo-material","bamboo-tools","bamboo-process","bamboo-inheritance","indigo-process","indigo-status","winter-cloth","photo-dajinshan","photo-bowei","photo-zisundai","pattern-clothing","pattern-nature","pattern-cultivation","pattern-door","pattern-safety","pattern-family","pattern-practice","kb-science-kepu-1792595039383","kb-science-kepu-1792983639237-6896cvd1","kb-science-kepu-1792983692085-7pi7x6on","kb-science-kepu-1792566427178","kb-science-kepu-1792657946208","kb-science-kepu-1792978704814-khh1pxgk","kb-science-kepu-1792980629129-vzkbldty","kb-science-kepu-1792981653000-0ar4e01s","kb-science-kepu-1792981850750-ne8t2gax","kb-science-kepu-1792982035537-64ecylqn","kb-science-kepu-1792982145128-d60q5trb","kb-science-kepu-1792982245933-aa0nczrl","kb-science-kepu-1792982361318-ye0nqdv6","kb-science-kepu-1792982463984-8obyoly7","kb-science-kepu-1792982568217-vyihazpa","kb-science-kepu-1792982674477-80vp1ebv","kb-science-kepu-1792983717706-wexz8dl2","kb-science-kepu-1792985273505-vttuqmd8","kb-science-kepu-1792985468632-e3kxrzro","kb-science-kepu-1792985626961-8n76t5mv","kb-science-kepu-1792985743741-hn1cwuuk","kb-science-kepu-1792985844447-dyl8fqb1","kb-science-kepu-1792985945608-wdih4wf5","kb-science-kepu-1792986075218-wga14dan","kb-science-kepu-1792986839066-1du36778","kb-science-kepu-1792987020409-8hpc2rbj","kb-science-kepu-1792998938976-nhz13t77","kb-science-kepu-1792999255737-bz44p8ra","kb-science-kepu-1792999487086-23ux8bis","kb-science-kepu-1793000770835-rydv2uoo","kb-science-kepu-1793001098176-2bi25552","kb-science-kepu-1793001223856-j7u3jzyp","kb-science-kepu-1793001816433-x4zkep0m","kb-science-kepu-1793001992867-3p9vkxix","kb-science-kepu-1793002113552-41z1vxmw","kb-science-kepu-1793002216646-uy8rfi2j","kb-science-kepu-1793003368337-f3lp5hb8","kb-science-kepu-1793345557171-ykcpplwz","kb-science-kepu-1793004273904-g1mfp2ln","kb-science-kepu-1792571195819","kb-science-kepu-1792571526401","kb-science-kepu-1792572862963","kb-science-kepu-1793084604487-km3jbgk2","kb-science-kepu-1793084813577-8duwp5g6","kb-science-kepu-1793084932601-f89yojvk","kb-science-kepu-1792573761427","kb-science-kepu-1793085067856-kmrroded","kb-science-kepu-1793085165073-8i42311h","kb-science-kepu-1792573881386","kb-science-kepu-1792593233375","kb-science-kepu-1792593555112","kb-science-kepu-1792593782416","kb-science-kepu-1792594025336","kb-science-kepu-1792594175868","kb-science-kepu-1792594795065","kb-science-kepu-1792678969795","kb-science-kepu-1792978026401-76fpb8qy","kb-science-kepu-1792978075328-fmbtjgu5","kb-science-kepu-1792978151368-i5ihw8ta","kb-science-kepu-1793091635312-kc3v2zua","kb-science-kepu-1793092355032-lzkcxuyv","kb-science-kepu-1793092590999-119pwu99","kb-science-kepu-1793092689703-cjwxgjcu","kb-science-kepu-1793092799679-zjcx09px","kb-science-kepu-1793092904649-ojmw4m9m","kb-science-kepu-1792978212048-2a3h2c0a","kb-science-kepu-1792978488191-3fofkmz9","kb-science-kepu-1793149607830-s5fvd7o2","kb-science-kepu-1793092488150-v0fby9fm","kb-science-kepu-1792978098532-ijdxf8dq","kb-science-kepu-1792978577718-sajy0gcx","kb-science-kepu-1793150528372-38fgi8f1","kb-science-kepu-1792978998480-ro0bng0f","kb-science-kepu-1792979260707-h3um926l","kb-science-kepu-1793321667447-beo0rj9r","kb-science-kepu-1792980485271-1udulb5v","kb-science-kepu-1792980744384-zz3wpks9","kb-science-kepu-1793150912009-on58r6w3","kb-science-kepu-1792980302736-2c5mcl3t","kb-science-kepu-1793321899476-ro7cr6ph","kb-science-kepu-1793322017639-0t9yaeqq","kb-science-kepu-1792980848095-ooqqqpph","kb-science-kepu-1793322082859-2skcmkgj","kb-science-kepu-1792980903911-dld2zr05","kb-science-kepu-1792980792655-1h8vd2nu","kb-science-kepu-1792981106264-xkyle8yl","kb-science-kepu-1792981243536-fp13l12l","kb-science-kepu-1792981794594-dusvxpak","kb-science-kepu-1793322350437-lvjwvfff","kb-science-kepu-1793322411640-t1np7uww","kb-science-kepu-1792980548631-ctuvyd24","kb-science-kepu-1793322681243-ydbowlsn","kb-science-kepu-1793322840619-rckt31da","kb-science-kepu-1792981036592-3h97bhai","kb-science-kepu-1792982096474-7k5t74lk","kb-science-kepu-1792982158290-l26wyb3v","kb-science-kepu-1792983570934-t34wm18b","kb-science-kepu-1792983770316-2lacd281","kb-science-kepu-1793323553951-0egzy8ez","kb-science-kepu-1793323623143-sqf35ekp","kb-science-kepu-1793323763406-pm1ftbij","kb-science-kepu-1793323827432-yyjpvofv","kb-science-kepu-1793323833174-1qmaa6rt","kb-science-kepu-1793323891790-njwlltgy","kb-science-kepu-1793323897141-0pf84f56","kb-science-kepu-1793323960862-g9zzh054","kb-science-kepu-1793323992216-fvmjlfkn","kb-science-kepu-1793324079190-a50qefmj","kb-science-kepu-1793324112210-7w1e4adu","kb-science-kepu-1793324194821-iiti9dj9","kb-science-kepu-1793324275974-z79amm5x","kb-science-kepu-1793324278345-23umztbe","kb-science-kepu-1793324403733-9ixiwrcx","kb-science-kepu-1793324490069-egrfhqul","kb-science-kepu-1793324545180-8dnvlp98","kb-science-kepu-1793324964147-147l3lbv","kb-science-kepu-1793325164275-aq7kpppv","kb-science-kepu-1793325710519-p665vnhn","kb-science-kepu-1793327018974-f47swoqu","kb-science-kepu-1793327095302-jmn7jtn1","kb-science-kepu-1793327136709-c76nsgad","kb-science-kepu-1793327172053-n4xuh9bw","kb-science-kepu-1793327258085-xtdujzie","kb-science-kepu-1793327968297-tf4p5hjd","kb-science-kepu-1793328091645-ev4op82f","kb-science-kepu-1793328363427-jxl4d5f5","kb-science-kepu-1793328833318-c1rj11n5","kb-science-kepu-1792981690866-8iyqzx7s","kb-science-kepu-1793328931109-u9by0fk4","kb-science-kepu-1793329131590-jds1625v","kb-science-kepu-1793329121547-7v03eh8u","kb-science-kepu-1793329259187-0flq522t","kb-science-kepu-1793329345719-lyl8z1sz","kb-science-kepu-1792979424164-v7m8sant","kb-science-kepu-1792574265426","kb-science-kepu-1793329390243-6iz863vh","kb-science-kepu-1792594328057","kb-science-kepu-1792594478834","kb-science-kepu-1792594651643","kb-science-kepu-1793329495991-r0y2jvwf","kb-science-kepu-1793329553667-j1cqx6vd","kb-science-kepu-1792573153979","kb-science-kepu-1792979817479-ti473sr4","kb-science-kepu-1793329575796-hns4b6m1","kb-science-kepu-1793325721410-xrr3rir2","kb-science-kepu-1793329659944-lislxcwt","kb-science-kepu-1793329730215-9brhoxm6","kb-science-kepu-1793329731999-wx9ljtl5","kb-science-kepu-1793329798755-zfdnp9xo","kb-science-kepu-1793326264464-n3w128cb","kb-science-kepu-1793325128459-q1lu8poa","kb-science-kepu-1793325265124-74etotyr","kb-science-kepu-1793325360370-m5prrcdy","kb-science-kepu-1793330092895-qbr4zuu8","kb-science-kepu-1792979500764-1ji955yc","kb-science-kepu-1793326562327-xv8szndv","kb-science-kepu-1793326628935-83ls6nia","kb-science-kepu-1793330227212-21sjzidu","kb-science-kepu-1792979886903-s7arghhg","kb-science-kepu-1793085284699-1r1uhbfw","kb-science-kepu-1793326913599-pq7u1uaw","kb-science-kepu-1792979333931-9tybsybr","kb-science-kepu-1793330401475-ev2fpy9g","kb-science-kepu-1793326954542-c18kcj1r","kb-science-kepu-1793327215526-0dcfry5k","kb-science-kepu-1793330495046-l3hbujsu","kb-science-kepu-1792979977263-q8601ku8","kb-science-kepu-1792980105223-zihjt86d","kb-science-kepu-1792980158447-go3smqe1","kb-science-kepu-1792980216287-hl2t2c73","kb-science-kepu-1793330630821-tn2rjvqo","kb-science-kepu-1793330808724-2cetbkim","kb-science-kepu-1793330929957-71ythb63","kb-science-kepu-1793331053242-9ld08vgb","kb-science-kepu-1793331164990-pn62rwba","kb-science-kepu-1793331286100-v1l2fquh"],"kepu":["landye","zhubian","zhidai","lacquer","weiwu","guanxi","opera","festival","lifecustom","dialect","dragonboat","hakkaconvention","food","huangyuan","zhenzhu"]};
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
  function isAudioTrack(track) {
    if (!track) return false;
    if (track.mediaType === 'audio' || (track.item && (track.item.mediaType === 'audio' || track.item.audioUrl))) return true;
    return /\.(mp3|wav|ogg|aac|m4a)(\?.*)?$/i.test(track.item && (track.item.videoUrl || track.item.audioUrl) || '');
  }
  root.HeritageContent = { defaults: fields, validateBundle: validateBundle, record: record, safeUrl: safeUrl, reserved: reserved, canonical: canonical,
    comparable: comparable, rawComparable: rawComparable, contentCells: contentCells, setContentCell: setContentCell, cellHash: cellHash,
    mediaIdentity: mediaIdentity, mediaPath: mediaPath, prepareMediaRecord: prepareMediaRecord, prepareMediaBundle: prepareMediaBundle, isAudioTrack: isAudioTrack };
})(globalThis);
