import { Hono } from 'hono';
import type { AppEnv } from '../types';

/**
 * 수기 장부 사진 읽기.
 *
 * 사진을 그림 읽는 모델에 보내, 적힌 작업 줄을 JSON 으로 받는다.
 * Gemini 키(GEMINI_API_KEY)가 있으면 Gemini 를 먼저 쓰고, 없거나 실패하면 Cloudflare Workers AI(무료 한도)로 읽는다.
 * 여기서는 읽기만 한다 — 현장·기사님 맞추기, 이미 있는 기록 가리기, 장부에 올리기는 화면이
 * 부모님께 보여 드리고 확인받은 뒤에 한다 (src/lib/photoLog.ts). 손글씨라 틀릴 수 있기 때문이다.
 */
const photoLogs = new Hono<AppEnv>();

/**
 * 무료로 쓸 수 있고 그림을 읽는 모델. 2026-10-01 아주 악필인 공책 두 장으로 견줘 봄 (칸 정확도):
 *   Qwen 3.8 27B, 생각하기 끔  — 84~91%, 12~19초  → 먼저 쓴다
 *   Llama 4 Scout             — 64~69%, 5~9초    → Qwen 이 못 읽으면
 *   Qwen 3.8 27B, 생각하기 켬  — 93%, 55~80초     → 「더 꼼꼼히 다시 읽기」
 *   (Mistral Small 3.1 은 64%, Gemma 4 는 시간 칸을 다 비웠다. GLM·Kimi 는 유료 요금제에서만 된다)
 *
 * 2026-10-04 실제 확인서 네 장으로 다시 견줌 (맞은 칸 / 30칸):
 *   Qwen 3.8 27B 생각 끔 23~25, 생각 조금(reasoning_effort low) 24 인데 10~28초, Gemma 4 는 13, Llama 4 Scout 는 13.
 *   Moondream 3.1 은 빈 답만 돌려주고, GLM 5.3 Flash·Kimi K2.6 은 여전히 유료 요금제에서만 된다.
 *   견주기만으로 하루 무료 한도(10,000 neurons, 백 번 남짓)를 다 쓴다 — 다시 견줄 때는 그날 사진 읽기가 멈춘다는 것을 알리고 한다.
 */
export const FAST_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const CAREFUL_MODEL = '@cf/qwen/qwen3.8-27b';


/**
 * Gemini (Google AI Studio 무료 등급). 2026-10-05 같은 확인서 네 장으로 견줌 (맞은 칸 / 30칸):
 *   3.6 Flash      29, 3.5~5.6초 (하루 20번·1분 5번) → 처음 읽기. 하루 열 번쯤 쓰고, 틀린 칸은 손으로 고치므로 2초 빠른 것보다 덜 틀리는 쪽 (사용자가 순서를 맡김)
 *   3.5 Flash Lite 27, 2~3초 (하루 500번·1분 15번)  → 3.6 이 한도(429)·혼잡(503)으로 안 될 때. 같은 사진도 숫자 칸이 달라지곤 한다(타설량 108/1080)
 *   3.5 Flash      29, 12~23초 (하루 20번·1분 5번)   → 「꼼꼼히 다시 읽기」. 처음 읽은 모델에 다시 물으면 같은 답이라 다른 모델부터 쓴다
 *   3.7 Flash      한 장만 답함(8/9칸, 9초), 나머지는 503 → 3.5 가 안 될 때. 한도는 모델마다 따로 센다
 *   3.8 Flash 는 모두 503(혼잡)·429 였고, 실패한 요청도 하루 20번에 들어가 한도만 썼다. Pro 는 무료로 못 쓴다.
 * 사진이 Google 로 나간다 — 사용자가 알고 정했다 (2026-10-05). 키가 없으면 Workers AI 만 쓴다.
 */
export const GEMINI_FAST = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
export const GEMINI_CAREFUL = ['gemini-3.5-flash', 'gemini-3.7-flash'];
/** 이 시간 안에 답이 없으면 그만 기다리고 다음 모델로 넘어간다 */
const GEMINI_TIMEOUT_MS: Record<string, number> = { 'gemini-3.5-flash-lite': 15_000, 'gemini-3.6-flash': 15_000, 'gemini-3.7-flash': 20_000, 'gemini-3.5-flash': 45_000 };

