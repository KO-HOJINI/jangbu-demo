"""
도장 올리기 + 확인.
  BASE 환경변수로 대상 서버를 고른다 (기본: 로컬 개발 서버).
  UPLOAD_ONLY=1 이면 올리기와 권한 확인만 하고 끝낸다 (실서버용).

  1) STAMP_DIR 이 있으면 그 폴더의 stamp-hangang.png·stamp-geumgang.png 를 올리고, 없으면 도장이 올라가 있는지만 본다
  2) 로그인 없이 도장 주소를 부르면 막히는지, 로그인하면 PNG 가 오는지
  3) 회사별로 임시 명세표를 하나씩 만들어 인쇄(PDF)해 보고, 한 장인지·성명 칸을 잘라 저장
  4) 견적서(작성 중)와 설정 → 내 회사 화면도 찍어 둔다
  끝나면 임시 명세표는 지운다.
"""
import base64
import json
import os
import sys

import pymupdf
from playwright.sync_api import sync_playwright

from common import BASE, OUT, PASSWORD, USERNAME, local_only

UPLOAD_ONLY = os.environ.get('UPLOAD_ONLY') == '1'
# 도장 그림은 저장소에 두지 않는다. 새로 올릴 때만 그림이 든 폴더를 STAMP_DIR 로 알려 준다.
STAMP_DIR = os.environ.get('STAMP_DIR')
STAMPS = {'한강중기': 'stamp-hangang.png', '금강중기': 'stamp-geumgang.png'}

results = []
def check(name, ok, detail=''):
    results.append(ok)
    print(('  ✓ ' if ok else '  ✗ ') + name + (f'  ({detail})' if detail else ''))


