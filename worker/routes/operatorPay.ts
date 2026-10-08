import { Hono } from 'hono';
import type { OperatorOt, OperatorPay, OperatorPayResponse, OperatorSalary } from '../../shared/types';
import { salaryFor } from '../../shared/operatorPay';
import type { AppEnv } from '../types';

/**
 * 기사님 월급 — 「언제부터 얼마」(operator_salaries), 달마다 줬는지(operator_pay), 한 건씩 적는 야간수당(operator_ot).
 * 그 달에 줄 돈을 셈하는 규칙은 shared/operatorPay.ts 에 있고, 여기는 적어 두고 꺼내 주기만 한다.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 잘못 눌러 0 이 몇 개 더 붙은 금액을 거른다 */
const MAX_AMOUNT = 100_000_000;

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_AMOUNT;

const operatorPay = new Hono<AppEnv>();

operatorPay.get('/operator-pay', async (c) => {
  const { from, to } = c.req.query();
  const db = c.env.DB;
  const [salaries, pays, ots] = await db.batch([
    // 월급은 기간 앞에 정한 것이 기간 안의 달에도 쓰이므로 모두 준다 (기사님 몇 분 × 몇 번이라 많지 않다)
    db.prepare('SELECT * FROM operator_salaries ORDER BY operator_id, from_month'),
    MONTH.test(from ?? '') && MONTH.test(to ?? '')
      ? db.prepare('SELECT * FROM operator_pay WHERE month BETWEEN ? AND ? ORDER BY month, operator_id').bind(from, to)
      : db.prepare('SELECT * FROM operator_pay ORDER BY month, operator_id'),
    // 야간수당은 달과 상관없이 안 준 것을 모두 보여야 해서 기간으로 자르지 않는다
    db.prepare('SELECT * FROM operator_ot ORDER BY work_date DESC, id DESC'),
  ]);
  const body: OperatorPayResponse = {
    salaries: salaries.results as unknown as OperatorSalary[],
    pays: pays.results as unknown as OperatorPay[],
    ots: ots.results as unknown as OperatorOt[],
  };
  return c.json(body);
});

/** 월급을 정한다 — 같은 달에 이미 정한 것이 있으면 그 금액을 고친다 */
operatorPay.put('/operators/:id/salary', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ from_month?: unknown; amount?: unknown }>();
  if (typeof b.from_month !== 'string' || !MONTH.test(b.from_month)) return c.json({ error: '몇 월부터인지 골라 주세요.' }, 400);
  if (!isAmount(b.amount)) return c.json({ error: '월급을 숫자로 적어 주세요.' }, 400);

  const operator = await c.env.DB.prepare('SELECT id FROM operators WHERE id = ?').bind(id).first();
  if (!operator) return c.json({ error: '기사님을 찾을 수 없습니다.' }, 404);

  const row = await c.env.DB.prepare(
    `INSERT INTO operator_salaries (operator_id, from_month, amount) VALUES (?, ?, ?)
       ON CONFLICT(operator_id, from_month) DO UPDATE SET amount = excluded.amount
     RETURNING *`
  )
    .bind(id, b.from_month, b.amount)
    .first<OperatorSalary>();
  return c.json(row);
});

operatorPay.delete('/operator-salaries/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM operator_salaries WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.body(null, 204);
});

