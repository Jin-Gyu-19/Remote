<#
.SYNOPSIS
  supportlink:// 링크가 눌렸을 때 Windows 가 실행하는 핸들러.

.DESCRIPTION
  안내 페이지에서 직원이 '동의' 를 누르면 브라우저가 supportlink://session/<토큰> 을 연다.
  이 스크립트는 그 순간 이 PC 의 RustDesk ID 를 읽어 세션 서버에 알린다.
  하는 일은 그것뿐이며, 서버 주소는 설치 시 config.json 에 고정된 값만 사용한다.
  링크에 담긴 어떤 값도 접속 주소로 쓰지 않는다.

  PowerShell 5.1 (Windows 기본 내장) 에서 동작한다.
#>
param([Parameter(Mandatory = $true)][string]$Url)

$ErrorActionPreference = 'Stop'
$HandlerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $env:LOCALAPPDATA 'SupportLink'
$LogFile = Join-Path $LogDir 'handler.log'

function Write-Log([string]$Message) {
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
}

# ── 1. 설정: 서버 주소는 설치 시 고정된 값만 신뢰한다 ──
$configPath = Join-Path $HandlerDir 'config.json'
if (-not (Test-Path $configPath)) { Write-Log "config.json 없음: $configPath"; exit 10 }
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$serverBase = [string]$config.serverBase
if ($serverBase -notmatch '^https?://[^/\s]+$') { Write-Log "serverBase 형식 오류: $serverBase"; exit 11 }

# ── 2. 링크 검사: 정해진 형태의 토큰만 받는다 ──
if ($Url -notmatch '^supportlink://session/([A-Za-z0-9_-]{20,64})/?$') {
  Write-Log "허용되지 않는 링크: $Url"; exit 12
}
$token = $Matches[1]

# ── 3. 이 PC 의 RustDesk ID ──
#   1순위: 공식 CLI (rustdesk.exe --get-id). 최신 버전은 설정 파일의 id 가 비어 있고
#          암호화된 enc_id 만 있을 수 있어 CLI 가 가장 확실하다.
#   2순위: 설정 파일의 id 값 (구버전 호환)
$rustdeskId = $null
$exe = @(
  (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($exe) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    $proc = Start-Process -FilePath $exe -ArgumentList '--get-id' -RedirectStandardOutput $tmp `
              -WindowStyle Hidden -PassThru
    if ($proc.WaitForExit(5000)) {
      $out = ([string](Get-Content $tmp -Raw -ErrorAction SilentlyContinue)).Trim()
      if ($out -match '^\d{6,16}$') { $rustdeskId = $out }
      else { Write-Log "--get-id 출력이 ID 형식이 아님: '$out'" }
    } else {
      try { $proc.Kill() } catch { }
      Write-Log '--get-id 응답 없음 (5초 초과)'
    }
  } catch { Write-Log "--get-id 실행 실패: $($_.Exception.Message)" }
  finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

if (-not $rustdeskId) {
  $tomlPaths = @(
    (Join-Path $env:APPDATA 'RustDesk\config\RustDesk.toml'),
    (Join-Path $env:WINDIR  'ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\RustDesk.toml')
  )
  foreach ($p in $tomlPaths) {
    if (-not (Test-Path $p)) { continue }
    try {
      $toml = Get-Content $p -Raw -Encoding UTF8
      if ($toml -match "(?m)^\s*id\s*=\s*'(\d{6,16})'") { $rustdeskId = $Matches[1]; break }
    } catch { Write-Log "설정 읽기 실패 ($p): $($_.Exception.Message)" }
  }
}
if (-not $rustdeskId) {
  Write-Log 'RustDesk ID 를 찾지 못함 (RustDesk 미설치 또는 아직 ID 미발급)'; exit 13
}

# ── 4. 이 PC 에 로그인한 회사 계정 ──
#   서버가 세션을 인증한 계정과 대조한다. 회사 가입(Entra joined) PC 에서만 값이 나온다.
$upn = ''
try { $upn = (& whoami.exe /upn 2>$null | Select-Object -First 1) } catch { }
$upn = [string]$upn
$upn = $upn.Trim()
if ($upn -notmatch '^[^@\s]+@[^@\s]+$') {
  Write-Log '회사 계정(UPN) 을 확인할 수 없음 - 회사 가입 PC 가 아닌 것으로 보임'; exit 14
}

# ── 5. 서버에 알림 ──
$body = @{
  rustdeskId = $rustdeskId
  hostname   = $env:COMPUTERNAME
  upn        = $upn
} | ConvertTo-Json -Compress

$uri = '{0}/api/s/{1}/agent' -f $serverBase, $token
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $null = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json; charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10
  Write-Log "전달 완료: id=$rustdeskId host=$env:COMPUTERNAME upn=$upn"
  exit 0
} catch {
  $status = ''
  try { $status = [int]$_.Exception.Response.StatusCode } catch { }
  Write-Log "전달 실패 [$status]: $($_.Exception.Message)"
  exit 20
}
