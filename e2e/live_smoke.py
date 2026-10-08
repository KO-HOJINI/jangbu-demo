"""
실서버 연기 점검 — 자료를 바꾸지 않고 둘러보기만 한다.

  모든 화면을 PC·휴대폰 크기로 열어
    - 보안 헤더(CSP 등)가 붙었는지
    - 그 헤더 때문에 막힌 게 없는지 (콘솔의 Content Security Policy 위반, 스크립트 오류, 실패한 요청)
    - 글꼴(Pretendard)·도장 그림이 뜨는지
    - 장부 「엑셀로 내보내기」 파일이 받아지는지
  를 본다. 끝나면 로그아웃해서 접속 기록을 남기지 않는다.

  남기는 흔적: 둘러보는 동안 「접속 중인 기기」에 잠깐 뜬다. 임시저장·장부는 건드리지 않는다.

  BASE=https://example.workers.dev JANGBU_PASSWORD=... python e2e/live_smoke.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

from common import BASE, OUT, PASSWORD, USERNAME

EXPECTED_HEADERS = [
    'content-security-policy',
    'x-frame-options',
    'x-content-type-options',
    'referrer-policy',
    'strict-transport-security',
]
PAGES = ['/ledger', '/sites', '/statements', '/quotes', '/settings']

ok_all = True


def check(name, ok, detail=''):
    global ok_all
    ok_all &= bool(ok)
    print(('  ✓ ' if ok else '  ✗ ') + name + (f'  ({detail})' if detail else ''))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for label, opts in [
        ('PC', dict(viewport={'width': 1366, 'height': 900})),
        ('휴대폰', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)),
    ]:
        print(f'[{label}]')
        ctx = browser.new_context(locale='ko-KR', accept_downloads=True, **opts)
        page = ctx.new_page()
        problems = []
        page.on('console', lambda m: problems.append(f'콘솔 {m.type}: {m.text[:140]}') if m.type in ('error', 'warning') and ('Content Security Policy' in m.text or m.type == 'error') else None)
        page.on('pageerror', lambda e: problems.append(f'스크립트 오류: {str(e)[:140]}'))
        page.on('requestfailed', lambda r: problems.append(f'요청 실패: {r.url[-60:]} {r.failure}') if 'ERR_ABORTED' not in (r.failure or '') else None)

        first = page.goto(BASE + '/')
        headers = first.headers if first else {}
        missing = [h for h in EXPECTED_HEADERS if h not in headers]
        check('첫 화면에 보안 헤더', not missing, '빠짐: ' + ', '.join(missing) if missing else 'CSP·프레임·nosniff·리퍼러·HSTS')

        page.wait_for_load_state('networkidle')
        if page.locator('input[type=password]').count():
            page.locator('input[type=text]').first.fill(USERNAME)
            page.locator('input[type=password]').fill(PASSWORD)
            page.get_by_role('button', name='로그인').click()
            page.wait_for_selector('nav')

        api = page.request.get(BASE + '/api/auth/me')
        check('API 응답에도 보안 헤더', 'x-content-type-options' in api.headers and 'x-frame-options' in api.headers,
              f"nosniff={api.headers.get('x-content-type-options')} frame={api.headers.get('x-frame-options')}")

        for path in PAGES:
            before = len(problems)
            page.goto(BASE + path)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(600)
            new = problems[before:]
            check(f'{path} 막힌 것 없음', not new, '; '.join(new[:3]))

        page.goto(BASE + '/settings')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(600)
        check('글꼴 Pretendard', page.evaluate("() => document.fonts.check('16px \"Pretendard Variable\"', '가')"))
        stamps = page.evaluate("() => [...document.querySelectorAll('img[alt$=\"도장\"]')].map(i => i.complete && i.naturalWidth > 0)")
        check('설정의 도장 그림이 뜬다', stamps and all(stamps), f'{sum(stamps)}/{len(stamps)}')

        if label == 'PC':
            page.goto(BASE + '/ledger?from=2026-01-01&to=2026-12-31')
            page.wait_for_load_state('networkidle')
            try:
                with page.expect_download(timeout=10_000) as info:
                    page.get_by_role('button', name='엑셀로 내보내기').click()
                d = info.value
                path = os.path.join(OUT, 'live-smoke-' + d.suggested_filename)
                d.save_as(path)
                size = os.path.getsize(path)
                with open(path, 'rb') as f:
                    zip_magic = f.read(2) == b'PK'
                os.remove(path)  # 장부 내용이 담긴 파일이라 확인만 하고 지운다
                check('장부 엑셀로 내보내기', size > 1000 and zip_magic, f'{d.suggested_filename} {size // 1024}KB')
            except Exception as e:  # noqa: BLE001
                check('장부 엑셀로 내보내기', False, str(e)[:120])

        out = page.request.post(BASE + '/api/auth/logout')
        print(f'  (점검용 로그인 정리: {out.status})')
        ctx.close()

    browser.close()

print('모두 통과' if ok_all else '실패 있음')
sys.exit(0 if ok_all else 1)