export function readPlan(careful: boolean, gemini = false): { model: string; extra: Record<string, unknown> }[] {
  const workersAi = careful
    ? [{ model: CAREFUL_MODEL, extra: {} }]
    : [
        { model: CAREFUL_MODEL, extra: { chat_template_kwargs: { enable_thinking: false } } },
        { model: FAST_MODEL, extra: {} },
      ];
  if (!gemini) return workersAi;
  return [...(careful ? GEMINI_CAREFUL : GEMINI_FAST).map((model) => ({ model, extra: {} })), ...workersAi];
}

/** Gemini 의 답에서 글만 꺼낸다 (조각으로 나뉘어 올 수 있다) */
export function geminiText(body: unknown): string {
  const parts = (body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('') : '';
}

const SYSTEM = '당신은 손으로 적은 확인서를 정확히 옮겨 적는 사람입니다. JSON 배열로만 답합니다.';

async function askGemini(key: string, model: string, prompt: string, image: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    // 키는 주소가 아니라 머리말로 보낸다 (주소는 기록에 남는다)
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: image } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS[model] ?? 30_000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
    throw new Error(`Gemini ${res.status} ${String(message ?? '').slice(0, 200)}`);
  }
  return geminiText(body);
}

/**
 * 같은 사진·같은 안내문인데 답이 4초에 오기도 40초에 오기도 한다 (Cloudflare 쪽 대기 — 2026-10-04 확인서 네 장으로 잼).
 * 안내문·사진 크기·다른 무료 모델로는 줄지 않았다. 같은 요청을 동시에 셋 보내 보니 느린 것이 서로 겹치지 않아
 * (셋 중 가장 빠른 것이 3.7~11.5초), 처음부터 둘을 같이 보내고 그래도 늦으면 하나를 더 보내 먼저 온 답을 쓴다.
 * 무료 한도는 그만큼(두세 배) 더 쓴다.
 */
export const EXTRA_CALLS_MS = [0, 7000];

/**
 * run 을 바로 한 번 부르고, extraMs 의 시각마다(ms 뒤) 한 번씩 더 부른다. 먼저 온 답을 돌려준다.
 * 부른 것이 모두 실패했는데 아직 안 부른 것이 남았으면 기다리지 않고 바로 부른다.
 * 못 읽었다는 답(null)이 오면 다시 보내도 같으므로 더 부르지 않는다. 모두 실패하면 마지막 오류를 던진다.
 */
