import urllib.request, json

url = 'https://api.siliconflow.cn/v1/chat/completions'
key = 'sk-jsaoktfuiypfrnmxfvkgajxebnchopabyzurvnuugqvngdvh'

# 模拟浏览器 CORS 预检请求 (OPTIONS)
req = urllib.request.Request(url, method='OPTIONS', headers={
    'Origin': 'https://lwy9107124035.github.io',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type,Authorization'
})
try:
    resp = urllib.request.urlopen(req, timeout=10)
    print('=== CORS Preflight (OPTIONS) ===')
    for k, v in resp.headers.items():
        if 'access-control' in k.lower() or 'cors' in k.lower():
            print(f'  {k}: {v}')
    print(f'  Status: {resp.status}')
except Exception as e:
    print(f'CORS preflight error: {e}')
    if hasattr(e, 'headers'):
        for k, v in e.headers.items():
            if 'access-control' in k.lower():
                print(f'  {k}: {v}')

# 测试可用模型列表
print('\n=== Testing available models ===')
models_url = 'https://api.siliconflow.cn/v1/models'
req2 = urllib.request.Request(models_url, headers={'Authorization': 'Bearer ' + key})
try:
    resp2 = urllib.request.urlopen(req2, timeout=10)
    data = json.loads(resp2.read())
    models = [m['id'] for m in data.get('data', [])]
    # 查找关键模型
    for kw in ['Qwen2.5', 'DeepSeek', 'qwen', 'deepseek']:
        matches = [m for m in models if kw.lower() in m.lower()]
        if matches:
            print(f'  {kw}: {matches[:5]}')
    print(f'  Total models: {len(models)}')
except Exception as e:
    print(f'Models list error: {e}')

# 测试 DeepSeek-V3
print('\n=== Test DeepSeek-V3 ===')
for model_id in ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct']:
    body = json.dumps({
        'model': model_id,
        'messages': [
            {'role': 'user', 'content': '唐朝有几个皇帝'}
        ],
        'max_tokens': 100
    }).encode()
    req3 = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
    })
    try:
        import time
        t0 = time.time()
        resp3 = urllib.request.urlopen(req3, timeout=20)
        data3 = json.loads(resp3.read())
        content = data3['choices'][0]['message']['content']
        print(f'  {model_id}: OK in {time.time()-t0:.1f}s, len={len(content)}')
        print(f'    -> {content[:80]}')
    except Exception as e:
        print(f'  {model_id}: FAIL - {e}')
