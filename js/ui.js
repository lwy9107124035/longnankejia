/**
 * UI 模块：聊天渲染 / 打字机 / 虚拟形象状态 / 语音 / 访问地址 / 弹层
 */
(function () {
  'use strict';


  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================================================================
     聊天 UI
     ================================================================ */
  var Chat = (function () {
    var windowEl, inputEl, sendBtn;
    var emptyHtml = '' +
      '<div class="chat-empty">' +
      '  <div class="chat-empty-icon">💬</div>' +
      '  <div class="chat-empty-title">问问阿蓝吧</div>' +
      '  <div class="chat-empty-hint">聚焦蓝染、竹编、织带、围屋等馆藏非遗技艺<br>阿蓝如实解答</div>' +
      '</div>';

    var botAvatarImg = '<img class="msg-avatar-img" src="assets/avatar/alan-face.png" alt="阿蓝">';

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    }

    function ensureNotEmpty() {
      if (windowEl.querySelector('.chat-empty')) return;
      if (!windowEl.querySelector('.msg')) {
        windowEl.innerHTML = emptyHtml;
      }
    }

    function scrollToBottom() {
      windowEl.scrollTop = windowEl.scrollHeight;
    }

    function addUser(text) {
      ensureNotEmpty();
      var m = el('div', 'msg msg-user');
      m.appendChild(el('div', 'msg-avatar', '🧑'));
      var bubble = el('div', 'msg-bubble');
      bubble.textContent = text;
      m.appendChild(bubble);
      windowEl.appendChild(m);
      scrollToBottom();
      return bubble;
    }

    function addBotShell() {
      ensureNotEmpty();
      var m = el('div', 'msg msg-bot');
      m.appendChild(el('div', 'msg-avatar', botAvatarImg));
      var bubble = el('div', 'msg-bubble');
      bubble.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>';
      m.appendChild(bubble);
      windowEl.appendChild(m);
      scrollToBottom();
      return bubble;
    }

    // 打字机效果，返回 Promise
    function typewrite(bubble, text, onProgress) {
      return new Promise(function (resolve) {
        var lines = String(text).split('\n');
        bubble.textContent = '';
        var cursor = el('span', 'typing-cursor');
        bubble.appendChild(cursor);

        var flat = lines.map(function (l) { return l; });
        var li = 0, ci = 0;
        var timer = null;

        function step() {
          if (li >= flat.length) {
            if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
            if (onProgress) onProgress('done');
            scrollToBottom();
            resolve();
            return;
          }
          if (ci === 0 && li > 0) {
            bubble.insertBefore(document.createElement('br'), cursor);
          }
          var line = flat[li];
          if (ci < line.length) {
            cursor.insertAdjacentText('beforebegin', line.charAt(ci));
            ci++;
            // 快速输出，标点稍停
            var ch = line.charAt(ci - 1);
            var delay = '，。！？；：'.indexOf(ch) !== -1 ? 40 : 8;
            timer = setTimeout(step, delay);
          } else {
            li++;
            ci = 0;
            timer = setTimeout(step, 15);
          }
          scrollToBottom();
        }

        step();

        // 暴露取消（用户提前发新消息时可打断）
        bubble._cancelTypewriter = function () {
          if (timer) clearTimeout(timer);
          if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
          bubble.textContent = text;
          resolve();
        };
      });
    }

    function addSources(bubble, sources) {
      if (!Array.isArray(sources) || !sources.length) return;
      var details = el('details', 'msg-sources');
      var summary = el('summary');
      summary.textContent = '资料出处';
      details.appendChild(summary);
      var list = el('ul');
      var seen = [];
      sources.forEach(function (source) {
        if (!source || !source.title) return;
        var key = source.title + '|' + (source.url || '');
        if (seen.indexOf(key) !== -1) return;
        seen.push(key);
        var item = el('li');
        var url;
        try {
          url = source.url ? new URL(source.url) : null;
          if (url && url.protocol !== 'https:' && url.protocol !== 'http:') url = null;
        } catch (_) { url = null; }
        if (url) {
          var link = el('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = source.title;
          item.appendChild(link);
        } else {
          item.textContent = source.title;
        }
        list.appendChild(item);
      });
      if (!list.children.length) return;
      details.appendChild(list);
      bubble.appendChild(details);
      scrollToBottom();
    }

    function init() {
      windowEl = document.getElementById('chatWindow');
      inputEl = document.getElementById('chatInput');
      sendBtn = document.getElementById('sendBtn');
      ensureNotEmpty();
    }

    return {
      init: init,
      addUser: addUser,
      addBotShell: addBotShell,
      addSources: addSources,
      typewrite: typewrite,
      scrollToBottom: scrollToBottom
    };
  })();

  /* ================================================================
     虚拟形象状态
     ================================================================ */
  var Avatar = (function () {
    var wrap;
    function init() {
      wrap = document.getElementById('avatarWrap');
    }
    function talking(on) {
      if (!wrap) return;
      wrap.classList.toggle('is-talking', !!on);
    }
    function thinking(on) {
      if (!wrap) return;
      wrap.classList.toggle('is-thinking', !!on);
    }
    return { init: init, talking: talking, thinking: thinking };
  })();

  /* ================================================================
     语音朗读
     ================================================================ */
  var Voice = (function () {
    var supported = typeof window.speechSynthesis !== 'undefined';
    var checkbox;

    function init() {
      checkbox = document.getElementById('voiceToggle');
      if (!supported) {
        var row = document.querySelector('.voice-row');
        if (row) row.style.display = 'none';
      }
    }

    function enabled() {
      return supported && checkbox && checkbox.checked;
    }

    function speak(text) {
      if (!enabled()) return;
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(String(text).replace(/\n+/g, '，'));
        var cfg = (window.APP_CONFIG && window.APP_CONFIG.voice) || {};
        u.lang = cfg.lang || 'zh-CN';
        u.rate = cfg.rate || 1;
        u.pitch = cfg.pitch || 1;
        window.speechSynthesis.speak(u);
      } catch (e) {
        /* 忽略语音异常，不影响主流程 */
      }
    }

    function stop() {
      if (supported) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    }

    return { init: init, speak: speak, stop: stop, enabled: enabled };
  })();

  /* ================================================================
     非遗卡片
     ================================================================ */
  var Heritage = (function () {
    var CARDS = [
      {
        id: 'landye',
        name: '客家蓝染',
        icon: '🧵',
        tag: '草木染 · 蓝草制靛',
        accent: '#2F5D50',
        bg: '#E4EFEA',
        image: 'assets/model-references/landye-237.jpg',
        detail:
          '<p>赣南客家蓝染以蓝草制取靛蓝。补充材料记载，李洁春采用“三浸三晒三发酵”制作靛泥，并以蜡染模板等方式呈现纹样。</p>' +
          '<p>他与织带传承人黄竹英合作，将蓝染与织带结合，制作“靛蓝织带”。蓝染样布的留白、晕染和折痕，可在 3D 展品与实物照片中对照查看。</p>' +
          '<p>资料依据：《赣南客家蓝染技艺》田野调查记录与实地采集影像。</p>',
        ask: '什么是客家蓝染？'
      },
      {
        id: 'zhubian',
        name: '客家竹编',
        icon: '🎋',
        tag: '就地取材 · 三年生毛竹',
        accent: '#6B8F4E',
        bg: '#EDF3E6',
        image: 'assets/model-references/boji-242.jpg',
        detail:
          '<p>赣南竹编历史悠久，多取三年生毛竹，经刮青、剖篾、编织、打磨等工序，化竹为器。</p>' +
          '<p>成品既有竹篮、竹筛、竹席等生活器具，也有工艺精巧的摆件，纹样多取吉祥寓意。</p>' +
          '<p>团队走访竹编传承人，记录了编制方法与代表性竹器，相关素材已进入数字助手知识库。</p>',
        ask: '竹编有什么工艺特色？'
      },
      {
        id: 'zhidai',
        name: '客家织带',
        icon: '🧶',
        tag: '女红技艺 · 挑线穿梭',
        accent: '#C45C26',
        bg: '#FBEDE4',
        image: 'assets/model-references/zhidai-251.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61T3r',
        detail:
          '<p>客家冬头帕织带的制作分为架线、编织和下架。将多色丝线固定在绠瓠子上，留出穗线，用带尺挑线、穿梭，把纹样逐行织入窄带。</p>' +
          '<p>万字纹、竹节、蝴蝶、梅花和吉祥文字是客家织带最常见的纹样。织带与冬头帕、传统婚俗紧密相连，寄托着家族血脉绵延和生活顺遂平安的美好祈愿。</p>' +
          '<p>织带多用于头帕系结与日常佩戴，窄带织造工具小巧便携，在形制上与大型经纬布织机各具特色、相辅相成。</p>',
        ask: '客家织带有什么寓意？'
      },
      {
        id: 'weiwu',
        name: '客家围屋',
        icon: '🏯',
        tag: '世界围屋之都 · 龙南',
        accent: '#8B6B4A',
        bg: '#F3EDE4',
        image: 'assets/pdf-imgs/page-15.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61TDG',
        detail:
          '<p>龙南素有「世界围屋之都」美誉，现存客家围屋 376 座，是赣南客家文化的核心承载地。</p>' +
          '<p>围屋是客家先民聚族而居、御外自保的城堡式建筑，代表有关西新围、燕翼围等，中轴对称、方正厚重，融合中原营造技艺与客家智慧。</p>' +
          '<p>2006 年，客家围（龙南）被列入全国重点文物保护单位，如今也是重要的文旅打卡地。</p>',
        ask: '龙南为什么叫世界围屋之都？'
      },
      {
        id: 'opera',
        name: '客家戏曲与说唱',
        icon: '🎭',
        tag: '表演艺术 · 采茶戏 莲花调 落地花鼓 木偶戏',
        accent: '#9B3D5B',
        bg: '#FBEFF2',
        image: 'assets/pdf-imgs/page-19.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61TyV',
        detail:
          '<p>采茶戏流行于江西、湖北、湖南、安徽、福建、广东、广西等省区，因地区不同而各冠地名，如粤北采茶戏、阳新采茶戏、黄梅采茶戏；其中以江西最为普遍、剧种最多。</p>' +
          '<p>莲花调流传于龙南东坑、里仁、龙南镇、汶龙、杨村一带，上世纪之初由粤之和平、连平及赣之全南三县传入。唱词以四句七言为主，音乐自由、即兴而歌，以竹板击节。</p>' +
          '<p>落地花鼓两百余年前由福建武平传入广东平远，生、旦、丑三人登场，音乐融合凤阳花鼓、汉调与客家山歌。杖头木偶戏以樟木雕偶头、装操纵杆，演员藏于屏后举杆而演，一人双脚踩打锣鼓、双手操控木偶，兼以说唱对白，2021 年列入省级非遗。</p>',
        ask: '龙南的采茶戏和莲花调各有什么特点？'
      },
      {
        id: 'food',
        name: '客家味道',
        icon: '🥢',
        tag: '味觉龙南 · 酿豆腐 黄元米果 四星望月 擂茶',
        accent: '#B4692B',
        bg: '#FBF1E6',
        image: 'assets/pdf-imgs/page-32.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61bcE',
        detail:
          '<p>酿豆腐是客家菜里最常见的一道：豆腐挖坑填肉馅，煎而炖之，外皮焦黄、内里雪嫩。客家人南迁后以豆腐代替面皮，所以叫它「无麦之饺」。</p>' +
          '<p>龙南人过年少不了黄元米果：取高山大禾米，以黄元柴草木灰滤碱水浸泡，反复上甑蒸熟，再入石臼人力捶打至软糯筋道。老话讲「过年吃米果，来年日子节节高」。</p>' +
          '<p>四星望月 1929 年由群众以「蒸笼粉鱼」招待毛泽东而来，竹笼似月、四碟如星。赣南客家擂茶制作技艺是「中国传统制茶技艺及其相关习俗」的组成项目，该整体项目于2022年列入联合国教科文组织人类非遗代表作名录。2019 年龙南第三届客家美食节从二十余道候选中评出十三道「龙南客家一桌菜」，其中凤眼珍珠汤在清代道光年间已列为贡品。</p>',
        ask: '酿豆腐为什么被叫作「无麦之饺」？'
      },
      {
        id: 'festival',
        name: '岁时节令',
        icon: '🏮',
        tag: '民俗活动 · 迎龙灯 烧瓦塔 走古事 九狮拜象',
        accent: '#C0392B',
        bg: '#FCEDEA',
        image: 'assets/pdf-imgs/page-48.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61Tyz',
        detail:
          '<p>迎龙灯是赣南客家逢年过节举办的传统民俗，已列入江西省省级非遗。龙灯以竹篾扎制骨架，糊纸或布，绘花鸟瑞兽等吉祥纹样并缀各式花灯。</p>' +
          '<p>龙南中秋流传老话「中秋烧瓦塔，岁岁家发达」：就地取砖瓦垒成空心高塔，暮色后引火内燃，再撒食盐谷壳助燃，火势越旺寓意日子越红火。</p>' +
          '<p>走古事始于明清之际，以「古装巡游＋仕子科考」为特色，孩童着汉服诵《三字经》与客家家训。九狮拜象则是赣南客家传统民俗表演，2025 年 1 月「非遗贺新春」主会场在龙南世客围启动，37 名演员舞动雄狮与大象。</p>',
        ask: '中秋烧瓦塔的讲究是什么？'
      },
      {
        id: 'lifecustom',
        name: '人生礼俗',
        icon: '🧧',
        tag: '生命礼俗 · 寿诞 子孙袋 花帽 冬头帕',
        accent: '#7A4E9B',
        bg: '#F4EEF9',
        image: 'assets/model-references/zisundai-199.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61TL1',
        detail:
          '<p>客家寿诞承载敬老尊贤的文化精神。寿诞一般在 60 岁以上举行，称「大生日」，可提前不得推后，96 岁便可做百岁寿；一碗龙须面、一挂千子炮，尽显尊老敬贤的古朴民风。龙南妈祖信俗中，祝寿也是主要形式：每年农历三月二十三，香首们齐聚一堂给妈祖「过生日」。</p>' +
          '<p>子孙袋用红布缝成掌心大小，内装花生、红枣、莲子、桂圆取「早生贵子」谐音，再添几粒稻谷寓意五谷丰登。旧时女子出嫁，母亲在临行前亲手系在女儿腰间。</p>' +
          '<p>冬头帕是客家老年妇女常戴的头巾，以黑、蓝、灰棉布缝制，覆于额前垂至耳际，既挡风寒又添庄重。</p>',
        ask: '客家寿诞为什么要「可提前不得推后」？'
      },
      {
        id: 'dialect',
        name: '客家方言',
        icon: '🗣',
        tag: '语言活化石 · 宁龙片 · 16 段原声讲解',
        accent: '#2E6B6B',
        bg: '#E9F3F2',
        image: 'assets/pdf-imgs/page-09.jpg',
        videoUrl: '月光光童谣.mp4',
        detail:
          '<p>龙南话属客家语宁龙片，保留了不少中古汉语的特点，被称作研究汉语演变的「活化石」。典藏里每件展品旁都印有一个二维码，扫开就是展品所在地口音的现场讲解视频，条目里还配了国际音标注音。</p>' +
          '<p>这 16 段原声在「方言」视图里直接列着，点开就能观看。「典藏」的检索输入关键词可以定位到讲到它的展品：搜「豆腐」会列出酿豆腐、黄姜豆腐，命中的句子同时标出来。</p>',
        ask: '龙南话属于客家语的哪个片？'
      },
      {
        id: 'dragonboat',
        name: '龙南龙舟',
        icon: '🚣',
        tag: '民俗体育 · 世界最小龙舟赛场 · 传承五百余年',
        accent: '#1F6F8B',
        bg: '#E8F2F6',
        image: 'assets/pdf-imgs/page-60.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61TCV',
        detail:
          '<p>别处赛龙舟在江河，龙南的赛场在杨村镇一方仅十五亩的池塘，有「世界最小龙舟赛场」之称。</p>' +
          '<p>此项习俗始于明弘治年间，源自杨村人赖思章的一段传奇：许愿木料速售，归必雕龙神金身、年年划船，后果验其言，遂率族人开挖池塘定为赛场，至今传承五百余年。</p>' +
          '<p>赛事有祀奉龙神、请龙神、龙船会、扫邪、决胜等八项仪轨，是完整的民间礼俗程序。届时赣粤两省三县的民众都会赶来。</p>' +
          '<p>「太平堡龙船会」已列为江西省省级非物质文化遗产代表性项目。</p>',
        ask: '龙南的龙舟为什么在池塘里赛？'
      },
      {
        id: 'lacquer',
        name: '龙南大漆',
        icon: '🏺',
        tag: '传统技艺 · 漆树天然漆 · 逾千年',
        accent: '#6B4226',
        bg: '#F4EDE7',
        image: 'assets/pdf-imgs/page-46.jpg',
        detail:
          '<p>大漆又称天然漆，是漆树分泌的树脂，防腐、耐酸碱。《庄子·人世间》载「漆可用，故割之」，足见其用之久远。</p>' +
          '<p>龙南大漆技艺相传南宋时期随中原移民南迁传入，至今已逾千年，代代口手相传。每上一道漆，都要晾干后以砂纸打磨，反复十数次，前后历时六至二十四个月才得一件。成品光泽温润，耐热防潮。</p>' +
          '<p>旧时龙南人家，漆柜漆箱、围屋梁柱皆以大漆髹饰，经百年风雨色泽如新，围屋能撑到今天，这也是原因之一。</p>',
        ask: '龙南大漆技艺是什么时候传过来的？'
      },
      {
        id: 'hakkaconvention',
        name: '世界客属恳亲大会',
        icon: '🌏',
        tag: '客家纽带 · 始于 1971 · 龙南世客围',
        accent: '#3B6B3A',
        bg: '#EDF4EC',
        image: 'assets/pdf-imgs/page-63.jpg',
        detail:
          '<p>世界客属恳亲大会的起源可追溯至 1971 年 9 月 28 日：当时香港崇正总会为庆祝成立五十周年暨「崇正大厦」落成，邀请世界各地 47 个客属社团的 250 多位乡亲代表齐聚香港。与会代表决议将其定为「世界客属第一届恳亲大会」，并决定以后每一至两年轮流在世界各地有关城市举办一届。</p>' +
          '<p>20 世纪基本每两年一届，进入 21 世纪改为每年一届，已在亚、美、非三大洲 11 个国家和地区成功举办多届，被称作客家人的「奥运会」。它也从最初的恳亲联谊，发展成融经济合作、文化交流与学术研讨于一体的综合性平台。</p>' +
          '<p>龙南的世客围即为此而建的文化地标，2025 年「非遗贺新春欢喜过大年」主会场活动便在此启动，九狮拜象率先登场。</p>',
        ask: '世界客属恳亲大会是从哪一年开始的？'
      },
      {
        id: 'huangyuan',
        name: '黄元米果',
        icon: '🥮',
        tag: '传统风味 · 黄元柴草木灰滤碱 · 软糯筋道',
        accent: '#C28422',
        bg: '#FAF4E8',
        image: 'assets/pdf-imgs/page-33.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61bcE',
        detail:
          '<p>黄元米果是龙南客家人逢年过节必不可少的传统风味名点，民间素有“过年吃米果，来年日子节节高”的俗谚。制作时精选高山大禾米，用黄元柴等特定灌木烧成的草木灰过滤出天然碱水，浸泡大米上色生香，蒸熟后趁热移入石臼，由两人以大木槌反复协同捶打至细腻软糯、柔韧筋道。</p>' +
          '<p>成型的米果色泽如黄金般晶莹透亮，质地紧实富有弹性，可切厚片用油煎至两面金黄蘸糖食用，亦可切细条与腊肉、冬笋丝大火旺火同炒，或者切片入高汤煮食。清代道光年间已广受赞誉，兼具扎实的饱腹功能与步步高升的祥瑞寓意，历代传承至今。</p>',
        ask: '黄元米果是怎么制作出来的？'
      },
      {
        id: 'zhenzhu',
        name: '凤眼珍珠',
        icon: '🍲',
        tag: '传统名馔 · 铁锅滚粉成珠 · 清代贡品',
        accent: '#9A6B3A',
        bg: '#F8F1EB',
        image: 'assets/pdf-imgs/page-37.jpg',
        videoUrl: 'https://6525763.hlcode.pro/?id=Na61TMH',
        detail:
          '<p>凤眼珍珠又称精珠子，是龙南客家宴席上最具特色的传统名馔之一。它以优质红薯淀粉为主要原料，制作工艺极为巧妙：将适量薯粉置于特制的浅底铁锅中，师傅双手按顺时针方向平稳旋转晃动，借助离心力与粉粒间的相互摩擦，使淀粉自然滚聚成一颗颗大小均匀、圆润如玉的小圆珠，随后摊晒定型备用。</p>' +
          '<p>入沸汤烹煮后，珠丸迅速变得半透明晶亮，形若凤眼，口感爽滑耐嚼生津。相传清代道光年间帝师徐思庄以此羹款待朝廷钦差，钦差见汤中珠丸形如凤眼且鲜美异常，遂赐名“凤眼珍珠”，后列为贡品。龙南客家婚嫁乔迁与大宴宾朋时必上此汤，取“珠圆玉润、圆满美满”之意。</p>',
        ask: '凤眼珍珠的名字是怎么来的？'
      }
    ];

    var onCardOpen = null;
    var curCat = 'all';
    var curKeyword = '';
    var eventsBound = false;

    function isCustomCard(c) {
      return !!((c.id && c.id.indexOf('kepu-') === 0) || c.creatorTokenId || (c.creatorName && c.creatorName !== '超级管理员'));
    }

    function matchCategory(c, cat) {
      if (cat === 'all') return true;
      var isCust = isCustomCard(c);
      if (cat === 'custom') return isCust;
      var text = ((c.name || '') + ' ' + (c.tag || '') + ' ' + (c.detail || '')).toLowerCase();
      if (cat === 'craft') {
        return /染|竹|编|织|纸|木|手艺|技艺|器|物/.test(text) && !/食|豆腐|米果|珍珠/.test(c.name);
      }
      if (cat === 'arch') {
        return /围|屋|建筑|城|门|堡|关西/.test(text);
      }
      if (cat === 'folk') {
        return /戏|歌|调|民俗|恳亲|节|曲|乐|会/.test(text) && !/食|豆腐|米果|珍珠/.test(c.name);
      }
      if (cat === 'food') {
        return /食|豆腐|米果|珍珠|肉|鱼|汤|酒|粄|菜|茶|酿|饼|酥|糕|宴|味道|味觉/.test(text);
      }
      return true;
    }

    var pillScrollerUpdaters = [];

    function setupPillScroller(pillsEl, leftBtn, rightBtn) {
      if (!pillsEl) return;

      function updateArrows() {
        if (!pillsEl || pillsEl.clientWidth === 0) return;
        var max = pillsEl.scrollWidth - pillsEl.clientWidth;
        if (max <= 2) {
          if (leftBtn) leftBtn.classList.add('is-disabled');
          if (rightBtn) rightBtn.classList.add('is-disabled');
          return;
        }
        if (leftBtn) {
          if (pillsEl.scrollLeft <= 3) leftBtn.classList.add('is-disabled');
          else leftBtn.classList.remove('is-disabled');
        }
        if (rightBtn) {
          if (pillsEl.scrollLeft >= max - 3) rightBtn.classList.add('is-disabled');
          else rightBtn.classList.remove('is-disabled');
        }
      }

      pillScrollerUpdaters.push(updateArrows);

      if (leftBtn) {
        leftBtn.addEventListener('click', function (e) {
          e.preventDefault();
          var step = Math.max(130, Math.floor(pillsEl.clientWidth * 0.65));
          pillsEl.scrollBy({ left: -step, behavior: 'smooth' });
          setTimeout(updateArrows, 280);
        });
      }
      if (rightBtn) {
        rightBtn.addEventListener('click', function (e) {
          e.preventDefault();
          var step = Math.max(130, Math.floor(pillsEl.clientWidth * 0.65));
          pillsEl.scrollBy({ left: step, behavior: 'smooth' });
          setTimeout(updateArrows, 280);
        });
      }
      pillsEl.addEventListener('scroll', updateArrows);
      setTimeout(updateArrows, 100);
      setTimeout(updateArrows, 350);

      if (typeof ResizeObserver !== 'undefined') {
        try {
          var ro = new ResizeObserver(function () {
            updateArrows();
          });
          ro.observe(pillsEl);
        } catch (_) {}
      }

      // 滚轮横向滚动支持
      pillsEl.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          pillsEl.scrollLeft += e.deltaY;
          updateArrows();
        }
      }, { passive: false });

      // 触屏滑动手势支持
      var touchStartX = 0;
      var touchStartScroll = 0;
      var touchMoved = false;

      pillsEl.addEventListener('touchstart', function (e) {
        if (e.touches && e.touches[0]) {
          touchStartX = e.touches[0].pageX;
          touchStartScroll = pillsEl.scrollLeft;
          touchMoved = false;
        }
      }, { passive: true });

      pillsEl.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches[0]) {
          var diff = e.touches[0].pageX - touchStartX;
          if (Math.abs(diff) > 5) touchMoved = true;
          updateArrows();
        }
      }, { passive: true });

      pillsEl.addEventListener('touchend', function () {
        setTimeout(updateArrows, 150);
      }, { passive: true });

      // 鼠标拖拽横向抓取滑动
      var isDown = false;
      var startX = 0;
      var startScrollLeft = 0;
      var hasMoved = false;

      pillsEl.addEventListener('mousedown', function (e) {
        isDown = true;
        hasMoved = false;
        startX = e.pageX - pillsEl.offsetLeft;
        startScrollLeft = pillsEl.scrollLeft;
      });
      window.addEventListener('mouseup', function () { isDown = false; });
      pillsEl.addEventListener('mouseleave', function () { isDown = false; });
      pillsEl.addEventListener('mousemove', function (e) {
        if (!isDown) return;
        var x = e.pageX - pillsEl.offsetLeft;
        var walk = (x - startX) * 1.3;
        if (Math.abs(walk) > 3) hasMoved = true;
        pillsEl.scrollLeft = startScrollLeft - walk;
        updateArrows();
      });

      pillsEl.addEventListener('click', function (e) {
        if (hasMoved || touchMoved) {
          e.stopPropagation();
          hasMoved = false;
          touchMoved = false;
          return;
        }
        var pill = e.target.closest('.dl-pill, .h-cat-pill');
        if (pill) {
          var pRect = pill.getBoundingClientRect();
          var cRect = pillsEl.getBoundingClientRect();
          var offset = (pRect.left + pRect.width / 2) - (cRect.left + cRect.width / 2);
          pillsEl.scrollBy({ left: offset, behavior: 'smooth' });
          setTimeout(updateArrows, 320);
        }
      }, true);
    }

    function bindHeritageEvents() {
      if (eventsBound) return;
      eventsBound = true;
      var sInput = document.getElementById('heritageSearch');
      var sClear = document.getElementById('heritageSearchClear');
      var pills = document.getElementById('heritageCatPills');
      var leftBtn = document.getElementById('heritagePillLeft');
      var rightBtn = document.getElementById('heritagePillRight');

      if (pills) {
        setupPillScroller(pills, leftBtn, rightBtn);
      }

      if (sInput) {
        sInput.addEventListener('input', function () {
          curKeyword = sInput.value.trim().toLowerCase();
          if (sClear) sClear.hidden = !curKeyword;
          render();
        });
      }
      if (sClear) {
        sClear.addEventListener('click', function () {
          if (sInput) {
            sInput.value = '';
            curKeyword = '';
            sClear.hidden = true;
            render();
            sInput.focus();
          }
        });
      }
      if (pills) {
        pills.querySelectorAll('.h-cat-pill').forEach(function (btn) {
          btn.addEventListener('click', function () {
            pills.querySelectorAll('.h-cat-pill').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            curCat = btn.getAttribute('data-cat') || 'all';
            render();
          });
        });
      }
    }

    function render() {
      var grid = document.getElementById('heritageGrid');
      if (!grid) return;
      bindHeritageEvents();

      var allCards = (window.Store && window.Store.getHeritageCards) ? window.Store.getHeritageCards(CARDS) : CARDS;
      var customCount = allCards.filter(isCustomCard).length;

      var pillAll = document.getElementById('hPillAll');
      if (pillAll) pillAll.textContent = allCards.length;
      var pillCustom = document.getElementById('hPillCustom');
      if (pillCustom) pillCustom.textContent = customCount;

      var filtered = allCards.filter(function (c) {
        if (!matchCategory(c, curCat)) return false;
        if (curKeyword) {
          var t = ((c.name || '') + ' ' + (c.tag || '') + ' ' + (c.detail || '')).toLowerCase();
          if (t.indexOf(curKeyword) === -1) return false;
        }
        return true;
      });

      var emptyEl = document.getElementById('heritageEmpty');
      if (emptyEl) emptyEl.hidden = filtered.length > 0;

      grid.innerHTML = '';
      filtered.forEach(function (card) {
        var isCust = isCustomCard(card);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'h-card' + (isCust ? ' is-custom' : '');
        btn.style.setProperty('--card-accent', card.accent || '#2F5D50');
        btn.style.setProperty('--card-bg', card.bg || '#E4EFEA');
        btn.innerHTML =
          (isCust ? '<span class="h-badge-custom">🌟 馆藏新增</span>' : '') +
          '<div class="h-icon">' + (card.icon || '🏮') + '</div>' +
          '<div class="h-name">' + (card.name || '未命名') + '</div>' +
          '<div class="h-tag">' + (card.tag || '客家非遗') + '</div>';
        btn.addEventListener('click', function () {
          if (onCardOpen) onCardOpen(card);
        });
        grid.appendChild(btn);
      });
    }

    function init(onOpen) {
      if (onOpen) onCardOpen = onOpen;
      render();
    }

    function list() {
      return (window.Store && window.Store.getHeritageCards) ? window.Store.getHeritageCards(CARDS) : CARDS;
    }

    function updateAllPillScrollers() {
      pillScrollerUpdaters.forEach(function (fn) {
        try { fn(); } catch (_) {}
      });
    }

    window.addEventListener('resize', function () {
      setTimeout(updateAllPillScrollers, 60);
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(updateAllPillScrollers, 100);
    });

    return {
      init: init,
      render: render,
      list: list,
      setupPillScroller: setupPillScroller,
      updateAllPillScrollers: updateAllPillScrollers
    };
  })();

  /* ================================================================
     二维码弹层
     ================================================================ */
  /* ================================================================
     访问地址面板
     ----------------------------------------------------------------
     顶栏「扫码访问」把站点地址画成二维码，同时给出可点链接，并按主机名如实
     说明这条地址谁能打开（公网 / 局域网 / 只有本机）。
     ================================================================ */
  var AccessPanel = (function () {
    var modal, addrRow;

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function currentUrl() {
      return window.location.href.split('#')[0];
    }

    // 固定入口地址：config.app.publicUrl 非空时以它为准，否则用当前网址自己推。
    // 这里不再提供"填一个地址存进 localStorage"的口子——那是还没有公网域名时的
    // 开发期脚手架，现在印展板用的固定地址是 config.app.canonicalUrl。
    function getPublicUrl() {
      var cfg = window.APP_CONFIG && window.APP_CONFIG.app;
      return (cfg && cfg.publicUrl) || '';
    }

    function normalizeUrl(raw) {
      var u = String(raw || '').trim();
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      return u.replace(/\/+$/, '');
    }

    function isHttpUrl(u) {
      return /^https?:\/\/[^\s]+\.[^\s]+/i.test(u);
    }

    function target() {
      var isLocal = (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname || window.location.protocol === 'file:'));
      if (isLocal) {
        return 'https://antigravity.longnankejia-dev.pages.dev/';
      }
      var t = normalizeUrl(getPublicUrl()) || currentUrl();
      if (!isHttpUrl(t)) {
        // 双击 index.html 直接预览时 location 是 file://，扫不出也打不开，退回永久地址
        var cfg = window.APP_CONFIG && window.APP_CONFIG.app;
        t = normalizeUrl((cfg && cfg.canonicalUrl) || '');
      }
      return t.split('#')[0];
    }

    function copyAddress() {
      var t = target();
      var btn = document.getElementById('addrCopyBtn');
      function done(ok) { if (btn) btn.textContent = ok ? '已复制 ✓' : '复制失败，请手动选中'; }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    }

    /** 站点入口码：馆内观众扫它打开页面。与典藏 PDF 的印刷码无关。 */
    function renderQr(target) {
      var box = document.getElementById('addrQr');
      if (!box) return;
      box.innerHTML = '';
      if (!target || !isHttpUrl(target) || !window.QR) {
        box.innerHTML = '<div class="addr-empty">当前地址不可扫码，请用下方链接</div>';
        return;
      }
      var canvas = document.createElement('canvas');
      box.appendChild(canvas);
      if (!window.QR.render(target, canvas, 4)) {
        box.innerHTML = '<div class="addr-empty">地址过长，无法生成二维码，请用下方链接</div>';
      }
    }

    function renderAddress() {
      var t = target();
      if (isHttpUrl(t)) {
        addrRow.innerHTML =
          '<a class="addr-link" href="' + esc(t) + '" target="_blank" rel="noopener">' + esc(t) + '</a>' +
          '<button class="addr-copy" id="addrCopyBtn" type="button">复制链接</button>';
        document.getElementById('addrCopyBtn').addEventListener('click', copyAddress);
      } else {
        addrRow.innerHTML = '<div class="addr-empty">当前是本地文件预览，无法生成可分享的地址</div>';
      }
      renderQr(isHttpUrl(t) ? t : '');
    }

    function init() {
      modal = document.getElementById('accessModal');
      addrRow = document.getElementById('addrRow');

      document.getElementById('accessBtn').addEventListener('click', open);
      document.getElementById('addrClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });
    }

    function open() {
      renderAddress();
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    return { init: init, open: open, close: close };
  })();

  /* ================================================================
     非遗详情弹层
     ================================================================ */
  var DetailModal = (function () {
    var modal, titleEl, bodyEl, iconEl, askBtn, mediaEl;
    var currentAsk = '';

    function init() {
      modal = document.getElementById('detailModal');
      titleEl = document.getElementById('detailTitle');
      bodyEl = document.getElementById('detailBody');
      iconEl = document.getElementById('detailIcon');
      askBtn = document.getElementById('askMoreBtn');
      mediaEl = document.getElementById('detailMedia');

      document.getElementById('detailClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });
      askBtn.addEventListener('click', function () {
        close();
        // 只调 ask() 的话回答打在隐藏的问答面板里，用户看到的是「没反应」
        if (window.App && window.App.switchPanel) window.App.switchPanel('panelChat');
        if (window.App && window.App.ask) {
          setTimeout(function () { window.App.ask(currentAsk); }, 200);
        }
      });
    }

    function renderMedia(card) {
      if (!mediaEl) return;
      var img = card.imageUrl || card.image || '';
      var vid = card.videoUrl || card.video || '';
      if (!img && !vid) {
        mediaEl.innerHTML = '';
        mediaEl.hidden = true;
        return;
      }
      var html = '';
      if (img) {
        html += '<img class="detail-media-img" src="' + esc(img) + '" alt="' + esc(card.name) + '" loading="lazy" onerror="this.style.display=\'none\'">';
      }
      if (vid) {
        if (/\.(mp4|webm|ogg)($|\?)/i.test(vid)) {
          html += '<video class="detail-media-video" controls playsinline preload="metadata" src="' + esc(vid) + '"></video>';
        } else {
          html += '<div class="detail-media-btn-wrap"><button class="dc-video-play-btn" id="detailPlayVidBtn" type="button">▶ 播放视频讲解</button></div>';
        }
      }
      mediaEl.innerHTML = html;
      mediaEl.hidden = false;

      var pBtn = document.getElementById('detailPlayVidBtn');
      if (pBtn && vid) {
        pBtn.addEventListener('click', function () {
          if (window.Diancang && window.Diancang.playVideo) {
            window.Diancang.playVideo({ name: card.name, videoUrl: vid });
          } else {
            window.open(vid, '_blank', 'noopener');
          }
        });
      }
    }

    function open(card) {
      titleEl.textContent = card.name;
      renderMedia(card);
      bodyEl.innerHTML = card.detail;
      iconEl.textContent = card.icon;
      iconEl.style.background = card.bg;
      currentAsk = card.ask;
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
      if (mediaEl) {
        var v = mediaEl.querySelector('video');
        if (v) { try { v.pause(); } catch (_) {} }
        mediaEl.innerHTML = '';
        mediaEl.hidden = true;
      }
    }

    return { init: init, open: open, close: close };
  })();

  /* ================================================================
     问答即时检索组件
     ================================================================ */
  var ChatSearch = (function () {
    var wrapEl, inputEl, clearBtn, resultsEl;

    function highlight(text, q) {
      var s = String(text || '');
      if (!q) return esc(s);
      var idx = s.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return esc(s.slice(0, 75)) + (s.length > 75 ? '…' : '');
      var start = Math.max(0, idx - 18);
      var end = Math.min(s.length, idx + q.length + 35);
      var prefix = start > 0 ? '…' : '';
      var suffix = end < s.length ? '…' : '';
      var snippet = s.slice(start, end);
      var relIdx = snippet.toLowerCase().indexOf(q.toLowerCase());
      return prefix + esc(snippet.slice(0, relIdx)) + '<mark>' + esc(snippet.substr(relIdx, q.length)) + '</mark>' + esc(snippet.slice(relIdx + q.length)) + suffix;
    }

    function search(query) {
      var q = String(query || '').trim();
      if (!q) return [];
      var qLower = q.toLowerCase();
      var hits = [];

      // 1. 知识库条目
      var kbEntries = (window.Store && window.Store.getEntries) ? window.Store.getEntries() : (window.KNOWLEDGE_BASE || []);
      kbEntries.forEach(function (e) {
        var t = (e.title || '').toLowerCase();
        var a = (e.answer || '').toLowerCase();
        var kw = Array.isArray(e.keywords) ? e.keywords.join(' ').toLowerCase() : '';
        var score = 0;
        if (t === qLower) score += 100;
        else if (t.indexOf(qLower) !== -1) score += 60;
        else if (kw.indexOf(qLower) !== -1) score += 40;
        else if (a.indexOf(qLower) !== -1) score += 20;
        if (score > 0) {
          hits.push({
            type: 'kb',
            badge: '知识库',
            title: e.title,
            snippet: highlight(e.answer, q),
            askText: e.title,
            score: score
          });
        }
      });

      // 2. 非遗科普卡片
      var cards = Heritage.list();
      cards.forEach(function (c) {
        var n = (c.name || '').toLowerCase();
        var tag = (c.tag || '').toLowerCase();
        var d = (c.detail || '').replace(/<[^>]+>/g, '').toLowerCase();
        var score = 0;
        if (n === qLower) score += 95;
        else if (n.indexOf(qLower) !== -1) score += 55;
        else if (tag.indexOf(qLower) !== -1) score += 35;
        else if (d.indexOf(qLower) !== -1) score += 18;
        if (score > 0) {
          hits.push({
            type: 'card',
            badge: '科普卡片',
            title: c.name,
            snippet: highlight(c.detail.replace(/<[^>]+>/g, ''), q),
            card: c,
            askText: c.ask || ('介绍一下' + c.name),
            score: score
          });
        }
      });

      // 3. 文化典藏展品
      if (window.Diancang && window.Diancang.search) {
        var dcHits = window.Diancang.search(q);
        dcHits.slice(0, 6).forEach(function (h) {
          hits.push({
            type: 'dc',
            badge: '文化典藏',
            title: h.item.name,
            snippet: h.sentence ? highlight(h.sentence, q) : highlight(h.item.desc, q),
            item: h.item,
            askText: h.item.name + '是什么？',
            score: (h.score || 30) - 5
          });
        });
      }

      hits.sort(function (a, b) { return b.score - a.score; });
      return hits.slice(0, 8);
    }

    function renderResults(hits, q) {
      if (!hits.length) {
        resultsEl.innerHTML = '<div class="chat-search-empty">未找到与「' + esc(q) + '」相关的馆藏条目，可直接提问阿蓝</div>';
        resultsEl.hidden = false;
        return;
      }
      resultsEl.innerHTML = hits.map(function (h, i) {
        return '<div class="chat-search-item" data-idx="' + i + '">' +
          '<div class="chat-search-item-header">' +
          '  <span class="chat-search-item-title">' + esc(h.title) + '</span>' +
          '  <span class="chat-search-item-badge">' + esc(h.badge) + '</span>' +
          '</div>' +
          '<div class="chat-search-item-snippet">' + h.snippet + '</div>' +
          '<div class="chat-search-item-actions">' +
          '  <button type="button" class="chat-search-ask-btn" data-ask="' + esc(h.askText) + '">💬 问阿蓝</button>' +
          '</div>' +
          '</div>';
      }).join('');
      resultsEl.hidden = false;

      resultsEl.querySelectorAll('.chat-search-ask-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var qText = btn.getAttribute('data-ask');
          hide();
          inputEl.value = '';
          clearBtn.hidden = true;
          if (window.App && window.App.ask) {
            window.App.ask(qText);
          }
        });
      });

      resultsEl.querySelectorAll('.chat-search-item').forEach(function (itemEl) {
        itemEl.addEventListener('click', function () {
          var idx = parseInt(itemEl.getAttribute('data-idx'), 10);
          var h = hits[idx];
          if (!h) return;
          hide();
          if (h.type === 'card' && h.card) {
            DetailModal.open(h.card);
          } else if (h.type === 'dc' && h.item && window.Diancang) {
            if (window.App && window.App.switchPanel) window.App.switchPanel('panelDiancang');
            if (window.Diancang.searchFrom) {
              var qInput = document.getElementById('dcQuery');
              if (qInput) qInput.value = h.item.name;
              window.Diancang.searchFrom();
            }
          } else {
            if (window.App && window.App.ask) {
              window.App.ask(h.askText);
            }
          }
        });
      });
    }

    function hide() {
      if (resultsEl) resultsEl.hidden = true;
    }

    function init() {
      wrapEl = document.getElementById('chatSearchWrap');
      inputEl = document.getElementById('chatSearchInput');
      clearBtn = document.getElementById('chatSearchClear');
      resultsEl = document.getElementById('chatSearchResults');
      if (!inputEl || !resultsEl) return;

      inputEl.addEventListener('input', function () {
        var q = inputEl.value.trim();
        clearBtn.hidden = !q;
        if (!q) {
          hide();
          return;
        }
        var hits = search(q);
        renderResults(hits, q);
      });

      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          hide();
        } else if (e.key === 'Enter') {
          var q = inputEl.value.trim();
          if (q) {
            hide();
            if (window.App && window.App.ask) {
              window.App.ask(q);
            }
          }
        }
      });

      clearBtn.addEventListener('click', function () {
        inputEl.value = '';
        clearBtn.hidden = true;
        hide();
        inputEl.focus();
      });

      document.addEventListener('click', function (e) {
        if (wrapEl && !wrapEl.contains(e.target)) {
          hide();
        }
      });
    }

    return { init: init, hide: hide };
  })();

  /* ---------- 导出 ---------- */
  window.Heritage = Heritage;
  window.UI = {
    init: function () {
      Chat.init();
      ChatSearch.init();
      Avatar.init();
      Voice.init();
      AccessPanel.init();
      DetailModal.init();
      Heritage.init(function (card) {
        DetailModal.open(card);
      });
    },
    Chat: Chat,
    ChatSearch: ChatSearch,
    Avatar: Avatar,
    Voice: Voice,
    Heritage: Heritage,
    Access: AccessPanel,
    setupPillScroller: Heritage.setupPillScroller,
    updateAllPillScrollers: Heritage.updateAllPillScrollers
  };
})();