def login(page):
    page.goto(BASE + '/')
    page.wait_for_load_state('networkidle')
    if page.locator('input[type=password]').count():
        page.locator('input[type=text]').first.fill(USERNAME)
        page.locator('input[type=password]').fill(PASSWORD)
        page.get_by_role('button', name='로그인').click()
        page.wait_for_selector('nav')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 1000}, locale='ko-KR')
    page = ctx.new_page()
    login(page)
    api = page.request

    masters = api.get(BASE + '/api/masters').json()
    companies = {}
    print('[1] 도장')
    for prefix, filename in STAMPS.items():
        company = next(c for c in masters['companies'] if c['name'].startswith(prefix))
        companies[prefix] = company
        if STAMP_DIR:
            png = base64.b64encode(open(os.path.join(STAMP_DIR, filename), 'rb').read()).decode()
            r = api.put(f"{BASE}/api/companies/{company['id']}/stamp", data={'png': png})
            check(f"{company['name']} ({company['ceo_name']}) 도장 올리기", r.status == 200, f'{r.status} {r.text()[:80]}')
        else:
            check(f"{company['name']} ({company['ceo_name']}) 도장이 올라가 있다", bool(company.get('stamp_updated_at')))

    print('[2] 도장은 로그인한 사람만')
    anon = browser.new_context()
    first_id = companies['한강중기']['id']
    r = anon.request.get(f'{BASE}/api/companies/{first_id}/stamp')
    check('로그인 없이 부르면 막힌다', r.status == 401, str(r.status))
    anon.close()
    r = api.get(f'{BASE}/api/companies/{first_id}/stamp')
    check('로그인하면 PNG 가 온다', r.status == 200 and r.headers.get('content-type') == 'image/png' and r.body()[:4] == b'\x89PNG', f"{r.status} {r.headers.get('content-type')} {len(r.body())}B")
    check('캐시는 이 사람 브라우저에만 (private)', 'private' in (r.headers.get('cache-control') or ''), r.headers.get('cache-control'))
    bad = api.put(f'{BASE}/api/companies/{first_id}/stamp', data={'png': base64.b64encode(b'GIF89a not a png').decode()})
    check('PNG 가 아니면 거절', bad.status == 400, str(bad.status))
    masters = api.get(BASE + '/api/masters').json()
    check('목록에는 그림 없이 바꾼 시각만', all(c.get('stamp_updated_at') for c in masters['companies'] if c['name'][:4] in STAMPS) and 'png' not in json.dumps(masters['companies']))

    if UPLOAD_ONLY:
        browser.close()
        print('\n' + ('모두 통과' if all(results) else '실패 있음'))
        sys.exit(0 if all(results) else 1)

    local_only('명세표 인쇄 확인')
    print('[3] 명세표 인쇄에 찍히는지')
    site = next(s for s in masters['sites'] if s['label'] == '아라(광장)')
    preview = api.get(f"{BASE}/api/statements/preview?clientId={site['client_id']}&siteId={site['id']}&from=2026-08-01&to=2026-08-31").json()
    free = [l['work_log_id'] for l in preview['lines'] if l.get('issued_statement_id') is None]
    created = []
    try:
        for i, (prefix, company) in enumerate(companies.items()):
            ids = free[i * 2:i * 2 + 2]
            sid = api.post(BASE + '/api/statements', data={
                'company_id': company['id'], 'client_id': site['client_id'], 'site_id': site['id'],
                'issue_date': '2026-08-31', 'period_start': '2026-08-01', 'period_end': '2026-08-31',
                'work_log_ids': ids, 'note': None,
            }).json()['id']
            created.append(sid)

            page.goto(f'{BASE}/statements/{sid}')
            page.wait_for_load_state('networkidle')
            img = page.locator('.statement-sheet img').first
            img.wait_for()
            loaded = page.evaluate("() => { const i = document.querySelector('.statement-sheet img'); return i && i.complete && i.naturalWidth > 0; }")
            check(f'{prefix}: 화면 명세표에 도장 그림이 뜬다', loaded)
            box = page.evaluate("""() => {
              const img = document.querySelector('.statement-sheet img').getBoundingClientRect();
              const inn = [...document.querySelectorAll('.statement-sheet span')].find(s => s.firstChild && s.firstChild.textContent.trim() === '(인)').getBoundingClientRect();
              return { dx: Math.abs((img.left + img.width / 2) - (inn.left + inn.width / 2)), dy: Math.abs((img.top + img.height / 2) - (inn.top + inn.height / 2)), w: img.width };
            }""")
            check(f'{prefix}: 도장 가운데가 (인) 가운데에', box['dx'] < 1.5 and box['dy'] < 1.5, f"어긋남 {box['dx']:.1f}, {box['dy']:.1f}px / 지름 {box['w']:.0f}px")

            page.emulate_media(media='print')
            pdf_path = os.path.join(OUT, f'statement-{prefix}.pdf')
            page.pdf(path=pdf_path, format='A4', print_background=True, prefer_css_page_size=True)
            page.emulate_media(media='screen')
            doc = pymupdf.open(pdf_path)
            check(f'{prefix}: 인쇄하면 A4 한 장', doc.page_count == 1, f'{doc.page_count}장')
            pg = doc[0]
            check(f'{prefix}: 인쇄물 안에 도장 그림이 있다', len(pg.get_images()) >= 1, f'그림 {len(pg.get_images())}개')
            r = pg.rect
            pg.get_pixmap(dpi=300, clip=pymupdf.Rect(r.width * 0.40, 0, r.width, r.height * 0.30)).save(os.path.join(OUT, f'statement-{prefix}-supplier.png'))
            pg.get_pixmap(dpi=80).save(os.path.join(OUT, f'statement-{prefix}-page.png'))

        print('[4] 견적서·설정 화면')
        page.goto(BASE + '/quotes')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)
        has = page.evaluate("() => { const i = document.querySelector('.statement-sheet img'); return !!(i && i.complete && i.naturalWidth); }")
        check('견적서(작성 중)에도 도장이 뜬다', has)
        sheet = page.locator('.statement-sheet').first
        sheet.screenshot(path=os.path.join(OUT, 'quote-sheet.png'))

        page.goto(BASE + '/settings')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(OUT, 'settings-company.png'), full_page=True)
        check('설정 → 내 회사에 도장 두 개가 보인다', page.locator('img[alt$="도장"]').count() == 2)
    finally:
        for sid in created:
            print(f'  임시 명세표 #{sid} 삭제: {api.delete(f"{BASE}/api/statements/{sid}").status}')
        browser.close()

print('\n' + ('모두 통과' if all(results) else '실패 있음'))
sys.exit(0 if all(results) else 1)
