import express from 'express';
import { join } from 'node:path';
import { config } from './config.js';
import * as store from './store.js';
import * as auth from './auth.js';
import { sendSessionLink, mailerMode } from './mailer.js';
import { renderLanding } from './landing.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.disable('x-powered-by');

// 원격 접속 도구이므로 운영자 API 는 항상 토큰으로 보호한다.
function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || req.query.admin_token;
  if (token !== config.adminToken) return res.status(401).json({ error: '인증이 필요합니다' });
  next();
}

/** 링크 토큰으로 세션을 찾고, 쓸 수 없는 상태면 응답을 끝낸다. */
function usableSession(req, res) {
  const session = store.getByToken(req.params.token);
  if (!session || !store.isUsable(session)) {
    res.status(410).json({ error: '만료되었거나 사용할 수 없는 링크입니다' });
    return null;
  }
  return session;
}

app.get('/healthz', (_req, res) =>
  res.json({ ok: true, mailer: mailerMode(), auth: auth.authMode() }));

// ---------- 운영자(지원자) API ----------

app.post('/api/sessions', requireAdmin, async (req, res) => {
  const { email, note } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: '올바른 이메일이 필요합니다' });
  }

  const session = store.createSession({ email: email.toLowerCase(), note: note || '' });
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

// ---------- 회사 계정 로그인 ----------

app.get('/auth/login/:token', async (req, res) => {
  const session = store.getByToken(req.params.token);
  if (!session || !store.isUsable(session)) {
    return res.status(410).send(renderLanding({ state: 'expired' }));
  }
  if (!auth.entraConfigured) {
    return res.send(renderLanding({ state: 'devlogin', session, token: req.params.token }));
  }
  try {
    res.redirect(await auth.loginUrl(req.params.token));
  } catch (err) {
    console.error('로그인 주소 생성 실패:', err.message);
    res.status(500).send(renderLanding({ state: 'autherror' }));
  }
});

app.get('/auth/callback', async (req, res) => {
  const token = String(req.query.state || '');
  const session = store.getByToken(token);
  if (!session || !store.isUsable(session)) {
    return res.status(410).send(renderLanding({ state: 'expired' }));
  }
  if (req.query.error || !req.query.code) {
    return res.status(400).send(renderLanding({ state: 'autherror' }));
  }
  try {
    const user = await auth.exchangeCode(String(req.query.code));
    applyLogin(session, user);
    res.redirect(`/s/${token}`);
  } catch (err) {
    console.error('로그인 처리 실패:', err.message);
    res.status(400).send(renderLanding({ state: 'autherror' }));
  }
});

