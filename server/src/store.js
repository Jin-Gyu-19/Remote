// 파일 기반 경량 세션 저장소. MVP 단계에서는 DB 없이 JSON 파일 하나로 충분하다.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const DATA_FILE = process.env.DATA_FILE || join(process.cwd(), 'data', 'sessions.json');

/** @type {Map<string, any>} sessionId -> session */
const sessions = new Map();
/** @type {Map<string, string>} token -> sessionId */
const tokenIndex = new Map();

function persist() {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify([...sessions.values()], null, 2));
}

function load() {
  try {
    for (const s of JSON.parse(readFileSync(DATA_FILE, 'utf8'))) {
      sessions.set(s.id, s);
      tokenIndex.set(s.token, s.id);
    }
  } catch {
    // 최초 실행 시 파일이 없는 것은 정상이다.
  }
}
load();

/** 링크 토큰. 이 값만으로 원격 세션이 열리므로 추측 불가능해야 한다. */
function newToken() {
  return randomBytes(32).toString('base64url');
}

export function createSession({ email, note = '', createdBy = 'admin', device = null }) {
  const now = Date.now();
  const session = {
    id: randomUUID(),
    token: newToken(),
    email,
    note,
    createdBy,
    status: 'created',
    // Intune 관리 기기는 접속 대상이 이미 정해져 있어 피지원자가 입력할 것이 없다.
    managed: Boolean(device),
    deviceHostname: device?.hostname || null,
    rustdeskId: device?.rustdeskId || null,
    // 미등록 기기(외부 지원)에서만 사용하는 폴백 입력값
    connectPassword: null,
    createdAt: now,
    expiresAt: now + config.sessionTtlMinutes * 60_000,
    openedAt: null,
    readyAt: null,
    endedAt: null,
  };
  sessions.set(session.id, session);
  tokenIndex.set(session.token, session.id);
  persist();
  return session;
}

export function getById(id) {
  return sessions.get(id) || null;
}

/** 토큰 조회는 타이밍 공격을 피하기 위해 상수 시간 비교를 사용한다. */
export function getByToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  const candidate = Buffer.from(token);
  for (const [known, id] of tokenIndex) {
    const knownBuf = Buffer.from(known);
    if (knownBuf.length === candidate.length && timingSafeEqual(knownBuf, candidate)) {
      return sessions.get(id) || null;
    }
  }
  return null;
}

export function isExpired(session) {
  return Date.now() > session.expiresAt;
}

/** 이미 끝났거나 만료된 세션은 다시 열 수 없다. */
export function isUsable(session) {
  return !isExpired(session) && !['ended', 'expired'].includes(session.status);
}

export function update(session, patch) {
  Object.assign(session, patch);
  persist();
  return session;
}

export function listRecent(limit = 50) {
  return [...sessions.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(({ token, ...rest }) => rest); // 토큰은 목록에 노출하지 않는다
}

/** 만료된 세션의 접속 정보를 비운다. 주기적으로 호출. */
export function sweepExpired() {
  let changed = false;
  for (const s of sessions.values()) {
    if (isExpired(s) && !['ended', 'expired'].includes(s.status)) {
      s.status = 'expired';
      s.connectPassword = null;
      changed = true;
    }
  }
  if (changed) persist();
}
