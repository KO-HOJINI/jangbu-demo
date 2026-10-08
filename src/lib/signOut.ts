import { api } from './api';

/**
 * 로그아웃. 서버에서 로그인을 끊은 뒤 화면을 처음부터 다시 연다.
 * 예전에는 받아 둔 자료만 비웠는데(queryClient.clear), 그것만으로는 화면이 다시 그려지지 않아
 * 눌러도 그대로 머무는 일이 있었다. 다시 열면 받아 둔 장부도 남지 않는다.
 *
 * 잘못 눌러 나가지 않게 먼저 묻는다 (다시 들어오려면 비밀번호를 쳐야 한다).
 */
export function signOut() {
  if (!window.confirm('로그아웃할까요?')) return Promise.resolve();
  return api
    .logout()
    .catch(() => {})
    .finally(() => window.location.replace('/'));
}
