// 환경 변수 기반 설정. .env.example 참고.
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),

  // 링크에 들어갈 공개 주소. 실제 배포 시 https 도메인으로 교체.
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),

  // 지원자(운영자) 대시보드 접근 토큰. 원격 접속 도구이므로 반드시 설정할 것.
  adminToken: env.ADMIN_TOKEN || 'dev-admin-token',

  // 세션 링크 유효 시간(분)
  sessionTtlMinutes: Number(env.SESSION_TTL_MINUTES || 15),

  // 회사 테넌트(Entra ID) 로그인. 링크를 받은 사람이 본인인지 확인하는 데 쓴다.
  entra: {
    tenantId: env.ENTRA_TENANT_ID || '',
    clientId: env.ENTRA_CLIENT_ID || '',
    clientSecret: env.ENTRA_CLIENT_SECRET || '',
    redirectUri: env.ENTRA_REDIRECT_URI || '',
  },

  // 자체 호스팅 RustDesk 서버 정보 (클라이언트 설정 안내 및 딥링크 생성에 사용)
  rustdesk: {
    idServer: env.RUSTDESK_ID_SERVER || '',
    relayServer: env.RUSTDESK_RELAY_SERVER || '',
    apiServer: env.RUSTDESK_API_SERVER || '',
    key: env.RUSTDESK_KEY || '',
  },

  // 회사 SMTP. 미설정 시 콘솔로 출력하는 개발용 전송기를 사용한다.
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'IT 원격지원 <noreply@example.com>',
  },
};

export const smtpConfigured = Boolean(config.smtp.host && config.smtp.user);
