"""audit.py 출력(JSON)을 화면별 한 줄로 요약한다."""
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
text = sys.stdin.buffer.read().decode('utf-8', errors='replace')
m = re.search(r'^\{.*^\}', text, re.S | re.M)
if not m:
    print(text[-4000:])
    sys.exit(1)

report = json.loads(m.group(0))
total = 0
for name, v in report.items():
    problems = {
        '작은글씨': v['small'],
        '옅은글씨': v['faint'],
        '작은버튼': v['tiny'],
        '화면밖': v['overflow'],
        '꺾인버튼': v['wrapped'],
        '잘린칸': v['clipped'],
    }
    # 휴대폰에서는 넓은 표를 옆으로 미는 게 원래 설계라 PC 만 문제로 센다
    if name.startswith('pc-'):
        problems['옆스크롤'] = [f"{h['head']} +{h['over']}px" for h in v['hscroll']]
    if v['pageOverflow'] > 0:
        problems['페이지폭'] = [f"+{v['pageOverflow']}px"]

    count = sum(len(x) for x in problems.values())
    total += count
    flags = '  '.join(f'{k} {len(x)}' for k, x in problems.items() if x)
    print(f"{'✓' if not count else '✗'} {name:26s} Pretendard={'O' if v['pretendardLoaded'] else 'X'}  배지={v['badge']!r}  {flags}")
    for k, x in problems.items():
        for item in x[:4]:
            print(f'      {k}: {item}')
        if len(x) > 4:
            print(f'      {k}: … 외 {len(x) - 4}개')

for line in text.splitlines():
    if '확인용 명세표' in line:
        print(line)
print(f'\n문제 {total}건')
