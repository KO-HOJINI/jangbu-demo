import type { User } from '../shared/types';

/** 워커 전역에서 쓰는 Hono 환경 타입 */
export type AppEnv = {
  Bindings: Env;
  Variables: { user: User };
};
