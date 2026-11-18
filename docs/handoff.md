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
| `agent/` supportlink 핸들러 (PowerShell) | ✅ Windows 실기 검증 완료 (링크→핸들러→서버 왕복 성공) → [로컬 검증 결과](#로컬windows-검증-결과--2026-11-16) |
| `deploy/` RustDesk 서버 compose | 🟡 기동·클라이언트 등록·딥링크 수신 확인, **PC 2대 실제 연결만 남음** → [4번 진행 결과](#4번-진행-결과--2026-11-17-pc-1대로-가능한-범위) |
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
  → 2026-11-17: 키 이름 `approve-mode`, 값 `click` 으로 `RustDesk2.toml` `[options]` 에 넣으면 RustDesk 가
  재실행·종료 후에도 지우지 않고 유지한다 (`agent/Set-RustDeskConfig.ps1`). **실제로 수락 창만 뜨는지는 PC 2대로 확인 필요.**
- PowerShell 핸들러 실행 시 콘솔 창이 깜빡이는 정도. 거슬리면 같은 로직을 작은 exe 로.

## 그 다음 할 일 (우선순위 순)

1. 위 검증 결과에 따라 핸들러/딥링크 수정
2. Intune 배포 정책 문서 (유지보수 업체 전달용) — 초안 재료는 `agent/README.md` 하단
3. Oracle Cloud Always Free 세팅 가이드 (ARM 인스턴스, 보안 목록 포트 개방)
4. 대시보드 로그인을 ADMIN_TOKEN → Entra SSO 로
5. 세션 로그·감사 기록
6. 자동화 테스트 추가 (지금은 전부 수동 스크립트였음)


---

## 로컬(Windows) 검증 결과 — 2026-11-16

인수인계 **2번(핸들러 진단)과 3번(실제 링크 왕복)을 실기에서 모두 통과**시켰다.
4번(RustDesk 서버·딥링크)과 5번(Entra)은 그대로 남아 있다.

환경: Windows 11 Enterprise 22631 / Windows PowerShell 5.1 / Node v24.14.1 / RustDesk 1.5.3 /
**비관리자** PowerShell 이라 설치 범위는 HKCU, 설치 폴더는 `%LOCALAPPDATA%\SupportLink\app`.

### 핵심 질문 두 개에 대한 답

- **회사 계정(UPN)** — ✅ **나온다.** `whoami /upn` → `jinkyu.kim@bdo.kr`.
  Entra 가입 PC 에서 정상 반환되므로 `/agent` 403 걱정은 없다. `dsregcmd /status` 폴백 불필요.
- **RustDesk ID 출처** — ✅ **`--get-id` 가 stdout 으로 돌려준다.** 단, **제대로 설치된 exe 일 때만.**
  설치된 바이너리는 `252610` 한 줄만 깔끔하게 출력하고, 핸들러와 동일한
  `Start-Process -RedirectStandardOutput` 방식에서도 그대로 잡힌다.
  설정 파일 폴백은 **못 쓴다** — `RustDesk.toml` 에 평문 `id` 가 없고 `enc_id` 만 있었다
  (클라우드 세션의 걱정이 사실로 확인됨). 즉 **CLI 가 유일한 경로**다.

### 실기 결과

```
[OK]   프로토콜 등록      HKCU → powershell.exe ... -File ...\SupportLinkHandler.ps1 "%1"
[OK]   서버 주소         http://localhost:3000
[OK]   핸들러 인코딩      UTF-8 BOM
[OK]   RustDesk 설치     C:\Users\...\AppData\Local\RustDesk\rustdesk.exe
[OK]   RustDesk ID      252610  (출처: --get-id)
[OK]   회사 계정(UPN)     jinkyu.kim@bdo.kr
[OK]   서버 연결         healthz ok
```

링크 왕복 (3번): 세션 생성 → 개발용 로그인 → 동의 → `Start-Process supportlink://session/<토큰>`
으로 **Windows 셸이 등록된 핸들러를 실제로 띄우는 것까지 확인**. 핸들러 종료 코드 0,
세션 상태 `opened` → `ready`, 대시보드에 `rustdeskId=252610` / `deviceHostname=김진규D` 표시.
가로채기 방지도 재확인 — 다른 UPN 으로 보고 시 403 이고 기존 ID 는 바뀌지 않는다.
(브라우저가 띄우는 "여시겠습니까" 확인창 자체만 미확인. 셸 연결은 검증됨.)

### 발견해서 고친 것

1. **`.ps1` 4개가 UTF-8 BOM 없이 저장되어 PowerShell 5.1 에서 아예 실행이 안 됐다.** (치명적)
   BOM 이 없으면 5.1 이 한글 문자열을 ANSI(CP949) 로 읽어 `The string is missing the terminator`
   류 구문 오류로 죽는다. 핸들러는 레지스트리에 `powershell.exe -File` 로 등록되므로
   **링크를 눌러도 파싱 단계에서 죽고 `handler.log` 에 한 줄도 안 남는다** — 가장 디버깅하기
   나쁜 실패 모드였다. 4개 모두 BOM 추가 + 재발 방지:
   - `Install-SupportLink.ps1` 은 BOM 없는 핸들러면 등록을 거부하고 throw
   - `Test-SupportLink.ps1` 에 `핸들러 인코딩` 점검 항목 추가
2. **`.env` 를 아무도 읽지 않았다.** `dotenv` 의존성도 `--env-file` 플래그도 없어서 1번의
   `copy .env.example .env` → `npm start` 를 그대로 따라가면 `.env` 가 무시되고 `ADMIN_TOKEN` 이
   코드 기본값 `dev-admin-token` 으로 뜬다. **대시보드가 공개된 기본 토큰으로 열려 있는데
   운영자는 바꿨다고 믿는 상태**가 된다. `start`/`dev` 에 `--env-file-if-exists=.env` 추가
   (Node 20.18+ 필요 → `engines` 도 상향). 기본 토큰 401 / `.env` 토큰 200 확인.
3. **`.env.example` 을 복사하면 SMTP 가 켜진 상태였다.** `SMTP_HOST`/`SMTP_USER` 에 값이 있어
   `smtpConfigured` 가 true 가 되고, 2번을 고친 뒤에는 실제로 office365 로 메일을 보내려 든다
   ("콘솔에 링크가 찍힌다" 와 어긋남). SMTP 줄 전부 주석 처리.
4. **`rustdesk.exe` 탐색 범위가 좁았다.** 기존엔 `Program Files` 두 곳만 봤는데, 실제로 ID 를
   읽어낸 경로는 `%LOCALAPPDATA%\RustDesk\rustdesk.exe` 라 **기존 코드로는 못 찾았다.**
   기본 경로 + 사용자 단위 설치 경로 + 레지스트리 `InstallLocation` 까지 보도록 확장.
5. **`--get-id` 출력 파싱이 너무 빡빡했다.** 설치되지 않은(부트스트랩) exe 는 `skip ...`,
   `executing ...`, `Windows version: ...` 같은 줄을 먼저 찍고 ID 를 마지막 줄에 낸다.
   기존엔 출력 **전체**가 `^\d{6,16}$` 여야 해서 이 경우 실패했다. 숫자만으로 된 **마지막 줄**을
   고르도록 변경. 설치된 exe 는 어차피 한 줄이라 동작은 같고, 이상 상황에만 더 버틴다.
6. 설정 파일에 `enc_id` 만 있을 때 로그를 남기도록 추가 (기존엔 조용히 실패).

### 알아둘 것

- **RustDesk 가 winget 카탈로그에 없다.** 이 PC 의 winget 은 정상 동작하고(다른 원격제어 도구는
  다 나옴) 표준 MS CDN 을 쓰는데 `RustDesk.RustDesk` 만 검색되지 않는다. 그래서 공식 GitHub
  릴리스(`rustdesk-1.5.3-x86_64.exe`, 서명 검증: Sectigo EV / PURSLANE, 유효)로 받았다.
  사내 배포(Intune)를 설계할 때 이 점은 미리 확인해둘 것.
- 지금 PC 의 RustDesk 는 `%LOCALAPPDATA%` 에 풀린 **포터블 상태**다. 정식 설치(서비스 등록,
  무인 접속)는 관리자 권한으로 따로 해야 하고, 그때 ID 가 바뀔 수 있다.
- `git` 사용자 이름/메일이 이 PC 에 설정되어 있지 않다(전역·로컬 모두). 커밋 전에
  `git config user.email` 설정 필요.
- `npm audit` 취약점 5건 — critical 은 express 가 끌고 오는 `proxy-addr` (IPv4-mapped IPv6
  신뢰 서브넷 스푸핑). `npm audit fix` 로 해결 가능. 별건.

### 다음에 할 일

1. 4번 RustDesk 서버 + 딥링크 (PC 2대, 21116/UDP) — `docs/deeplink-test.md` 순서대로
2. 5번 Entra 앱 등록해서 실제 로그인 연결
3. Intune 배포 정책 문서 (BOM·관리자 설치 범위·winget 부재 반영)

---

## 4번 진행 결과 — 2026-11-17 (PC 1대로 가능한 범위)

### 된 것

- **RustDesk 서버 기동** — `deploy/.env` 에 `RELAY_HOST=192.168.100.191`(이 PC 의 LAN IP) 넣고
  `docker compose up -d`. hbbs/hbbr 둘 다 정상, 21115·21116·21117 TCP 응답 확인.
  서버 공개키는 `deploy/data/id_ed25519.pub` (Docker 재시작 후에도 유지됨).
- **클라이언트 → 자체 서버 등록** — `%APPDATA%\RustDesk\config\RustDesk2.toml` 에 아래를 넣고
  RustDesk 를 실행하니 hbbs 로그에 `update_pk 252610` 이 찍혔다.
  ```toml
  [options]
  custom-rendezvous-server = '192.168.100.191'
  relay-server = '192.168.100.191'
  key = '<deploy/data/id_ed25519.pub 내용>'
  ```
  설정 화면에서 손으로 넣지 않아도 이 파일만 배포하면 된다 → Intune 배포에 그대로 쓸 수 있다.
- **딥링크 수신 (deeplink-test.md 2번의 앞 절반)** — 공식 클라이언트 1.5.3 에
  `rustdesk://connection/new/123456789` 를 넘기자 **즉시 연결을 시작**했다. RustDesk 로그:
  `Session 123456789 start` → `rendezvous server: 192.168.100.191:21116` → `ID does not exist`
  (가짜 ID 라 정상). 즉 **URL 형식은 공식 클라이언트가 그대로 지원하고, 조회도 자체 서버로 간다.
  커스텀 클라이언트는 필요 없을 가능성이 높다.**

### 안 된 것 / 남은 것

- **deeplink-test.md 1번 (`rustdesk://` 프로토콜 등록)** — 포터블 실행 상태에서는 레지스트리에
  등록되지 않는다(HKLM·HKCU 모두 없음). 위 테스트는 exe 에 URL 을 인자로 직접 넘겨서 했다.
  브라우저에서 `rustdesk://` 가 열리려면 **정식 설치(관리자 권한)** 가 필요하다.
- **실제 연결 + 수락(approve-mode=click) + 딥링크 3·4번** — PC 2대가 있어야 한다.
- **방화벽** — 이 PC 는 Private 프로필 방화벽이 켜져 있고 Docker/RustDesk 용 인바운드 허용
  규칙이 없다. 두 번째 PC 가 접속이 안 되면 관리자 PowerShell 에서 아래를 실행해야 한다.
  ```powershell
  New-NetFirewallRule -DisplayName "RustDesk Server TCP" -Direction Inbound -Protocol TCP -LocalPort 21115-21119 -Action Allow -Profile Private
  New-NetFirewallRule -DisplayName "RustDesk Server UDP" -Direction Inbound -Protocol UDP -LocalPort 21116 -Action Allow -Profile Private
  ```

### 겪은 문제

- **Docker Desktop 이 시작하자마자 죽었다.** `%LOCALAPPDATA%\Docker\run\dockerInference`,
  `%LOCALAPPDATA%\docker-secrets-engine\engine.sock` 에 2026-05-13 자 소켓 파일이 남아 있었고,
  Docker 가 시작하면서 이걸 지우려다 `The file cannot be accessed by the system` 으로 실패했다.
  **이 PC 에서는 AF_UNIX 소켓 파일이 어떤 방법으로도 삭제되지 않는다**
  (`Remove-Item`·`del`·`fsutil` 모두 같은 오류, afunix 드라이버는 정상). 원인은 미확정이고
  보안 제품(Avast 가 설치되어 있음) 필터 드라이버를 의심한다.
  폴더 이름을 바꿔 치우는 것으로 우회했고(`run.stale-*`, `docker-secrets-engine.stale-*`),
  직후 Docker Desktop 이 4.67.0 → 최신으로 자동 업데이트되면서 새 버전은 같은 우회를 스스로 한다.
  서버를 이 PC 에 계속 둘 건 아니니(운영은 Oracle Cloud 예정) 더 파지는 않았다.
- 클라이언트 로그에 `http://<서버>:21114/api/heartbeat failed` 경고가 계속 찍힌다. 21114 는
  RustDesk Server Pro 의 API 포트라 OSS 서버에는 없다. 무해하지만 로그를 볼 때 헷갈리지 말 것.
- `deploy/data/` (서버 개인키 `id_ed25519` 포함) 가 지금 OneDrive 동기화 폴더 안에 있다.
  로컬 검증용이라 그대로 뒀지만, 실제 서버에서는 동기화되지 않는 경로에 둘 것.

### 클라이언트 설정 스크립트 (2026-11-17 추가)

`agent/Set-RustDeskConfig.ps1` — 위 `[options]` 값과 `approve-mode = 'click'` 을 `RustDesk2.toml` 에 넣는다.
다른 옵션은 그대로 두고, RustDesk 가 실행 중이면 멈춘다(`-Force` 면 종료 후 진행). 관리자 권한이면
정식 설치 서비스가 읽는 `%WINDIR%ServiceProfilesLocalServiceAppDataRoamingRustDeskconfig` 에도 쓴다
(이 경로는 RustDesk 문서 기준이고 아직 실기 확인 전).

이 PC 에서 확인한 것: 스크립트 실행 → RustDesk 재실행 → 종료 후에도 `approve-mode = 'click'` 이 남아 있음.
확인 못 한 것: 실제 접속 시 비밀번호 칸 없이 수락 창만 뜨는지 (상대 PC 필요).

### 두 번째 PC 에서 할 일

1. RustDesk 1.5.3 설치(가능하면 정식 설치), 이 저장소의 `agent` 폴더 복사
2. PowerShell 에서 (서비스 경로까지 쓰려면 관리자):
   ```powershell
   .Set-RustDeskConfig.ps1 -Server 192.168.100.191 -Key '<deploy/data/id_ed25519.pub 내용>' -Force
   ```
   그 후 RustDesk 실행 → 메인 화면 아래쪽이 '준비됨' 이면 자체 서버에 붙은 것
3. 이 PC(192.168.100.191)와 같은 LAN 인지 확인. 안 붙으면 위 방화벽 규칙 추가
4. 이 PC 에서 두 번째 PC 의 ID 로 `rustdesk://connection/new/<ID>` → 상대 쪽에 **수락 창만** 뜨는지 확인
5. `docs/deeplink-test.md` 3·4번, 그리고 접속 중 CPU·메모리 측정
6. 링크 흐름 전체까지 보려면: 이 PC `.env` 의 `BASE_URL` 을 `http://192.168.100.191:3000` 으로 바꿔 재기동,
   두 번째 PC 에서 `Install-SupportLink.ps1 -ServerBase http://192.168.100.191:3000`,
   방화벽에 3000/TCP 추가. (지금 세션 서버는 꺼져 있다 — `npm start` 로 다시 띄울 것)