// Entra 미설정 환경에서 흐름을 검증하기 위한 개발용 로그인.
app.post('/auth/dev/:token', (req, res) => {
  if (auth.entraConfigured) return res.status(404).send('사용할 수 없습니다');
  const session = store.getByToken(req.params.token);
  if (!session || !store.isUsable(session)) {
    return res.status(410).send(renderLanding({ state: 'expired' }));
  }
  const upn = String(req.body?.upn || '').toLowerCase().trim();
  if (!upn) return res.redirect(`/auth/login/${req.params.token}`);
  // 실제 Entra 와 같은 판정을 쓰도록 게스트 여부도 UPN 형태로 가린다.
  applyLogin(session, { upn, name: '', tenantId: 'dev', isGuest: /#ext#/i.test(upn) });
  res.redirect(`/s/${req.params.token}`);
});

/** 로그인 결과를 세션에 기록한다. 초대 대상과 다른 계정이면 인증되지 않은 것으로 둔다. */
function applyLogin(session, user) {
  const ok = auth.matchesInvitee(user.upn, session.email);
  store.update(session, {
    authedUpn: auth.normalizeUpn(user.upn),
    authedName: auth.displayName(user),
    authMatched: ok,
    isGuest: Boolean(user.isGuest),
    authAt: Date.now(),
    status: ok && session.status === 'created' ? 'authed' : session.status,
  });
  if (!ok) console.warn(`계정 불일치: 초대=${session.email} 로그인=${user.upn}`);
}

// ---------- 피지원자 화면 ----------

app.get('/s/:token', (req, res) => {
  const token = req.params.token;
  const session = store.getByToken(token);
  if (!session) return res.status(404).send(renderLanding({ state: 'invalid' }));
  if (!store.isUsable(session)) return res.status(410).send(renderLanding({ state: 'expired' }));

  // 1) 아직 로그인하지 않았다면 회사 계정 확인부터
  if (!session.authedUpn) return res.send(renderLanding({ state: 'login', session, token }));

  // 2) 로그인은 했지만 초대받은 계정이 아니라면 여기서 막는다
  if (!auth.matchesInvitee(session.authedUpn, session.email)) {
    return res.status(403).send(renderLanding({ state: 'mismatch', session, token }));
  }

  // 3) 동의 → 4) 연결 준비
  const state = session.status === 'created' || session.status === 'authed' ? 'consent'
    : session.status === 'ready' ? 'ready' : 'waiting';
  res.send(renderLanding({ state, session, token }));
});

// 안내 페이지가 연결 준비 여부를 확인하는 데 쓴다. 상태 값만 돌려준다.
app.get('/api/s/:token/status', (req, res) => {
  const session = usableSession(req, res);
  if (!session) return;
  res.json({ status: session.status });
});

// 동의. 이 시점부터 접속 정보를 받을 수 있다.
app.post('/api/s/:token/accept', (req, res) => {
  const session = usableSession(req, res);
  if (!session) return;
  if (!isAuthed(session)) return res.status(403).json({ error: '회사 계정 확인이 필요합니다' });

  if (['created', 'authed'].includes(session.status)) {
    store.update(session, { status: 'opened', openedAt: Date.now() });
  }
  res.json({ ok: true, status: session.status });
});

// 사내 PC 에 상주하는 핸들러가 자기 접속 정보를 알린다.
// 사전 등록 없이, 사용자가 링크를 연 바로 그 PC 가 대상이 된다.
app.post('/api/s/:token/agent', (req, res) => {
  const session = usableSession(req, res);
  if (!session) return;
  if (!isAuthed(session)) return res.status(403).json({ error: '회사 계정 확인이 필요합니다' });
  if (session.status === 'created' || session.status === 'authed') {
    return res.status(409).json({ error: '아직 동의하지 않은 세션입니다' });
  }

  // 보고하는 PC 에 로그인한 Windows 계정이 이 세션을 인증한 계정과 같아야 한다.
  // 다른 사람의 세션 토큰을 이 PC 에서 열게 만들어 접속 정보를 가로채는 시도를 막는다.
  const reportedUpn = auth.normalizeUpn(req.body?.upn);
  if (!reportedUpn) {
    return res.status(403).json({ error: 'PC 의 로그인 계정을 확인할 수 없습니다' });
  }
  if (reportedUpn !== session.authedUpn) {
    console.warn(`계정 불일치 보고 차단: 세션=${session.authedUpn} PC=${reportedUpn}`);
    return res.status(403).json({ error: '이 PC 의 로그인 계정이 세션과 다릅니다' });
  }

  const rustdeskId = String(req.body?.rustdeskId || '').replace(/\s/g, '');
  if (!/^\d{6,16}$/.test(rustdeskId)) {
    return res.status(400).json({ error: 'ID 형식이 올바르지 않습니다' });
  }
  store.update(session, {
    status: 'ready',
    readyAt: Date.now(),
    rustdeskId,
    deviceHostname: String(req.body?.hostname || '').slice(0, 64) || null,
    reportedBy: 'agent',
  });
  res.json({ ok: true });
});

// 핸들러가 없는 기기(주로 외부 게스트)를 위한 직접 입력 경로.
app.post('/api/s/:token/ready', (req, res) => {
  const session = usableSession(req, res);
  if (!session) return;
  if (!isAuthed(session)) return res.status(403).json({ error: '회사 계정 확인이 필요합니다' });

  const rustdeskId = String(req.body?.rustdeskId || '').replace(/\s/g, '');
  const password = String(req.body?.password || '').trim();
  if (!/^\d{6,16}$/.test(rustdeskId)) {
    return res.status(400).json({ error: 'ID 형식이 올바르지 않습니다' });
  }
  store.update(session, {
    status: 'ready',
    readyAt: Date.now(),
    rustdeskId,
    connectPassword: password || null,
    reportedBy: 'manual',
  });
  res.json({ ok: true });
});

function isAuthed(session) {
  return Boolean(session.authedUpn) && auth.matchesInvitee(session.authedUpn, session.email);
}

app.use(express.static(join(process.cwd(), 'server', 'public')));

/** 운영자에게 돌려줄 세션 표현. 링크 토큰은 절대 포함하지 않는다. */
function publicView(session) {
  const { token, ...rest } = session;
  return rest;
}

const server = app.listen(config.port, () => {
  console.log(`원격지원 세션 서버 → ${config.baseUrl}`);
  console.log(`  메일: ${mailerMode()} / 로그인: ${auth.authMode()}`);
  if (config.adminToken === 'dev-admin-token') {
    console.warn('경고: ADMIN_TOKEN 이 기본값입니다. 배포 전에 반드시 변경하세요.');
  }
  if (!auth.entraConfigured) {
    console.warn('경고: Entra 설정이 없어 개발용 로그인이 활성화되어 있습니다.');
  }
});

setInterval(() => store.sweepExpired(), 60_000).unref();

export { app, server };
