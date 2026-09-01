// Intune 으로 관리되는 사내 PC 등록소.
// 연결 승인은 피지원자의 '수락' 클릭으로 이루어지므로(approve-mode=click)
// 이 저장소는 비밀번호를 다루지 않는다. 계정 ↔ PC 매핑만 관리한다.
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const DEVICE_FILE = process.env.DEVICE_FILE || join(process.cwd(), 'data', 'devices.json');

/** @type {Map<string, any>} hostname(소문자) -> device */
const devices = new Map();

function persist() {
  mkdirSync(dirname(DEVICE_FILE), { recursive: true });
  writeFileSync(DEVICE_FILE, JSON.stringify([...devices.values()], null, 2));
}

function load() {
  try {
    for (const d of JSON.parse(readFileSync(DEVICE_FILE, 'utf8'))) {
      devices.set(d.hostname.toLowerCase(), d);
    }
  } catch {
    // 최초 실행 시 파일이 없는 것은 정상이다.
  }
}
load();

/** Intune 등록 스크립트가 호출한다. 같은 hostname 은 갱신된다. */
export function enroll({ hostname, upn, rustdeskId }) {
  const key = hostname.toLowerCase();
  const now = Date.now();
  const device = {
    hostname,
    upn: String(upn || '').toLowerCase(),
    rustdeskId: String(rustdeskId),
    enrolledAt: devices.get(key)?.enrolledAt || now,
    updatedAt: now,
  };
  devices.set(key, device);
  persist();
  return device;
}

/** 세션 생성 시 대상 이메일로 관리 기기를 찾는다. */
export function findByUpn(email) {
  const target = String(email || '').toLowerCase();
  if (!target) return null;
  for (const d of devices.values()) {
    if (d.upn && d.upn === target) return d;
  }
  return null;
}

export function list() {
  return [...devices.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function remove(hostname) {
  const ok = devices.delete(String(hostname).toLowerCase());
  if (ok) persist();
  return ok;
}

/** 등록 스크립트 인증용 공유 비밀값 비교. */
export function verifyEnrollSecret(provided) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(config.enrollSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
