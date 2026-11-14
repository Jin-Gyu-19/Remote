# 원격지원 (Remote Support) — 프로젝트 안내

이메일 링크 하나로 시작하는 사내 원격지원 도구. 피지원자는 **링크 클릭 → 회사 계정 로그인 → 동의**만 하면 되고,
프로그램 실행 안내나 접속 코드 불러주기가 없다. 원격제어 엔진은 자체 호스팅 RustDesk, 이 저장소는 그 앞단이다.

현재 진행 상황과 다음 할 일은 `docs/handoff.md` 를 먼저 읽을 것.

## 확정된 설계 결정 (다시 논의하지 말 것)

사용자와 여러 번 질문지를 거쳐 확정한 것들이다. 바꾸려면 사용자에게 먼저 물어본다.

1. **자체 개발 원격엔진 X, RustDesk 자체 호스팅 O.** 백신/SmartScreen 문제와 개발량 때문.
2. **기기 사전 등록 없음.** 접속 대상은 "인증된 사용자가 링크를 연 바로 그 PC". 핸들러가 그 순간 ID 를 보고한다.
   한 사람이 PC 여러 대를 써도 지금 쓰는 PC 가 자동으로 대상이 된다.
3. **접속 비밀번호 없음.** Intune 으로 `approve-mode=click` 을 배포해 승인은 피지원자의 수락 클릭으로만 한다.
   서버가 보관하는 비밀번호가 없다.
4. **신원 확인은 Entra ID 로그인.** 테넌트는 M365 E3 (Intune 포함). 외부 상대는 Entra B2B 게스트로 초대.
5. **메일은 회사 SMTP.** 서버는 Oracle Cloud Always Free 예정. Cloudflare 는 웹 부분만 가능(hbbs/hbbr 불가).
6. **Intune 정책 배포는 유지보수 업체가 한다.** 우리는 전달용 문서와 스크립트를 만든다.
7. 사용자는 **반말**로 대화한다. 질문이 여러 갈래면 AskUserQuestion 질문지를 선호한다.

## 구조

```
server/src/index.js    라우트 (운영자 API, 로그인, 피지원자 API)
server/src/auth.js     Entra 로그인, 게스트 UPN 정규화, 초대 대상 대조
server/src/store.js    세션 저장 (JSON 파일, 링크 토큰 상수 시간 비교)
server/src/landing.js  피지원자 안내 페이지 (로그인→동의→대기→완료)
server/src/mailer.js   회사 SMTP 발송 (미설정 시 콘솔 출력)
server/public/         지원자 대시보드
agent/                 supportlink:// 핸들러 (PowerShell) + 설치/제거/진단 스크립트
deploy/                RustDesk 서버 docker-compose
docs/                  handoff, 딥링크 검증 절차
```

## 연결 흐름

```
대시보드 링크 발송 → 메일 클릭 → Entra 로그인(초대 계정과 대조) → 동의
  → 페이지가 supportlink://session/<토큰> 호출 → 핸들러가 RustDesk ID + 호스트명 + UPN 을 POST /api/s/<토큰>/agent
  → 대시보드 '연결' 활성 → rustdesk://connection/new/<id> → 피지원자 화면 '수락' → 연결
핸들러 없는 기기(게스트 등)는 대기 후 직접 입력 폼으로 자동 폴백.
```

세션 상태: `created → authed → opened(동의) → ready → ended/expired`

## 실행과 테스트

```bash
npm install && npm start          # http://localhost:3000, /healthz
```
- SMTP 미설정 → 콘솔에 링크 출력. Entra 미설정 → `/auth/login/:token` 이 개발용 로그인 폼으로 대체.
- 둘 다 기동 로그에 경고가 남는다. 이 폴백 덕분에 자격증명 없이 전체 흐름을 검증할 수 있다.
- 자동화 테스트 파일은 아직 없다. 지금까지는 curl 과 Playwright 스크립트로 수동 검증했다
  (검증한 항목 목록은 `docs/handoff.md`).
- 서버를 백그라운드로 띄워 테스트할 때 `pkill -f "node server/src/index"` 는 **자기 쉘까지 죽인다.**
  PID 를 받아 `kill $PID` 하거나 `pgrep -f "node server/[s]rc/index"` 패턴을 쓸 것.

## 보안 불변 조건 (코드 수정 시 깨뜨리지 말 것)

- 링크 토큰은 운영자 API 응답(`publicView`)과 목록에 **절대 포함하지 않는다.**
- 동의(`/accept`), 핸들러 보고(`/agent`), 직접 입력(`/ready`) 은 **`isAuthed(session)` 통과 후에만** 처리한다.
- `/agent` 는 보고한 PC 의 UPN 이 `session.authedUpn` 과 **같을 때만** 접수한다 (세션 가로채기 방지). 없거나 다르면 403.
- 핸들러는 서버 주소를 **설치 시 고정된 config.json 에서만** 읽는다. 링크에 담긴 값을 접속 주소로 쓰지 않는다.
- 세션 종료/만료 시 `connectPassword` 를 지운다. 만료·종료된 링크는 410.
- 대시보드 '본인확인' 표시는 `authMatched` 로 판단한다. `authedUpn` 존재 여부로 판단하면 불일치 로그인도 확인된 것처럼 보인다(실제로 있었던 버그).

## 코드 규칙

- 주석과 사용자 노출 문구는 한국어. 주석은 "왜" 를 쓴다.
- 의존성 최소 (express, nodemailer, @azure/msal-node). 네이티브 모듈 피한다.
- Playwright 는 `--no-save` 로만 설치한다 (의존성에 넣지 않음). 다른 패키지 설치 시 지워지므로 다시 깔 것.
- 커밋 메시지는 한국어, 무엇을 왜 바꿨는지 본문에 쓴다. 브랜치: `claude/find-remote-support-chat-svbhts`.
- 커밋 메시지·코드에 모델명을 쓰지 않는다.