/** 그 달 월급을 줬다고 표시한다(paid_date). null 로 보내면 되돌린다. 줄 때의 월급을 같이 적어 둔다 */
operatorPay.put('/operator-pay/:operatorId/:month', async (c) => {
  const operatorId = Number(c.req.param('operatorId'));
  const month = c.req.param('month');
  if (!MONTH.test(month)) return c.json({ error: '달이 올바르지 않습니다.' }, 400);
  const b = await c.req.json<{ paid_date?: unknown }>();
  const db = c.env.DB;

  if ('paid_date' in b) {
    if (b.paid_date !== null && (typeof b.paid_date !== 'string' || !DATE.test(b.paid_date))) {
      return c.json({ error: '준 날이 올바르지 않습니다.' }, 400);
    }
    let salary: number | null = null;
    if (b.paid_date) {
      const { results } = await db
        .prepare('SELECT * FROM operator_salaries WHERE operator_id = ?')
        .bind(operatorId)
        .all<OperatorSalary>();
      salary = salaryFor(results, operatorId, month);
    }
    await db
      .prepare(
        `INSERT INTO operator_pay (operator_id, month, paid_date, paid_salary) VALUES (?, ?, ?, ?)
           ON CONFLICT(operator_id, month) DO UPDATE SET paid_date = excluded.paid_date, paid_salary = excluded.paid_salary`
      )
      .bind(operatorId, month, b.paid_date, salary)
      .run();
  }

  const row = await db
    .prepare('SELECT * FROM operator_pay WHERE operator_id = ? AND month = ?')
    .bind(operatorId, month)
    .first<OperatorPay>();
  return c.json(row);
});

/** 야간수당 한 건을 적는다 */
operatorPay.post('/operator-ot', async (c) => {
  const b = await c.req.json<{ operator_id?: unknown; work_date?: unknown; amount?: unknown; note?: unknown }>();
  if (typeof b.work_date !== 'string' || !DATE.test(b.work_date)) return c.json({ error: '날짜를 골라 주세요.' }, 400);
  if (!isAmount(b.amount) || b.amount === 0) return c.json({ error: '야간수당 금액을 숫자로 적어 주세요.' }, 400);
  const operator = await c.env.DB.prepare('SELECT id FROM operators WHERE id = ?').bind(Number(b.operator_id)).first();
  if (!operator) return c.json({ error: '기사님을 골라 주세요.' }, 400);

  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 100) : null;
  const row = await c.env.DB.prepare('INSERT INTO operator_ot (operator_id, work_date, amount, note) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(Number(b.operator_id), b.work_date, b.amount, note)
    .first<OperatorOt>();
  return c.json(row, 201);
});

/** 금액을 고치거나(amount), 줬다고 표시한다(paid_date, null 이면 되돌림). 준 건은 되돌린 뒤에만 고친다 */
operatorPay.patch('/operator-ot/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ amount?: unknown; paid_date?: unknown }>();
  const db = c.env.DB;
  const current = await db.prepare('SELECT * FROM operator_ot WHERE id = ?').bind(id).first<OperatorOt>();
  if (!current) return c.json({ error: '야간수당을 찾을 수 없습니다.' }, 404);

  if ('amount' in b) {
    if (!isAmount(b.amount) || b.amount === 0) return c.json({ error: '야간수당 금액을 숫자로 적어 주세요.' }, 400);
    if (current.paid_date) return c.json({ error: '이미 준 야간수당입니다. 고치려면 먼저 「줬음」을 되돌려 주세요.' }, 409);
    await db.prepare('UPDATE operator_ot SET amount = ? WHERE id = ?').bind(b.amount, id).run();
  }
  if ('paid_date' in b) {
    if (b.paid_date !== null && (typeof b.paid_date !== 'string' || !DATE.test(b.paid_date))) {
      return c.json({ error: '준 날이 올바르지 않습니다.' }, 400);
    }
    await db.prepare('UPDATE operator_ot SET paid_date = ? WHERE id = ?').bind(b.paid_date, id).run();
  }
  return c.json(await db.prepare('SELECT * FROM operator_ot WHERE id = ?').bind(id).first<OperatorOt>());
});

operatorPay.delete('/operator-ot/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const current = await c.env.DB.prepare('SELECT paid_date FROM operator_ot WHERE id = ?').bind(id).first<{ paid_date: string | null }>();
  if (current?.paid_date) return c.json({ error: '이미 준 야간수당입니다. 지우려면 먼저 「줬음」을 되돌려 주세요.' }, 409);
  await c.env.DB.prepare('DELETE FROM operator_ot WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

export default operatorPay;
