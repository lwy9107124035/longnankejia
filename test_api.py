import urllib.request, json, time

url = 'https://api.siliconflow.cn/v1/chat/completions'
key = 'sk-jsaoktfuiypfrnmxfvkgajxebnchopabyzurvnuugqvngdvh'

system_prompt = (
    '你是"阿蓝"，龙南客家非遗数字助手，为游客介绍江西龙南的客家非物质文化遗产。'
    '你熟悉蓝染、竹编、客家织带、客家围屋、客家山歌与童谣、客家方言等知识。'
    '回答要求：使用简体中文，口吻亲切自然，像一位热情的讲解员；'
    '内容准确，不确定时坦诚说明，不编造史实；'
    '每次回答控制在 120 字以内，可适当使用一个 emoji。'
)

def test(question, label):
    body = json.dumps({
        'model': 'Qwen/Qwen2.5-7B-Instruct',
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': question}
        ],
        'temperature': 0.7,
        'max_tokens': 512
    }).encode()

    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
    })

    print(f'\n{"="*50}')
    print(f'Test: {label}')
    print(f'Question: {question}')
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        elapsed = time.time() - t0
        data = json.loads(resp.read())
        print(f'Time: {elapsed:.1f}s  HTTP {resp.status}')
        print(f'Top keys: {list(data.keys())}')
        choice = data['choices'][0]
        msg = choice.get('message', {})
        content = msg.get('content', '')
        print(f'Message keys: {list(msg.keys())}')
        print(f'Content len: {len(content)}')
        print(f'Content: [{content[:200]}]')
        print(f'Finish: {choice.get("finish_reason")}')
        if 'reasoning_content' in msg:
            rc = msg.get('reasoning_content', '')
            print(f'REASONING len: {len(rc)}')
            print(f'REASONING: [{rc[:150]}]')
    except Exception as e:
        elapsed = time.time() - t0
        print(f'ERROR after {elapsed:.1f}s: {type(e).__name__}: {e}')
        if hasattr(e, 'read'):
            try:
                print(f'Body: {e.read().decode()[:300]}')
            except:
                pass

# 测试1: 正常问题
test('蓝染的原料是什么', 'Normal Hakka question')

# 测试2: 用户实际卡住的问题
test('唐朝有几个皇帝', 'Off-topic Tang Dynasty')

# 测试3: 非遗相关的边界问题
test('故宫在哪里', 'Off-topic Forbidden City')
