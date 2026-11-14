# 인수인계 — 2026-11-14 기준

클라우드 세션(리눅스 컨테이너)에서 여기까지 만들었다. 서버 쪽은 전부 실행해서 검증했지만,
**Windows·Docker·RustDesk 클라이언트가 필요한 것은 하나도 실기 검증을 못 했다.**
이 문서는 그걸 로컬(Windows) 세션에서 이어서 하기 위한 것이다.

## 현재 상태

전부 `origin/claude/find-remote-support-chat-svbhts` 에 푸시됨.

| 구성 | 상태 |
|---|---|
| 세션 발급 서버 (링크·메일·상태·만료) | ✅ 완료, curl 로 전 경로 검증 |
| Entra 로그인 + 게스트 UPN 정규화 + 초대 대상 대조 | ✅ 완료 (개발용 로그인으로 흐름 검증, **실제 Entra 미연결**) |
| 지원자 대시보드 / 피지원자 안내 페이지 | ✅ 완료, Playwright 로 렌더·동작 확인 |
| `/agent` 세션 가로채기 방지 (UPN 대조) | ✅ 완료, 공격 시나리오 403 확인 |
| `agent/` supportlink 핸들러 (PowerShell) | ⚠️ 작성 완료, **한 번도 실행 안 됨** |
| `deploy/` RustDesk 서버 compose | ⚠️ 작성 완료, **띄워본 적 없음** |
| 클릭 프로토타입 | ✅ https://claude.ai/code/artifact/4c58195a-3b97-4aeb-a289-f3854c7a6d16 |

### 서버에서 검증 완료한 항목

- 인증 없는 운영자 API 401 / 잘못된 토큰 404 / 만료·종료 링크 410 / 목록에 토큰 미노출
- 로그인 전 `/accept` `/agent` 403 → 다른 계정 로그인 시 링크 403 + 대시보드 빨간 경고 → 올바른 계정 로그인 → 동의 → 핸들러 보고 → `ready`
- 게스트 UPN `partner_outside.co.kr#EXT#@bdo.onmicrosoft.com` → `partner@outside.co.kr` 로 정규화되어 매칭
- 동의 전 `/agent` 409 / UPN 없음 403 / 다른 PC 계정 403 / 같은 계정 200
- 직접 입력 폴백은 비밀번호 없이 ID 만으로 통과

## Windows 에서 할 일 — 이 순서로

### 1. 서버 띄우기 (5분)

```powershell
git clone https://github.com/Jin-Gyu-19/Remote
cd Remote
git checkout claude/find-remote-support-chat-svbhts
npm install
copy .env.example .env      # ADMIN_TOKEN 만 아무 값으로 바꾸면 됨
npm start
```
http://localhost:3000 에서 토큰 넣고 본인 메일로 링크 발송 → 콘솔에 링크가 찍힌다 (SMTP 미설정이라).

### 2. 핸들러 진단 (가장 중요, 10분)

관리자 PowerShell:
```powershell
cd agent
.\Install-SupportLink.ps1 -ServerBase http://localhost:3000
.\Test-SupportLink.ps1
```
`[문제]` 가 뜨는 줄을 그대로 기록할 것. 특히 확인하고 싶은 두 가지:

- **RustDesk ID 출처** — `--get-id` 로 잡히는지, 설정 파일 폴백으로 잡히는지, 둘 다 실패하는지.
  최신 RustDesk 는 설정 파일 `id` 가 비어 있고 `enc_id` 만 있을 수 있어서 CLI 를 1순위로 뒀다.
  `--get-id` 가 아무것도 출력하지 않거나 창만 띄우면 이 부분을 손봐야 한다.
- **회사 계정(UPN)** — `whoami /upn` 이 `user@domain` 을 돌려주는지. Entra 가입 PC 면 나와야 한다.
  안 나오면 `/agent` 가 403 이 되므로 UPN 을 얻는 다른 방법(dsregcmd /status 등)을 찾아야 한다.

### 3. 핸들러 실제 링크로 끝까지 (10분)

1 에서 받은 링크를 브라우저에 열기 → 개발용 로그인(본인 메일 그대로) → 동의
→ 브라우저가 "SupportLink 원격지원을 여시겠습니까" 물으면 허용
→ 몇 초 안에 "담당자에게 전달되었습니다" 로 바뀌고, 대시보드에 ID 와 PC 이름이 뜨면 성공.

실패하면 `%LOCALAPPDATA%\SupportLink\handler.log` 를 볼 것. 종료 코드 의미:
10/11 설정 문제, 12 링크 형식, 13 RustDesk ID 못 찾음, 14 UPN 못 찾음, 20 서버 전송 실패(본문에 HTTP 코드).

### 4. RustDesk 서버 + 딥링크 (PC 2대 필요)

```powershell
cd deploy
copy .env.example .env      # RELAY_HOST = 이 PC 의 LAN IP
docker compose up -d
```
양쪽 RustDesk 클라이언트의 ID/릴레이 서버를 이 주소로 바꾸고 서로 연결되는지 먼저 확인
(**21116/UDP** 안 열면 안 됨). 그다음 `docs/deeplink-test.md` 의 항목을 순서대로.
핵심은 `rustdesk://connection/new/<id>` 가 지원자 PC 에서 연결 창을 바로 띄우는가.

### 5. Entra 앱 등록 (실제 로그인 연결)

Azure 포털 → 앱 등록: 리디렉션 URI(웹) `http://localhost:3000/auth/callback` (테스트용),
클라이언트 비밀 발급, 위임 권한 `openid profile email`. `.env` 에 `ENTRA_*` 넣고 재기동하면
개발용 로그인 대신 진짜 Microsoft 로그인이 뜬다. 게스트 테스트는 외부 메일 하나를 B2B 초대해서.

## 확신이 없는 부분 (실기에서 확인 필요)

- `rustdesk.exe --get-id` 가 stdout 으로 ID 를 돌려주는지. 버전에 따라 다를 수 있다.
- 공식 RustDesk 클라이언트의 `rustdesk://connection/new/<id>` 지원 범위. 안 되면 사내 경로는
  고정 비밀번호 방식으로 우회하거나 커스텀 클라이언트가 필요하다 (`docs/deeplink-test.md` 의 결과 해석표).
- `approve-mode=click` 을 Intune 정책/설정 파일로 미리 박을 수 있는지와 정확한 키 이름.
- PowerShell 핸들러 실행 시 콘솔 창이 깜빡이는 정도. 거슬리면 같은 로직을 작은 exe 로.

## 그 다음 할 일 (우선순위 순)

1. 위 검증 결과에 따라 핸들러/딥링크 수정
2. Intune 배포 정책 문서 (유지보수 업체 전달용) — 초안 재료는 `agent/README.md` 하단
3. Oracle Cloud Always Free 세팅 가이드 (ARM 인스턴스, 보안 목록 포트 개방)
4. 대시보드 로그인을 ADMIN_TOKEN → Entra SSO 로
5. 세션 로그·감사 기록
6. 자동화 테스트 추가 (지금은 전부 수동 스크립트였음)
