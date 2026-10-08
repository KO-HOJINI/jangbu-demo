"""
부모님 기준 화면 점검 — PC(1366)와 휴대폰(390, 터치) 두 크기로 주요 화면을 열어
  1) 스크린샷
  2) 15px 보다 작은 글씨 (화면 글씨 템플릿의 가장 작은 크기)
  3) 배경 대비 4.5:1 이 안 되는 글씨
  4) 휴대폰에서 44px 보다 낮은 버튼·입력칸
을 잰다. 명세표·견적서 A4 양식(.statement-sheet) 안은 원본 PDF 를 따르므로 뺀다.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

from common import BASE, OUT, PASSWORD, USERNAME, local_only

local_only('화면 규칙 점검')

AUDIT_JS = r"""
() => {
  // Tailwind 4 는 색을 oklch 로 내보내므로 대비를 재려면 직접 sRGB 로 바꿔야 한다
  const toLinear = (c) => {
    const m = c.match(/^oklch\(([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/);
    if (m) {
      const L = m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
      const C = parseFloat(m[3]);
      const h = (parseFloat(m[4]) * Math.PI) / 180;
      const alpha = m[5] ? (m[5].endsWith('%') ? parseFloat(m[5]) / 100 : parseFloat(m[5])) : 1;
      const a = C * Math.cos(h), b = C * Math.sin(h);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      const s_ = L - 0.0894841775 * a - 1.291485548 * b;
      const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
      const clamp = (v) => Math.min(1, Math.max(0, v));
      return {
        rgb: [
          clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
          clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
          clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
        ],
        alpha,
      };
    }
    const r = c.match(/rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:,?\s*\/?\s*([\d.]+))?\)/);
    if (!r) return null;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return { rgb: [lin(+r[1]), lin(+r[2]), lin(+r[3])], alpha: r[4] != null ? +r[4] : 1 };
  };
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const background = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = toLinear(getComputedStyle(n).backgroundColor);
      if (c && c.alpha > 0.5) return c.rgb;
    }
    return [1, 1, 1];
  };

  const coarse = matchMedia('(pointer: coarse)').matches;
  // innerWidth 는 휴대폰이 넘친 내용을 보여주려고 축소하면 같이 커져서 넘침을 못 잡는다. 레이아웃 폭을 쓴다.
  const vw = document.documentElement.clientWidth;
  const small = [], faint = [], tiny = [], overflow = [], wrapped = [], clipped = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.statement-sheet')) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    // 글자 모양 장식(●, ~, ×)은 읽는 글이 아니라 뺀다
    if (ownText && /[가-힣A-Za-z0-9]/.test(ownText) && !el.closest('[disabled]')) {
      const size = parseFloat(st.fontSize);
      const label = ownText.slice(0, 24);
      if (size < 15) small.push(`${size}px「${label}」`);
      const fg = toLinear(st.color), bg = background(el);
      if (fg) {
        const [hi, lo] = [lum(fg.rgb), lum(bg)].sort((x, y) => y - x);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 4.5 && !seen.has(label)) { seen.add(label); faint.push(`${ratio.toFixed(2)}:1「${label}」`); }
      }
    }

    // 칸보다 글자가 길어 잘림 (「1,400,00」 같은). 일부러 말줄임(truncate) 한 곳은 뺀다.
    // 파일 선택 칸은 버튼 뒤에 1px 로 숨겨 두는 것이라(sr-only) 잘린 게 아니다
    const clipTarget = el.tagName === 'INPUT' ? !['date', 'time', 'checkbox', 'radio', 'file'].includes(el.type) : el.tagName === 'TD';
    if (clipTarget && el.clientWidth > 2 && !el.classList.contains('truncate') && el.scrollWidth > el.clientWidth + 1) {
      clipped.push(`${el.tagName.toLowerCase()} ${el.scrollWidth}>${el.clientWidth}「${(el.value || el.innerText || '').trim().slice(0, 16)}」`);
    }

    // 화면 밖으로 삐져나감. 부모는 안에 있는데 자기만 나간 것 = 원인이 되는 칸만 적는다.
    // 옆으로 밀어 보게 만든 표(overflow-x-auto) 안은 원래 그런 것이라 뺀다.
    const parentRight = el.parentElement ? el.parentElement.getBoundingClientRect().right : 0;
    if (rect.right > vw + 1 && parentRight <= vw + 1 && !el.closest('.overflow-x-auto')) {
      overflow.push(`${el.tagName.toLowerCase()} +${Math.round(rect.right - vw)}px「${(el.innerText || el.value || '').trim().slice(0, 16)}」`);
    }

    // 버튼 글자가 두 줄로 꺾임 (「발행하기 (0 / 건)」 같은)
    if (el.matches('button, .tap') && (el.innerText || '').trim()) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top / 6)));
      if (lines.size > 1) wrapped.push(`「${el.innerText.trim().replace(/\s+/g, ' ').slice(0, 20)}」`);
    }

    if (coarse && el.matches('button, select, input:not([type=checkbox]):not([type=radio]), .tap')) {
      if (rect.height < 43.5) tiny.push(`${Math.round(rect.height)}px ${el.tagName.toLowerCase()}「${(el.innerText || el.value || el.getAttribute('placeholder') || '').trim().slice(0, 16)}」`);
    }
  }
  return { coarse, small, faint, tiny, overflow, wrapped, clipped,
           // 옆으로 밀어야 끝이 보이는 표 (PC 에서는 없어야 한다)
           hscroll: [...document.querySelectorAll('.overflow-x-auto')]
             .map((e) => ({ over: e.scrollWidth - e.clientWidth, head: (e.querySelector('th')?.innerText || e.className).slice(0, 12) }))
             .filter((x) => x.over > 0),
           badge: document.querySelector('header a[title^="지금 함께 접속 중"]')?.innerText?.replace(/\s+/g, ' ') ?? null,
           pageOverflow: document.documentElement.scrollWidth - vw, fontFamily: getComputedStyle(document.body).fontFamily,
           pretendardLoaded: document.fonts.check('16px "Pretendard Variable"', '가') };
}
"""

report = {}
created_statement = None


def shoot(page, name, full=False):
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(OUT, f'{name}.png'), full_page=full)
    report[name] = page.evaluate(AUDIT_JS)


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

    # ── 확인용 발행 명세표가 없으면 하나 만든다 (끝에서 지운다) ──
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, locale='ko-KR')
    page = ctx.new_page()
    login(page)
    api = page.request
    statements = api.get(BASE + '/api/statements').json()
    if not statements:
        masters = api.get(BASE + '/api/masters').json()
        site = next(s for s in masters['sites'] if s['label'] == '아라(광장)')
        preview = api.get(f"{BASE}/api/statements/preview?clientId={site['client_id']}&siteId={site['id']}&from=2026-08-01&to=2026-08-31").json()
        ids = [l['work_log_id'] for l in preview['lines'] if l.get('issued_statement_id') is None][:3]
        company = site.get('company_id') or masters['companies'][0]['id']
        created_statement = api.post(BASE + '/api/statements', data={
            'company_id': company, 'client_id': site['client_id'], 'site_id': site['id'],
            'issue_date': '2026-08-31', 'period_start': '2026-08-01', 'period_end': '2026-08-31',
            'work_log_ids': ids, 'note': None,
        }).json()['id']
    first_site = api.get(BASE + '/api/sites').json()[0]['id']

    try:
        # ── PC ──
        # 다른 기기가 함께 접속한 상태를 만들어 위쪽 막대의 「n대 함께 접속 중」도 확인한다
        other = browser.new_context(locale='ko-KR')
        other_page = other.new_page()
        login(other_page)
        other_page.goto(BASE + '/sites'); other_page.wait_for_load_state('networkidle')
        page.goto(BASE + '/ledger?from=2026-08-01&to=2026-08-31'); shoot(page, 'pc-1-ledger')
        page.mouse.wheel(0, 900); page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, 'pc-1-ledger-table.png'))
        page.goto(BASE + '/sites'); shoot(page, 'pc-2-sites')
        page.goto(f'{BASE}/sites/{first_site}'); shoot(page, 'pc-3-site-detail')
        page.goto(BASE + '/statements'); shoot(page, 'pc-4-statements')
        page.goto(BASE + '/quotes'); shoot(page, 'pc-4b-quotes')
        page.goto(BASE + '/settings'); shoot(page, 'pc-5a-settings-company')
        page.get_by_role('button', name='거래처', exact=True).click(); shoot(page, 'pc-5b-settings-clients')
        page.goto(BASE + '/operators'); shoot(page, 'pc-5-operators')
        other.close()
        ctx.close()

        # ── 휴대폰 (터치 기기로 흉내 → pointer: coarse) ──
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True, locale='ko-KR')
        page = ctx.new_page()
        login(page)
        page.goto(BASE + '/ledger?from=2026-08-01&to=2026-08-31'); shoot(page, 'mo-1-ledger')
        card = page.get_by_text('명세표', exact=False).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
        issued = page.locator('a[href^="/statements/"]').first
        if issued.count():
            issued.scroll_into_view_if_needed(); page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(OUT, 'mo-1-ledger-issued-card.png'))
        page.goto(BASE + '/sites'); shoot(page, 'mo-2-sites')
        page.goto(BASE + '/statements'); shoot(page, 'mo-4-statements')
        page.goto(BASE + '/quotes'); shoot(page, 'mo-4b-quotes')
        page.goto(BASE + '/settings'); shoot(page, 'mo-5-settings-tabs')
        page.get_by_role('button', name='거래처', exact=True).click(); shoot(page, 'mo-5b-settings-clients')
        page.goto(BASE + '/operators'); shoot(page, 'mo-5-operators')
        page.goto(BASE + '/settings')
        page.get_by_role('button', name='계정').click(); shoot(page, 'mo-6-settings-account')
        ctx.close()
    finally:
        if created_statement:
            ctx = browser.new_context(); page = ctx.new_page(); login(page)
            r = page.request.delete(f'{BASE}/api/statements/{created_statement}')
            print(f'확인용 명세표 #{created_statement} 삭제: {r.status}')
            ctx.close()
        browser.close()

print(json.dumps(report, ensure_ascii=False, indent=1))
