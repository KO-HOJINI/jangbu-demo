import { describe, expect, it } from 'vitest';
import { isTypingField } from '../src/lib/keyboardScroll';

// 휴대폰에서 키보드가 올라오는 칸만 화면 가운데로 민다
const el = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box.firstElementChild;
};

describe('키보드가 올라오는 칸인지', () => {
  it('글자·숫자·날짜 칸과 여러 줄 칸은 맞다', () => {
    expect(isTypingField(el('<input>'))).toBe(true);
    expect(isTypingField(el('<input type="search">'))).toBe(true);
    expect(isTypingField(el('<input type="number">'))).toBe(true);
    expect(isTypingField(el('<textarea></textarea>'))).toBe(true);
  });

  it('체크 칸·파일 고르기·단추·고르는 칸은 아니다', () => {
    expect(isTypingField(el('<input type="checkbox">'))).toBe(false);
    expect(isTypingField(el('<input type="file">'))).toBe(false);
    expect(isTypingField(el('<button></button>'))).toBe(false);
    expect(isTypingField(el('<select></select>'))).toBe(false);
    expect(isTypingField(null)).toBe(false);
  });
});
