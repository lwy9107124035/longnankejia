import urllib.request, json, time

url = 'https://api.siliconflow.cn/v1/chat/completions'
key = 'sk-jsaoktfuiypfrnmxfvkgajxebnchopabyzurvnuugqvngdvh'

# 模拟真实浏览器请求（带 Origin）
system_prompt = (
    '你是"阿蓝"，龙南客家非遗数字助手，为游客介绍江西龙南的客家非物质文化遗产。'
    '你熟悉蓝染、竹编、客家织带、客家围屋、客家山歌与童谣、客家方言等知识。'
    '回答要求：使用简体中文，口吻亲切自然，像一位热情的讲解员；'
    '内容准确，不确定时坦诚说明，不编造史实；'
    '每次回答控制在 120 字以内，可适当使用一个 emoji。'
)

def test_browser_like(question, model, label):
    body = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': question}
        ],
        'temperature': 0.7,
        'max_tokens': 512
    }).encode()

    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Origin': 'https://lwy9107124035.github.io',
        'Referer': 'https://lwy9107124035.github.io/longnankejia/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })

    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        elapsed = time.time() - t0
        data = json.loads(resp.read())
        msg = data['choices'][0]['message']
        content = msg.get('content', '')
        finish = data['choices'][0].get('finish_reason', '?')

        # 检查 CORS 响应头
        acao = resp.headers.get('Access-Control-Allow-Origin', 'NONE')
        print(f'[{label}] {elapsed:.1f}s  model={model}')
        print(f'  CORS-Origin: {acao}')
        print(f'  Content len: {len(content)}  Finish: {finish}')
        print(f'  Keys: {list(msg.keys())}')
        print(f'  Text: [{content[:120]}]')
        if 'reasoning_content' in msg:
            print(f'  HAS reasoning_content! len={len(msg.get("reasoning_content",""))}')
        # 检查是否有 markdown
        md_chars = sum(content.count(c) for c in ['**','##','# ','\n\n'])
        print(f'  Markdown chars count: {md_chars}')
        return True
    except Exception as e:
        elapsed = time.time() - t0
        print(f'[{label}] FAIL after {elapsed:.1f}s: {e}')
        return False

print('=== Browser-like CORS test ===')
test_browser_like('唐朝有几个皇帝', 'Qwen/Qwen2.5-7B-Instruct', 'Qwen-7B-Tang')
print()
test_browser_like('唐朝有几个皇帝', 'deepseek-ai/DeepSeek-V4-Flash', 'DS-V4Flash-Tang')
print()
test_browser_like('蓝染的原料是什么', 'Qwen/Qwen2.5-7B-Instruct', 'Qwen-7B-Landye')
print()
# 测试超长问题（看会不会返回很长的响应）
test_browser_like('请详细介绍中国所有朝代的皇帝数量和年份', 'Qwen/Qwen2.5-7B-Instruct', 'Qwen-7B-Long')
