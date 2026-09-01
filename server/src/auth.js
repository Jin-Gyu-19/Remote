// Microsoft Entra ID(회사 테넌트) 로그인.
// 링크를 받은 사람이 실제로 그 계정의 소유자인지 확인하는 것이 목적이며,
// 확인이 끝나야 원격 연결 단계로 넘어간다.
//
// Entra 설정이 없으면 개발용 로그인으로 대체된다. 실제 배포에서는 반드시 설정할 것.
import { ConfidentialClientApplication } from '@azure/msal-node';
import { config } from './config.js';

const SCOPES = ['openid', 'profile', 'email'];

export const entraConfigured = Boolean(
  config.entra.tenantId && config.entra.clientId && config.entra.clientSecret,
);

const msal = entraConfigured
  ? new ConfidentialClientApplication({
      auth: {
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret,
        authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
      },
    })
  : null;

export function authMode() {
  return entraConfigured ? `entra(${config.entra.tenantId})` : 'dev(개발용 로그인)';
}

function redirectUri() {
  return config.entra.redirectUri || `${config.baseUrl}/auth/callback`;
}

/** 로그인 화면으로 보낼 주소. state 에 세션 링크 토큰을 실어 되돌아올 곳을 지정한다. */
export async function loginUrl(token) {
  return msal.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: redirectUri(),
    state: token,
    // 계정 선택을 매번 묻게 해 공용 PC 에서 다른 사람 계정이 물려 들어가는 것을 막는다.
    prompt: 'select_account',
  });
}

/**
 * 인가 코드를 교환해 로그인한 사용자를 확인한다.
 * @returns {{ upn: string, name: string, tenantId: string }}
 */
export async function exchangeCode(code) {
  const result = await msal.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: redirectUri(),
  });
  const claims = result.idTokenClaims || {};
  const upn = (claims.preferred_username || result.account?.username || '').toLowerCase();
  if (!upn) throw new Error('로그인 정보에서 계정을 확인할 수 없습니다');
  return {
    upn,
    name: claims.name || result.account?.name || upn,
    tenantId: claims.tid || result.account?.tenantId || '',
    // 게스트로 초대된 외부 사용자는 홈 테넌트가 달라 별도로 구분된다.
    isGuest: claims.acct === 1 || /#EXT#/i.test(claims.preferred_username || ''),
  };
}

/**
 * 로그인한 계정이 이 세션의 대상자인지 확인한다.
 * 게스트 초대 계정은 UPN 이 변형되므로(user_domain.com#EXT#@tenant) 원래 주소로 비교한다.
 */
export function matchesInvitee(upn, invitedEmail) {
  const a = normalizeUpn(upn);
  const b = String(invitedEmail || '').toLowerCase().trim();
  return Boolean(a && b && a === b);
}

/**
 * 화면에 보여줄 이름. 게스트 계정은 표시 이름이 없거나 변형된 UPN 이 그대로 오는 경우가 있어,
 * 그럴 때는 원래 메일 주소의 앞부분을 쓴다.
 */
export function displayName(user) {
  const name = String(user?.name || '').trim();
  const raw = String(user?.upn || '').toLowerCase();
  const usable = name && !/#ext#/i.test(name) && name.toLowerCase() !== raw;
  return usable ? name : normalizeUpn(raw).split('@')[0];
}

/** 게스트 계정의 UPN 을 초대에 사용한 원래 메일 주소로 되돌린다. */
export function normalizeUpn(upn) {
  const raw = String(upn || '').toLowerCase().trim();
  const ext = raw.match(/^(.+?)#ext#@/);
  if (!ext) return raw;
  // user_domain.com#EXT#@tenant.onmicrosoft.com -> user@domain.com
  const i = ext[1].lastIndexOf('_');
  return i === -1 ? ext[1] : ext[1].slice(0, i) + '@' + ext[1].slice(i + 1);
}
