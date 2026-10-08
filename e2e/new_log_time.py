"""「새 작업 추가」 작업시간 칸: 값을 넣고 PC·휴대폰에서 잘리지 않는지, 대충 적은 값이 맞춰지는지."""
import os
import sys

from playwright.sync_api import sync_playwright

from common import BASE, OUT, PASSWORD, USERNAME
ok_all = True


def check(name, ok, detail=''):
    global ok_all
    ok_all &= ok
    print(('  ✓ ' if ok else '  ✗ ') + name + (f'  ({detail})' if detail else ''))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for label, opts in [
        ('PC 1366', dict(viewport={'width': 1366, 'height': 900})),
        ('PC 1920', dict(viewport={'width': 1920, 'height': 1000})),
        ('휴대폰 390', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)),
    ]:
        print(f'[{label}]')
        ctx = browser.new_context(locale='ko-KR', **opts)
        page = ctx.new_page()
        page.goto(BASE + '/')
        page.wait_for_load_state('networkidle')
        if page.locator('input[type=password]').count():
            page.locator('input[type=text]').first.fill(USERNAME)
            page.locator('input[type=password]').fill(PASSWORD)
            page.get_by_role('button', name='로그인').click()
            page.wait_for_selector('nav')
        page.goto(BASE + '/ledger')
        page.wait_for_load_state('networkidle')

        # 휴대폰에서는 칸들이 접혀 있다
        opener = page.get_by_role('button', name='직접 적기')
        if opener.is_visible():
            opener.click()
        field = page.get_by_placeholder('07:00~17:00').first
        check('시간 칸이 한 칸짜리 글자 칸', field.get_attribute('type') in (None, 'text'))
        field.fill('7~17')
        field.blur()
        page.wait_for_timeout(150)
        check('「7~17」 → 「07:00~17:00」 으로 맞춰짐', field.input_value() == '07:00~17:00', field.input_value())
        size = field.evaluate('(el) => ({ scroll: el.scrollWidth, client: el.clientWidth })')
        check('값이 칸 안에 다 보임', size['scroll'] <= size['client'] + 1, f"{size['scroll']} / {size['client']}px")

        section = page.locator('section').filter(has_text='새 작업 추가').first
        section.screenshot(path=os.path.join(OUT, f"newlog-{label.replace(' ', '')}.png"))
        ctx.close()
    browser.close()

print('모두 통과' if ok_all else '실패 있음')
sys.exit(0 if ok_all else 1)
