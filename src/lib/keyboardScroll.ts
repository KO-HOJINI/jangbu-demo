/**
 * 휴대폰에서 칸을 눌러 키보드가 올라오면, 누른 칸이 키보드에 가리지 않게 화면 가운데로 민다.
 *
 * 브라우저가 알아서 밀어 주기도 하지만 위에 붙은 메뉴나 축소된 명세표 양식 안의 칸은
 * 키보드 바로 위에 걸리거나 가려진 채로 남는 일이 있었다.
 * 키보드는 누른 뒤 0.3초쯤 걸려 올라오므로, 올라온 뒤(보이는 화면 높이가 바뀐 뒤)에 한 번 더 민다.
 */
const TYPING = 'input, textarea, [contenteditable="true"]';
/** 글자를 치지 않는 칸 — 키보드가 올라오지 않으니 건드리지 않는다 */
const NOT_TYPING = new Set(['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color']);

export function isTypingField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.matches(TYPING)) return false;
  return !(el instanceof HTMLInputElement && NOT_TYPING.has(el.type));
}

export function keepFocusedFieldVisible() {
  // 마우스로 쓰는 PC 는 키보드가 화면을 가리지 않는다
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  const show = () => {
    const el = document.activeElement;
    if (isTypingField(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  document.addEventListener('focusin', (e) => {
    if (isTypingField(e.target as Element)) setTimeout(show, 300);
  });
  // 키보드가 올라오거나 내려가면 보이는 화면 높이가 바뀐다
  window.visualViewport?.addEventListener('resize', show);
}
