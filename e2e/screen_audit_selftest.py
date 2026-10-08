"""점검기 자체 검사 — 일부러 문제를 넣은 화면에서 정확히 그것만 잡는지 본다."""
import json
import os
import sys

from playwright.sync_api import sync_playwright

# Windows 기본(cp949)으로는 ✓ 같은 글자를 못 찍는다
sys.stdout.reconfigure(encoding='utf-8')

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screen_audit.py'), encoding='utf-8').read()
AUDIT_JS = src.split('AUDIT_JS = r"""')[1].split('"""')[0]

# Tailwind 4 가 실제로 내보내는 oklch 값 그대로 (slate-400 / slate-600 / white)
HTML = """
<meta name="viewport" content="width=device-width, initial-scale=1">
<body style="margin:0;background:oklch(98.4% 0.003 247.858)">
  <p style="font-size:12px;color:oklch(55.4% 0.046 257.417)">작은글씨12</p>
  <p style="font-size:15px;color:oklch(70.4% 0.04 256.788)">옅은글씨400</p>
  <p style="font-size:15px;color:oklch(44.6% 0.043 257.281)">진한글씨600</p>
  <p style="font-size:15px;color:rgb(148,163,184)">옅은rgb</p>
  <button style="font-size:15px;height:24px;padding:0 8px">작은버튼</button>
  <button class="big" style="font-size:15px;padding:12px 16px">큰버튼</button>
  <div style="width:600px">넘치는상자</div>
  <div class="overflow-x-auto" style="width:300px"><div style="width:900px">표안넓음</div></div>
  <button style="width:80px;font-size:15px">줄바꿈되는 긴 버튼 글자</button>
  <input style="width:60px;font-size:15px" value="1,400,000,000">
  <input style="width:200px;font-size:15px" value="짧음">
  <table style="table-layout:fixed;width:120px"><tr><td style="width:40px;white-space:nowrap">아주아주긴표칸글자</td><td>ok</td></tr></table>
  <div class="statement-sheet"><p style="font-size:10px;color:#bbb">양식안글씨</p><button style="height:20px">양식버튼</button></div>
</body>
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.set_content(HTML)
    r = page.evaluate(AUDIT_JS)
    browser.close()

print(json.dumps({k: r[k] for k in ('coarse', 'small', 'faint', 'tiny', 'overflow', 'wrapped', 'clipped')}, ensure_ascii=False, indent=1))

checks = [
    ('터치 기기로 인식', r['coarse'] is True),
    ('12px 글씨를 잡음', any('작은글씨12' in s for s in r['small'])),
    ('작은 글씨는 그것 하나만', len(r['small']) == 1),
    ('oklch slate-400 옅은 글씨를 잡음', any('옅은글씨400' in s for s in r['faint'])),
    ('rgb 옅은 글씨도 잡음', any('옅은rgb' in s for s in r['faint'])),
    ('slate-600 은 통과', not any('진한글씨600' in s for s in r['faint'])),
    ('24px 버튼을 잡음', any('작은버튼' in s for s in r['tiny'])),
    ('큰 버튼은 통과', not any('큰버튼' in s for s in r['tiny'])),
    ('명세표 양식 안은 제외', not any('양식' in s for s in r['small'] + r['faint'] + r['tiny'])),
    ('화면 밖으로 넘친 상자를 잡음', any('넘치는상자' in s for s in r['overflow'])),
    ('옆으로 미는 표 안은 제외', not any('표안넓음' in s for s in r['overflow'])),
    ('두 줄로 꺾인 버튼을 잡음', any('줄바꿈되는' in s for s in r['wrapped'])),
    ('한 줄 버튼은 통과', not any('큰버튼' in s or '작은버튼' in s for s in r['wrapped'])),
    ('잘린 금액 입력칸을 잡음', any('1,400,000,000' in s for s in r['clipped'])),
    ('잘린 표 칸을 잡음', any('아주아주긴' in s for s in r['clipped'])),
    ('넉넉한 칸은 통과', not any('짧음' in s or 'ok' in s for s in r['clipped'])),
]
for name, ok in checks:
    print(('  ✓ ' if ok else '  ✗ ') + name)
print('점검기 정상' if all(ok for _, ok in checks) else '점검기에 문제 있음')
