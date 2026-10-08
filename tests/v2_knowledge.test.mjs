import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
function setup(custom){
 const window={APP_CONFIG:{ai:{mode:'api',mockDelay:[0,0],api:{proxyUrl:'/api/ai/chat/completions',model:'test',temperature:0.2,maxTokens:900}}}};
 const calls=[],audits=[];let response;let reject=false,auditOverride;
 const storage=new Map();
 const sandbox={window,console:{warn(){}},AbortController,setTimeout,clearTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(url,init)=>{
  const call={url,...init,body:JSON.parse(init.body)},audit=call.body.messages[0].content.startsWith('你是资料核对员');
  calls.push(call);if(audit)audits.push(call);if(reject)throw new Error('offline');
  if(response!==undefined)return {ok:true,json:async()=>response};
  if(audit){
   const quote=call.body.messages[0].content.includes('[证据1.1]');
   const report=auditOverride || (quote?{parts:[{evidence:['1.1']}],gaps:[]}:{parts:[],gaps:[call.body.messages.at(-1).content]});
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(report)}}]})};
  }
  return {ok:true,json:async()=>response};
 }};
 vm.createContext(sandbox);
 for(const file of ['knowledge-base.js','store.js','answer-engine.js'])vm.runInContext(fs.readFileSync(new URL('../js/'+file,import.meta.url),'utf8'),sandbox);
 if(custom)window.Store.addEntry(custom);
 return {window,calls,audits,setResponse:v=>{response=v;},setAudit:v=>{auditOverride=v;},fail:()=>{reject=true;},rules:()=>new window.AnswerEngine.RulesEngine(),api:()=>new window.AnswerEngine.ApiEngine()};
}
test('overviews are local; specific, comparative and unseen questions use grounded synthesis',async()=>{
 const s=setup(),e=s.api();
 assert.equal((await e.ask('什么是客家蓝染？')).source,'rules');assert.equal(s.calls.length,0);
 for(const q of ['织带和竹编的工具有什么不同？','客家蓝染和其他地方蓝染的区别？','脖围和大襟衫的结构有什么不同？','门榜为什么被叫作微型族谱？','介绍日本蓝染']){
  const before=s.calls.length;assert.equal((await e.ask(q)).source,'api',q);assert.equal(s.calls.length,before+1,q);
 }
 const context=s.calls[0].body.messages[0].content;
 assert.match(context,/织带的工具/);assert.match(context,/制篾工具/);assert.match(context,/带尺/);assert.match(context,/度篾齿/);
 const compare=s.calls[1].body.messages[0].content;assert.match(compare,/南通/);assert.match(compare,/白族/);
 assert.match(s.calls[2].body.messages[0].content,/脖围实物/);assert.match(s.calls[2].body.messages[0].content,/大襟衫实物/);
 assert.match(s.calls[3].body.messages[0].content,/微型族谱/);
 assert.equal(s.calls[0].headers.Authorization,undefined);
 assert.equal(s.audits.length,5,'each detailed answer selects evidence in one bounded model request');
});
test('followups retain real conversation; a new subject clears stale retrieval context',async()=>{
 const s=setup(),e=s.api();await e.ask('杨村竹编常用哪些工具？');await e.ask('那制作步骤呢？');
 const msgs=s.calls[1].body.messages;
 assert.equal(msgs.length,4);assert.equal(msgs[1].role,'user');assert.match(msgs[1].content,/杨村竹编/);
 assert.equal(msgs.at(-1).content,'那制作步骤呢？');assert.match(msgs[0].content,/起底/);
 await e.ask('潮汕工夫茶怎样冲泡？');assert.doesNotMatch(s.calls[2].body.messages[0].content,/度篾齿|起底/);
 const followup=await e.ask('那有哪些器具？');assert.equal(followup.route,'clarify');
 assert.doesNotMatch(followup.text,/杨村|度篾齿/);assert.equal(s.calls.length,3);
 assert.ok(e._fallback.history.length<=8);
});
test('out-of-domain and shared generic words do not become confident local answers',async()=>{
 const s=setup(),r=s.rules();
 const rank=r.rank('潮汕工夫茶冲泡步骤是什么？');assert.equal(rank.hit,null);assert.equal(rank.chunks.length,0);
 const no=await r.ask('潮汕工夫茶冲泡步骤是什么？');assert.match(no.text,/没有覆盖|暂不能核实/);assert.doesNotMatch(no.text,/蓝染|竹编|我是/);
 const model=r.rank('大襟衫的背面纹样是否有实际照片？');assert.ok(model.chunks.length);assert.ok(model.chunks.every(c=>c.topics.includes('大襟衫')));
 assert.equal(r.route('介绍日本蓝染',r.rank('介绍日本蓝染')),'grounded');
 assert.equal(r.route('什么是福建土楼？',r.rank('什么是福建土楼？')),'uncovered');
});
test('social turns and unfinished questions bypass evidence checking in both modes',async()=>{
 for(const mode of ['rules','api']){
  const s=setup(),e=s[mode]();s.fail();
  for(const q of ['嗯。','嗯嗯，好呀。','你好！','你在吗？','谢谢你','明白了','再见']){
   const answer=await e.ask(q);assert.equal(answer.route,'conversation',q);
   assert.doesNotMatch(answer.text,/不足|核实|未覆盖|没有覆盖/,q);
  }
  for(const q of ['请问','我想问一下','怎么做呢？','继续']){
   const answer=await e.ask(q);assert.equal(answer.route,'clarify',q);
   assert.match(answer.text,/补充|名称/,q);assert.doesNotMatch(answer.text,/不足|核实/,q);
  }
  for(const q of ['你是','你是谁？','嗯，你是哪个模型？','阿蓝是谁？']){
   const answer=await e.ask(q);assert.equal(answer.route,'overview',q);assert.match(answer.text,/我是「阿蓝」/,q);
  }
  assert.equal(s.calls.length,0,'normal conversation works even if the API is unavailable');
 }
});
test('acknowledgments preserve context while greetings cannot hide factual requests',async()=>{
 const s=setup(),e=s.api();
 await e.ask('杨村竹编常用哪些工具？');await e.ask('嗯。');await e.ask('谢谢');
 await e.ask('怎么做呢？');assert.match(s.calls[1].body.messages[0].content,/起底/);
 assert.equal(s.calls[1].body.messages.at(-1).content,'怎么做呢？');
 assert.match(s.calls[1].body.messages.map(m=>m.content).join('\n'),/嗯。/);
 const about=await e.ask('这个项目是做什么的？');assert.equal(about.route,'overview');assert.match(about.text,/南昌大学/);
 assert.equal(s.calls.length,2,'project identity does not inherit a craft topic');
 await e.ask('你好，潮汕工夫茶怎么冲泡？');
 assert.doesNotMatch(s.calls[2].body.messages[0].content,/起底|度篾齿/);
 await e.ask('你是谁，蓝染需要99摄氏度吗？');
 assert.equal(s.calls.length,4);assert.match(s.calls[3].body.messages[0].content,/蓝染/);
 assert.doesNotMatch(s.calls[3].body.messages[0].content,/我是「阿蓝」/);
});
test('a named new topic following 那 does not borrow stale craft evidence',async()=>{
 const s=setup(),e=s.api();await e.ask('杨村竹编有哪些工具？');
 await e.ask('那潮汕工夫茶怎么冲泡？');
 assert.doesNotMatch(s.calls[1].body.messages[0].content,/起底|度篾齿/);
});
test('an empty evidence selection is labelled uncovered even when retrieval found candidates',async()=>{
 const s=setup();s.setAudit({parts:[],gaps:['具体温度']});
 const answer=await s.api().ask('蓝染的具体温度是多少？');
 assert.equal(answer.route,'uncovered');assert.match(answer.text,/不足以核实/);
});
test('unavailable API gives sourced excerpts and marks partial coverage',async()=>{
 const s=setup(),e=s.api();s.fail();
 const a=await e.ask('杨村竹编和日本竹艺的工具有哪些区别？');assert.equal(a.source,'rules');assert.equal(a.fallback,true);
 assert.match(a.text,/度篾齿/);assert.match(a.text,/仍需进一步核实/);assert.ok(a.sources.length);
 const b=await e.ask('潮汕工夫茶怎样冲泡？');assert.equal(b.route,'uncovered');assert.equal(b.sources.length,0);
});
test('uncertainty stays public; reasoning and nonexistent citations cannot be answers',async()=>{
 const s=setup(),e=s.api();
 s.setAudit({parts:[{evidence:['1.3']}],gaps:['现在几岁']});
 const a=await e.ask('黄竹英现在几岁？');assert.equal(a.source,'api');assert.match(a.text,/不能据此回答她现在几岁/);
 s.setResponse({choices:[{message:{content:'',reasoning_content:'不该展示的内部思考'}}]});
 const b=await e.ask('蓝染具体发酵温度是多少？');assert.equal(b.source,'rules');assert.doesNotMatch(b.text,/内部思考/);
 s.setResponse(undefined);s.setAudit({parts:[{evidence:['99.1']}],gaps:[]});
 assert.equal((await e.ask('竹编怎么做？')).source,'rules');
});
test('selected evidence remains complete without document labels in public answers',async()=>{
 const s=setup(),e=s.api();
 const q='客家蓝染和其他地方蓝染的共同点和区别是什么？',ranked=e._fallback.rank(q);
 s.setAudit({parts:ranked.chunks.slice(0,3).map((chunk,i)=>({evidence:(chunk.text.match(/[^。！？!?]+[。！？!?]?/g)||[]).slice(0,3).map((_,j)=>(i+1)+'.'+(j+1))})),gaps:[]});
 const long=await e.ask(q);assert.ok(long.text.length>300);assert.match(long.text,/蓝底白花/);
 assert.equal(long.citationKind,'selected-evidence');assert.equal(long.verified,true);
 assert.equal(long.sources.length,0);assert.doesNotMatch(long.text,/\[资料\d+\]|PDF/);
});
test('model-written claims and gap explanations cannot introduce unsupported facts',async()=>{
 const s=setup(),e=s.api();s.setAudit({parts:[{text:'织带需高温染色。',evidence:['1.99']}],gaps:[]});
 assert.equal((await e.ask('蓝染温度是多少？')).source,'rules');
 s.setAudit({parts:[{text:'必须在99摄氏度染色。',evidence:['1.1']}],gaps:[]});
 const a=await e.ask('蓝染温度是多少？');assert.equal(a.source,'api');assert.doesNotMatch(a.text,/99|摄氏度/);
 s.setAudit({parts:[],gaps:['资料未记载，但在日本通常为99摄氏度']});
 const b=await e.ask('日本蓝染温度是多少？');assert.doesNotMatch(b.text,/99|通常/);assert.match(b.text,/不足/);
});
test('import and runtime custom entries preserve provenance and remain retrievable',async()=>{
 const entry={id:'custom-wheel',title:'陶轮',topics:['陶轮'],keywords:['陶轮','脚踏'],answer:'馆内记录使用脚踏陶轮。',sources:[{title:'用户展品记录',url:'https://example.com/record'}]};
 const s=setup(entry);const a=await s.api().ask('陶轮是怎么驱动的？');assert.equal(a.source,'api');assert.match(s.calls[0].body.messages[0].content,/脚踏陶轮/);
 assert.equal(s.window.Store.importKB(JSON.stringify([entry])),true);
 const imported=s.window.Store.getEntries().find(e=>e.id===entry.id);assert.equal(imported.sources[0].url,entry.sources[0].url);assert.equal(imported.topics[0],'陶轮');
});
test('downloaded article is ingested; excluded material and contradictory ages stay excluded',()=>{
 const {window}=setup();const text=JSON.stringify(window.KNOWLEDGE_BASE);
 assert.doesNotMatch(text,/茶果|待核验微信文章|无法读取正文/);
 const article=window.KNOWLEDGE_BASE.filter(e=>e.id.startsWith('pattern-'));assert.ok(article.length>=8);assert.ok(article.every(e=>e.sources.length));
 const process=window.KNOWLEDGE_BASE.find(e=>e.id==='indigo-process');assert.match(process.answer,/没有逐道列明/);
 assert.doesNotMatch(window.KNOWLEDGE_BASE.find(e=>e.id==='weave-people').answer,/76岁|78岁/);
});
test('knowledge base, answers and sources contain no file extensions or internal doc names',async()=>{
 const {window}=setup();
 const text=JSON.stringify(window.KNOWLEDGE_BASE);
 assert.doesNotMatch(text,/非遗\.docx|\.docx|\.pdf|用户下载PDF/i);
 const r=new window.AnswerEngine.RulesEngine();
 for(const q of ['什么是客家织带？','杨村竹编有什么工具？','客家蓝染有什么历史？','冬头帕有哪些组成？','子孙袋的结构是什么？']){
  const a=await r.ask(q);
  assert.doesNotMatch(a.text,/非遗\.docx|\.docx|\.pdf|用户下载PDF/i);
  for(const src of (a.sources||[])){
   assert.doesNotMatch(src.title,/非遗\.docx|\.docx|\.pdf|用户下载PDF/i);
  }
 }
});
