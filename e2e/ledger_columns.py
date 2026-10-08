"""
장부 표(PC 1366px)의 열마다 「정해 둔 폭」과 「1년치 실제 값이 필요로 하는 폭」을 잰다.
어느 열에 남는 폭이 있고 어느 열이 모자란지 보고 폭을 정하기 위한 것.
"""
from playwright.sync_api import sync_playwright

from common import BASE, PASSWORD, USERNAME, local_only

local_only('장부 열 폭 재기')

MEASURE_JS = r"""
() => {
  // canvas.measureText 는 font-variant-numeric(tabular-nums)을 모른다. 숫자 열이 실제보다 좁게 재져
  // 「여유 26px」인데 실제로는 잘리는 일이 생겼다. 같은 모양의 숨은 글자를 실제로 그려서 잰다.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre';
  document.body.appendChild(probe);
  const textWidth = (el, text) => {
    const st = getComputedStyle(el);
    probe.style.font = st.font;
    probe.style.fontVariantNumeric = st.fontVariantNumeric;
    probe.style.letterSpacing = st.letterSpacing;
    probe.textContent = text;
    return probe.getBoundingClientRect().width;
  };
  const padX = (el) => { const st = getComputedStyle(el); return parseFloat(st.paddingLeft) + parseFloat(st.paddingRight); };

  const heads = [...document.querySelectorAll('thead th')].map((th) => ({
    label: th.innerText.trim(), width: Math.round(th.getBoundingClientRect().width),
  }));
  // 머리글도 줄바꿈 없이 들어가야 하므로 출발점으로 삼는다
  const need = [...document.querySelectorAll('thead th')].map((th) => ({
    px: Math.ceil(textWidth(th, th.innerText.trim()) + padX(th) + 2), sample: `(머리글) ${th.innerText.trim()}`,
  }));

  for (const tr of document.querySelectorAll('tbody tr')) {
    [...tr.children].forEach((td, i) => {
      if (!need[i]) return;
      let px = 0, sample = '';
      const times = td.querySelectorAll('input[type=time]');
      const input = td.querySelector('input:not([type=time])');
      const select = td.querySelector('select');
      const link = td.querySelector('a');
      if (times.length) {
        // 크롬(한국어)은 시간을 「오후 12:30」 꼴로 그린다. 가장 긴 모양으로 잰다.
        const one = textWidth(times[0], '오후 12:30') + padX(times[0]);
        px = one * times.length + textWidth(td, ' ~ ') + padX(td);
        sample = '오후 12:30 ~ 오후 12:30';
      } else if (input) {
        sample = input.value;
        px = textWidth(input, input.value) + padX(input) + padX(td) + 2;
      } else if (select) {
        sample = select.selectedOptions[0]?.text ?? '';
        px = textWidth(select, sample) + padX(select) + padX(td) + 4;
      } else if (link) {
        sample = link.innerText.trim();
        px = textWidth(link, sample) + padX(link) + padX(td) + 2;
      } else {
        sample = td.innerText.trim();
        px = textWidth(td, sample) + padX(td) + 2;
      }
      if (px > need[i].px) need[i] = { px: Math.ceil(px), sample };
    });
  }

  const wrap = document.querySelector('table').parentElement;
  return {
    rows: document.querySelectorAll('tbody tr').length,
    containerWidth: wrap.clientWidth,
    tableWidth: Math.round(document.querySelector('table').getBoundingClientRect().width),
    columns: heads.map((h, i) => ({ ...h, need: need[i].px, slack: h.width - need[i].px, sample: need[i].sample })),
  };
}
"""


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
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900}, locale='ko-KR')
    page = ctx.new_page()
    login(page)
    api = page.request

    # 마지막 열(명세표 이름)도 재려면 발행본이 있어야 한다. 없으면 잠깐 만들고 끝에서 지운다.
    created = None
    if not api.get(BASE + '/api/statements').json():
        masters = api.get(BASE + '/api/masters').json()
        site = next(s for s in masters['sites'] if s['label'] == '아라(광장)')
        preview = api.get(f"{BASE}/api/statements/preview?clientId={site['client_id']}&siteId={site['id']}&from=2026-08-01&to=2026-08-31").json()
        ids = [l['work_log_id'] for l in preview['lines'] if l.get('issued_statement_id') is None][:3]
        created = api.post(BASE + '/api/statements', data={
            'company_id': site.get('company_id') or masters['companies'][0]['id'], 'client_id': site['client_id'],
            'site_id': site['id'], 'issue_date': '2026-08-31', 'period_start': '2026-08-01',
            'period_end': '2026-08-31', 'work_log_ids': ids, 'note': None,
        }).json()['id']

    try:
        page.goto(BASE + '/ledger?from=2026-01-01&to=2026-12-31')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(500)
        r = page.evaluate(MEASURE_JS)
        print(f"행 {r['rows']} · 표 {r['tableWidth']}px / 담는 상자 {r['containerWidth']}px (넘침 {r['tableWidth'] - r['containerWidth']}px)")
        for c in r['columns']:
            flag = '  ← 모자람' if c['slack'] < 0 else ''
            print(f"  {c['label'] or '(발행)':8s} 폭 {c['width']:4d} 필요 {c['need']:4d} 여유 {c['slack']:4d}  {c['sample'][:24]}{flag}")
    finally:
        if created:
            print(f'확인용 명세표 #{created} 삭제: {page.request.delete(f"{BASE}/api/statements/{created}").status}')
        browser.close()
