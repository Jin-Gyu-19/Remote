# SupportLink 핸들러

사내 PC 에 배포되는 아주 작은 프로그램. 안내 페이지에서 직원이 **동의**를 누르면 브라우저가
`supportlink://session/<토큰>` 을 열고, Windows 가 이 핸들러를 실행한다.
핸들러는 그 순간 이 PC 의 RustDesk ID 를 읽어 세션 서버에 알린 뒤 종료한다.

브라우저는 로컬 파일을 읽을 수 없으므로, 이 한 가지 일을 대신하는 다리 역할이다.
이게 있어야 직원이 ID 를 보거나 불러줄 필요가 없어진다.

## 동작

```
동의 클릭
  → 브라우저: supportlink://session/abc123
  → Windows: powershell.exe -File SupportLinkHandler.ps1 "supportlink://session/abc123"
  → 핸들러: RustDesk ID + PC 이름 + 로그인 계정(UPN) 수집
  → POST https://support.company.com/api/s/abc123/agent
  → 종료
```

서버는 다음을 모두 만족할 때만 접수한다.

- 세션이 **회사 계정 로그인**과 **동의**를 마친 상태
- 보고한 PC 의 로그인 계정(UPN)이 **세션을 인증한 계정과 동일**

마지막 조건이 중요하다. 다른 사람의 세션 링크를 이 PC 에서 열게 만들어
접속 정보를 가로채는 시도를 막는다.

## 안전 장치

- 서버 주소는 설치 시 `config.json` 에 고정된 값만 쓴다. **링크에 담긴 어떤 값도 접속 주소로 쓰지 않는다.**
- 링크는 정해진 형태(`supportlink://session/<base64url 토큰>`)만 받는다.
- 하는 일은 HTTP POST 한 번뿐이며, 원격 제어 기능은 전혀 없다.
- 로그: `%LOCALAPPDATA%\SupportLink\handler.log`

## 파일

| 파일 | 역할 |
|---|---|
| `SupportLinkHandler.ps1` | 핸들러 본체 |
| `Install-SupportLink.ps1` | 파일 배치 + 프로토콜 등록 |
| `Uninstall-SupportLink.ps1` | 제거 |
| `Test-SupportLink.ps1` | 이 PC 에서 동작 조건 점검 (서버에 아무것도 보내지 않음) |

PowerShell 5.1(Windows 기본 내장)로 동작하며 별도 설치가 필요 없다.

## 수동 설치 (테스트용)

관리자 PowerShell 에서:

```powershell
.\Install-SupportLink.ps1 -ServerBase https://support.company.com
.\Test-SupportLink.ps1
```

관리자가 아니면 현재 사용자 범위(HKCU)로 설치된다.

### 점검 항목

`Test-SupportLink.ps1` 은 다음을 순서대로 확인한다. 어디서 `[문제]` 가 뜨는지 보면 원인을 바로 알 수 있다.

1. 프로토콜 등록 여부와 등록된 명령
2. `config.json` 의 서버 주소
3. RustDesk 설치 위치
4. RustDesk ID (`rustdesk.exe --get-id` → 설정 파일 순서)
5. 회사 계정(UPN) — 회사 가입(Entra joined) PC 에서만 값이 나온다
6. 서버 `/healthz` 응답

### 실제 링크로 테스트

1. 대시보드에서 본인 이메일로 링크 발송
2. 메일 링크 → 회사 계정 로그인 → 동의
3. 브라우저가 "SupportLink 원격지원을 여시겠습니까?" 라고 물으면 허용 (처음 한 번)
4. 안내 페이지가 몇 초 안에 "담당자에게 전달되었습니다" 로 바뀌면 성공
5. 안 바뀌면 `handler.log` 확인

## Intune 배포 (유지보수 업체 전달용)

- **배포 방식**: Win32 앱 또는 PowerShell 스크립트, **SYSTEM 권한**으로 실행 → HKLM 에 등록되어 모든 사용자에게 적용
- **설치 명령**: `powershell.exe -ExecutionPolicy Bypass -File Install-SupportLink.ps1 -ServerBase https://support.company.com`
- **제거 명령**: `powershell.exe -ExecutionPolicy Bypass -File Uninstall-SupportLink.ps1`
- **탐지 규칙**: 레지스트리 `HKLM\Software\Classes\supportlink\shell\open\command` 존재
- **선행 조건**: RustDesk 클라이언트가 먼저 설치되어 ID 가 발급되어 있어야 한다

### 브라우저 확인창 없애기 (선택)

처음 링크를 열 때 Edge/Chrome 이 "이 사이트에서 SupportLink 를 열도록 허용" 확인창을 띄운다.
Intune 브라우저 정책으로 미리 허용해두면 이 단계도 사라진다.

- Edge: `AutoLaunchProtocolsFromOrigins`
- Chrome: `AutoLaunchProtocolsFromOrigins`

```json
[{ "protocol": "supportlink", "allowed_origins": ["https://support.company.com"] }]
```

## 알려진 한계

- PowerShell 로 실행되므로 링크를 열 때 **콘솔 창이 아주 짧게 깜빡일 수 있다.** 동작에는 영향 없다.
  거슬리면 나중에 같은 로직을 작은 exe 로 바꿀 수 있다.
- 회사 가입이 아닌 PC(개인 PC, 외부 게스트)에서는 UPN 을 얻을 수 없어 핸들러가 동작하지 않는다.
  이 경우 안내 페이지가 자동으로 직접 입력 화면으로 넘어간다.
