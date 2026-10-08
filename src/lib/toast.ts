/**
 * 화면 아래에 잠깐 뜨는 알림. 어디서 불러도 App 의 <Toaster /> 가 보여준다.
 * 칸을 고치면 저절로 저장되는데, 줄이 잠깐 초록으로 물드는 것만으로는 부모님이 알아채기 어려웠다.
 */
export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent<string>('jangbu:toast', { detail: message }));
}

export const SAVED = '✓ 저장되었습니다';
