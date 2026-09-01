import express from 'express';
import { join } from 'node:path';
import { config } from './config.js';
import * as store from './store.js';
import { sendSessionLink, mailerMode } from './mailer.js';
import { renderLanding } from './landing.js';

const app = express();
app.use(express.json());
app.disable('x-powered-by');

// 원격 접속 도구이므로 운영자 API는 항상 토큰으로 보호한다.
function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || req.query.admin_token;
  if (token !== config.adminToken) return res.status(401).json({ error: '인증이 필요합니다' });
  next();
}

app.get('/healthz', (_req, res) => res.json({ ok: true, mailer: mailerMode() }));

// ---------- 운영자(지원자) API ----------

app.post('/api/sessions', requireAdmin, async (req, res) => {
  const { email, note } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: '올바른 이메일이 필요합니다' });
  }

  const session = store.createSession({ email, note: note || '' });
  const link = `${config.baseUrl}/s/${session.token}`;

  try {
    await sendSessionLink({ to: email, link, note, ttlMinutes: config.sessionTtlMinutes });
  } catch (err) {
    console.error('메일 발송 실패:', err.message);
    // 발송에 실패해도 링크는 유효하므로 수동 전달이 가능하도록 세션은 유지한다.
    return res.status(207).json({ ...publicView(session), link, mailError: err.message });
  }
  res.status(201).json({ ...publicView(session), link });
});

app.get('/api/sessions', requireAdmin, (_req, res) => {
  store.sweepExpired();
  res.json(store.listRecent());
});

app.get('/api/sessions/:id', requireAdmin, (req, res) => {
  store.sweepExpired();
  const session = store.getById(req.params.id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
  res.json(publicView(session));
});

app.post('/api/sessions/:id/end', requireAdmin, (req, res) => {
  const session = store.getById(req.params.id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
  store.update(session, { status: 'ended', endedAt: Date.now(), connectPassword: null });
  res.json(publicView(session));
});

// ---------- 피지원자용 (토큰으로만 접근) ----------

app.get('/s/:token', (req, res) => {
  const session = store.getByToken(req.params.token);
  if (!session) return res.status(404).send(renderLanding({ state: 'invalid' }));
  if (!store.isUsable(session)) return res.status(410).send(renderLanding({ state: 'expired' }));
  res.send(renderLanding({ state: 'consent', session, token: req.params.token }));
});

// 피지원자가 연결에 동의한 시점을 기록한다.
app.post('/api/s/:token/accept', (req, res) => {
  const session = store.getByToken(req.params.token);
  if (!session || !store.isUsable(session)) return res.status(410).json({ error: '만료된 링크입니다' });
  if (session.status === 'created') {
    store.update(session, { status: 'opened', openedAt: Date.now() });
  }
  res.json({ ok: true, status: session.status });
});

// 피지원자 측 접속 정보 보고.
// 커스텀 에이전트가 자동 호출하는 것이 목표이며, 현재는 안내 페이지의 수동 입력이 이 API를 사용한다.
app.post('/api/s/:token/ready', (req, res) => {
  const session = store.getByToken(req.params.token);
  if (!session || !store.isUsable(session)) return res.status(410).json({ error: '만료된 링크입니다' });

  const rustdeskId = String(req.body?.rustdeskId || '').replace(/\s/g, '');
  const password = String(req.body?.password || '').trim();
  if (!/^\d{6,16}$/.test(rustdeskId)) return res.status(400).json({ error: 'ID 형식이 올바르지 않습니다' });
  if (password.length < 4) return res.status(400).json({ error: '비밀번호가 너무 짧습니다' });

  store.update(session, {
    status: 'ready',
    readyAt: Date.now(),
    rustdeskId,
    connectPassword: password,
  });
  res.json({ ok: true });
});

app.use(express.static(join(process.cwd(), 'server', 'public')));

/** 운영자에게 돌려줄 세션 표현. 링크 토큰은 절대 포함하지 않는다. */
function publicView(session) {
  const { token, ...rest } = session;
  return rest;
}

const server = app.listen(config.port, () => {
  console.log(`원격지원 세션 서버 → ${config.baseUrl} (메일: ${mailerMode()})`);
  if (config.adminToken === 'dev-admin-token') {
    console.warn('경고: ADMIN_TOKEN이 기본값입니다. 배포 전에 반드시 변경하세요.');
  }
});

setInterval(() => store.sweepExpired(), 60_000).unref();

export { app, server };