export function firstAnswer<T>(run: () => Promise<T | null>, extraMs: number[]): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const limit = 1 + extraMs.length;
    let calls = 0;
    let pending = 0;
    let done = false;
    let unreadable = false;
    let lastError: unknown;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (act: () => void) => {
      done = true;
      timers.forEach(clearTimeout);
      act();
    };
    const settle = () => {
      if (done || pending) return;
      if (!unreadable && calls < limit) return start();
      finish(() => (unreadable ? resolve(null) : reject(lastError)));
    };
    const start = () => {
      if (done || unreadable || calls >= limit) return;
      calls += 1;
      pending += 1;
      run().then(
        (value) => {
          pending -= 1;
          if (done) return;
          if (value == null) {
            unreadable = true;
            return settle();
          }
          finish(() => resolve(value));
        },
        (error) => {
          pending -= 1;
          lastError = error;
          settle();
        }
      );
    };

    start();
    for (const ms of extraMs) {
      if (ms <= 0) start();
      else timers.push(setTimeout(start, ms));
    }
  });
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 모델이 돌려준 글에서 JSON 배열만 꺼낸다 (앞뒤 설명·```json 울타리가 붙어 와도) */
export function extractJsonArray(text: string): unknown[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Workers AI 대화 모델의 답은 모델마다 모양이 조금 다르다 */
function answerText(result: unknown): string {
  const r = result as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };
  if (typeof r?.response === 'string') return r.response;
  if (r?.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const content = r?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  return '';
}

export interface PromptSite {
  label: string;
  client: string;
  name: string;
  /** 거래처의 정식 이름 (「아라개발(주)」) — 확인서의 건설업자 칸에는 이쪽이 적힌다 */
  client_full: string | null;
  address: string | null;
}

export function photoPrompt(context: { year: string; sites: PromptSite[]; operators: string[]; booms: number[]; works: string[] }) {
  return [
    // 올리는 사진은 언제나 이 확인서 한 장이다 (사용자 확인 2026-10-04) — 공책 장부가 아니다
    '「건설기계임대차 계약서(작업사용확인서)」 사진입니다.',
    '인쇄된 칸 이름 옆에 손으로 적은 값만 읽어, 항목 하나짜리 JSON 배열로만 답하세요. (설명 금지)',
    '',
    '항목 형식 (값은 예시, 사진에 적힌 것만 입력):',
    '{"date":"1/5","m":37,"site":null,"place":"(현장소재지)","client":"(건설업자)","work":"(작업)","operator":"(조정사)","time":"07:00~17:00","ot":0,"pour":null,"amount":null,"site_pick":null,"operator_pick":null}',
    '',
    '규칙:',
    '- date: 맨 위 「년 월 일」의 월/일.',
    '- m: 「콘크리트 펌프카(   M)」 괄호 안 숫자(예: 42, 37). 없으면 null.',
    '- site: 「현장명」 칸 — 보통 원청 건설사 이름(○○건설). 빈 칸이면 null.',
    '- place: 「현장소재지」 칸 — 도로·노선·지역 이름. 빈 칸이면 null.',
    '- client: 「건설업자(임차인)」 칸 — 회사 이름. 빈 칸이면 null.',
    '  세 칸 모두 사진에 적힌 글자 그대로(약칭 유지). 참고 목록 이름으로 임의 변환 금지.',
    '- work: 「작업내용」 그대로. 없으면 null.',
    '- operator: 「펌프카조정사」 이름 그대로. 없으면 null.',
    '- time: 「작업시간」을 「07:00~17:00」 꼴로. 없으면 null.',
    '- ot: 「OT 시간」 숫자. 비어 있으면 0.',
    '- pour: 「타설량」 숫자. 없으면 null.',
    '- amount: 「합계금액」 정수(「140만」→1400000, 비어 있으면 반드시 null).',
    // 읽으면서 장부의 어느 현장·기사님인지도 같이 고르게 한다 (2026-10-05 사용자 요청). 적힌 글자 칸은 그대로 두고 칸을 따로 받는다 —
    // 앱이 찾은 것과 견주어, AI 만 고른 것은 체크를 풀어 둔다 (src/lib/photoLog.ts). 원청은 주지 않는다: 같은 원청의 다른 현장을 고른다
    '- site_pick: 아래 「우리 장부의 현장」 가운데 이 확인서의 현장이 있으면 그 줄의 맨 앞 이름을 그대로. 건설업자가 그 거래처이고 현장명이나 현장소재지가 그 현장의 이름·주소와 맞을 때만 고른다. 목록에 없거나 확실하지 않으면 null (새 현장으로 추가된다).',
    '- operator_pick: 아래 「기사님」 가운데 조정사와 같은 사람이면 그 이름 그대로 (성만 적어 둔 분도 있다). 없으면 null.',
    '- 등록번호·보험·서명·아래 단가표·특약사항·임대회사명과 뒤에 비치는 공책은 읽지 않는다. 판독 불가 칸은 null.',
    '',
    `올해: ${context.year}`,
    `규격(M): ${context.booms.join(', ')}`,
    `건설업자 칸에 자주 나오는 이름: ${[...new Set(context.sites.map((s) => s.client))].join(', ')}`,
    '우리 장부의 현장 (이름 | 거래처 | 주소):',
    ...context.sites.map((s) => `- ${s.label} | ${s.client_full || s.client} | ${s.address ?? ''}`),
    `기사님: ${context.operators.join(', ')}`,
    `자주 쓰는 작업 내용: ${context.works.join(', ')}`,
  ].join('\n');
}

/**
 * 어느 모델도 줄을 못 내놓았을 때의 안내. outcomes 는 시도한 모델마다의 결과 — 오류 글, 답은 왔지만 줄이 없었으면 null.
 * 마지막 모델의 오류만 보면, Gemini 가 붐벼서 실패하고 뒤의 Cloudflare 가 한도에 걸린 날 「다 썼습니다」가 떠서
 * 한도가 남은 Gemini 까지 내일로 미루게 된다 (2026-10-05 사용자가 겪음).
 */
export function readFailure(outcomes: (string | null)[]): { error: string; status: 422 | 429 | 503 } {
  // 답이 온 모델이 있으면 사진 쪽 문제다
  if (!outcomes.length || outcomes.some((o) => o == null)) {
    return { error: '사진에서 장부 줄을 찾지 못했습니다. 밝은 곳에서 장부가 화면에 꽉 차게 다시 찍어 주세요.', status: 422 };
  }
  if (outcomes.every((o) => /limit|quota|neurons|429/i.test(o ?? ''))) {
    return { error: '오늘 무료로 읽을 수 있는 양을 다 썼습니다. 내일 다시 해 주세요.', status: 429 };
  }
  return { error: '지금 사진 읽는 곳이 붐빕니다. 잠시 뒤 다시 해 주세요.', status: 503 };
}

photoLogs.post('/photo-logs/read', async (c) => {
  const body: { image?: unknown; careful?: unknown } = await c.req.json().catch(() => ({}));
  if (typeof body.image !== 'string' || !body.image) return c.json({ error: '사진이 없습니다.' }, 400);
  if (body.image.length * 0.75 > MAX_IMAGE_BYTES) return c.json({ error: '사진이 너무 큽니다. 다시 찍어 주세요.' }, 413);
  const careful = body.careful === true;
  const geminiKey = (c.env as unknown as Record<string, string | undefined>).GEMINI_API_KEY;
  const plan = readPlan(careful, Boolean(geminiKey));

  // 흐린 글자를 알아보도록 현장·기사님·자주 쓰는 작업 내용을 같이 준다
  const db = c.env.DB;
  const [sites, operators, booms, works] = await db.batch([
    db.prepare(
      `SELECT s.label, s.name, s.address, c.name AS client, c.full_name AS client_full FROM sites s JOIN clients c ON c.id = s.client_id
        WHERE s.archived = 0 ORDER BY s.label`
    ),
    db.prepare('SELECT name FROM operators WHERE archived = 0 ORDER BY name'),
    db.prepare('SELECT DISTINCT boom_size AS v FROM work_logs WHERE boom_size IS NOT NULL ORDER BY boom_size'),
    db.prepare(
      `SELECT description AS v FROM work_logs WHERE description IS NOT NULL AND description <> ''
        GROUP BY description HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC LIMIT 15`
    ),
  ]);
  const prompt = photoPrompt({
    year: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4),
    sites: sites.results as unknown as PromptSite[],
    operators: (operators.results as { name: string }[]).map((r) => r.name),
    booms: (booms.results as { v: number }[]).map((r) => r.v),
    works: (works.results as { v: string }[]).map((r) => r.v),
  });

  const started = Date.now();
  const found = (model: string, text: string): unknown[] | null => {
    const rows = extractJsonArray(text);
    if (rows && rows.length) return rows;
    console.error('사진 읽기: 줄을 못 찾음', model, text.slice(0, 500));
    return null;
  };
  const attempt = async (model: string, extra: Record<string, unknown>): Promise<unknown[] | null> => {
    if (model.startsWith('gemini-')) return found(model, await askGemini(geminiKey!, model, prompt, body.image as string));
    const result = await c.env.AI.run(model as never, {
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${body.image}` } },
          ],
        },
      ],
      // 확인서 한 장은 한 줄이다 — 답이 길어질 일이 없다 (생각하기를 켠 Qwen 은 생각하는 글도 여기서 쓴다)
      max_tokens: careful ? 4000 : 800,
      temperature: 0,
      ...extra,
    } as never);
    return found(model, answerText(result));
  };

  const outcomes: (string | null)[] = [];
  for (const { model, extra } of plan) {
    try {
      // 생각하기를 끈 Qwen 만 여러 번 보낸다 (답 오는 시간이 들쭉날쭉해서). Gemini 는 2~3초라 한 번이면 되고,
      // 「꼼꼼히 다시 읽기」는 원래 오래 걸려 한 번만 보내고 기다린다
      const rows = await firstAnswer(() => attempt(model, extra), model === CAREFUL_MODEL && !careful ? EXTRA_CALLS_MS : []);
      if (rows) return c.json({ model, seconds: Math.round((Date.now() - started) / 100) / 10, rows });
      outcomes.push(null);
    } catch (e) {
      outcomes.push(String(e));
      console.error('사진 읽기 실패', model, e);
    }
  }

  const failure = readFailure(outcomes);
  return c.json({ error: failure.error }, failure.status);
});

export default photoLogs;
