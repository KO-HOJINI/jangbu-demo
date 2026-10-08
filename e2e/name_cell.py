"""
성명 칸 치수 재기 — 명세표(발행본·작성 중)와 견적서(작성 중)에서, 화면과 인쇄 모드 둘 다.
  줄 높이, 칸 너비, 이름 입력칸 너비(내용 대비), (인) 위치, 도장 지름과 칸 밖으로 나간 정도를 mm 로 낸다.
"""
import json
import sys

from playwright.sync_api import sync_playwright

from common import BASE, PASSWORD, USERNAME, local_only

local_only('성명 칸 치수 재기')

MEASURE = r"""
() => {
  const px2mm = (v) => Math.round((v * 25.4 / 96) * 10) / 10;
  const out = [];
  for (const sheet of document.querySelectorAll('.statement-sheet')) {
    const inn = [...sheet.querySelectorAll('span')].find((s) => s.firstChild && s.firstChild.textContent.trim() === '(인)');
    if (!inn) continue;
    const td = inn.closest('td');
    const tr = td.closest('tr');
    const input = td.querySelector('input');
    const nameEl = input || td.querySelector('span > span');
    const img = td.querySelector('img');
    const tdR = td.getBoundingClientRect(), trR = tr.getBoundingClientRect(), innR = inn.getBoundingClientRect();
    const imgR = img ? img.getBoundingClientRect() : null;
    const table = td.closest('table').getBoundingClientRect();
    // 이름 글자 자체의 폭 (입력칸이면 같은 글꼴로 그려서 잰다)
    let textW = null;
    if (input) {
      const probe = document.createElement('span');
      const st = getComputedStyle(input);
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
      probe.style.font = st.font;
      probe.textContent = input.value;
      document.body.appendChild(probe);
      textW = probe.getBoundingClientRect().width;
      probe.remove();
    }
    // 도장이 다른 칸의 글자를 덮는지 — 글자 하나하나의 상자와 도장 원이 겹치는지 본다
    const covered = [];
    if (imgR) {
      const cx = imgR.left + imgR.width / 2, cy = imgR.top + imgR.height / 2, radius = imgR.width / 2 * 0.92;
      for (const other of sheet.querySelectorAll('td')) {
        if (other === td) continue;
        const walker = document.createTreeWalker(other, NodeFilter.SHOW_TEXT);
        const texts = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
        for (const input of other.querySelectorAll('input, textarea, select')) texts.push(input);
        for (const node of texts) {
          const rects = node.nodeType === 3
            ? (() => { const r = document.createRange(); r.selectNodeContents(node); return [...r.getClientRects()]; })()
            : [node.getBoundingClientRect()];
          for (const r of rects) {
            if (!r.width || !r.height) continue;
            const nx = Math.max(r.left, Math.min(cx, r.right)), ny = Math.max(r.top, Math.min(cy, r.bottom));
            if ((nx - cx) ** 2 + (ny - cy) ** 2 < radius ** 2) {
              covered.push((node.textContent || node.value || '').trim().slice(0, 10));
            }
          }
        }
      }
    }
    const sheetText = sheet.querySelector('td').innerText.trim().slice(0, 6);
    out.push({
      sheet: sheetText,
      rowHeight: px2mm(trR.height),
      cellWidth: px2mm(tdR.width),
      fieldSizing: input ? getComputedStyle(input).fieldSizing : null,
      inputWidth: input ? px2mm(input.getBoundingClientRect().width) : null,
      nameTextWidth: textW != null ? px2mm(textW) : null,
      gapNameToIn: px2mm(innR.left - (nameEl ? nameEl.getBoundingClientRect().right : tdR.left)),
      inCenterFromCellRight: px2mm(tdR.right - (innR.left + innR.width / 2)),
      stampDiameter: imgR ? px2mm(imgR.width) : null,
      stampOverTop: imgR ? px2mm(Math.max(0, trR.top - imgR.top)) : null,
      stampOverBottom: imgR ? px2mm(Math.max(0, imgR.bottom - trR.bottom)) : null,
      stampOverRight: imgR ? px2mm(Math.max(0, imgR.right - tdR.right)) : null,
      stampOverTableRight: imgR ? px2mm(Math.max(0, imgR.right - table.right)) : null,
      coversOtherText: [...new Set(covered.filter(Boolean))],
      fontSize: getComputedStyle(td).fontSize,
    });
  }
  return out;
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
    ctx = browser.new_context(viewport={'width': 1280, 'height': 1000}, locale='ko-KR')
    page = ctx.new_page()
    login(page)
    api = page.request
    masters = api.get(BASE + '/api/masters').json()
    geumgang = next(c for c in masters['companies'] if c['name'].startswith('금강'))
    site = next(s for s in masters['sites'] if s['label'] == '아라(광장)')
    preview = api.get(f"{BASE}/api/statements/preview?clientId={site['client_id']}&siteId={site['id']}&from=2026-08-01&to=2026-08-31").json()
    ids = [l['work_log_id'] for l in preview['lines'] if l.get('issued_statement_id') is None][:2]
    sid = api.post(BASE + '/api/statements', data={
        'company_id': geumgang['id'], 'client_id': site['client_id'], 'site_id': site['id'],
        'issue_date': '2026-08-31', 'period_start': '2026-08-01', 'period_end': '2026-08-31',
        'work_log_ids': ids, 'note': None,
    }).json()['id']

    try:
        for label, url in [('명세표 발행본', f'/statements/{sid}'), ('명세표 작성 중', '/statements'), ('견적서 작성 중', '/quotes')]:
            page.goto(BASE + url)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(700)
            for media in ('screen', 'print'):
                page.emulate_media(media=media)
                page.wait_for_timeout(200)
                for m in page.evaluate(MEASURE):
                    print(f'[{label} · {media}]', json.dumps(m, ensure_ascii=False))
            page.emulate_media(media='screen')
    finally:
        print('임시 명세표 삭제:', api.delete(f'{BASE}/api/statements/{sid}').status)
        browser.close()
