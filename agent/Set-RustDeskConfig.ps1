<#
.SYNOPSIS
  RustDesk 클라이언트를 자체 서버에 붙이고, 승인 방식을 '수락 클릭'으로 고정한다.

.DESCRIPTION
  RustDesk2.toml 의 [options] 에 아래 값을 넣는다. 다른 옵션은 건드리지 않는다.
    custom-rendezvous-server / relay-server  자체 서버 주소
    key                                      서버 공개키 (deploy/data/id_ed25519.pub)
    approve-mode = 'click'                   비밀번호 없이 피지원자 '수락' 클릭으로만 승인

  설정 화면에서 손으로 넣는 대신 이 파일을 쓰는 이유: Intune 으로 같은 값을 그대로 배포할 수 있다.
  RustDesk 는 실행 중에 메모리의 설정으로 이 파일을 덮어쓰므로, 반드시 끈 상태에서 써야 한다.

  관리자 권한이면 정식 설치(서비스) 가 읽는 서비스 프로필 경로에도 같이 쓴다.

.EXAMPLE
  .\Set-RustDeskConfig.ps1 -Server 192.168.100.191 -Key 'Pqa41...ssc=' -Force
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Key,
  [ValidateSet('click', 'password', '')][string]$ApproveMode = 'click',
  # 실행 중인 RustDesk 를 종료하고 진행한다. 없으면 실행 중일 때 멈춘다.
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

if ($Server -notmatch '^[A-Za-z0-9.\-]+(:\d+)?$') { throw "Server 는 호스트 또는 호스트:포트 형태여야 합니다: $Server" }
if ($Key -notmatch '^[A-Za-z0-9+/]{43}=$') { throw "Key 형식이 아닙니다 (deploy/data/id_ed25519.pub 내용 그대로): $Key" }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# 1. 실행 중이면 끈다 (안 끄면 종료 시 우리가 쓴 값이 덮어써진다)
$procs = @(Get-Process -Name rustdesk -ErrorAction SilentlyContinue)
$svc = Get-Service -Name RustDesk -ErrorAction SilentlyContinue
$svcWasRunning = $svc -and $svc.Status -eq 'Running'
if ($procs.Count -gt 0 -or $svcWasRunning) {
  if (-not $Force) { throw "RustDesk 가 실행 중입니다. 종료 후 다시 실행하거나 -Force 를 붙이세요." }
  if ($svcWasRunning) {
    if (-not $isAdmin) { throw "RustDesk 서비스가 실행 중이라 관리자 권한이 필요합니다." }
    Stop-Service -Name RustDesk -Force
  }
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# 2. 설정 파일 위치
$targets = @(Join-Path $env:APPDATA 'RustDesk\config\RustDesk2.toml')
if ($isAdmin) {
  # 정식 설치 시 서비스(LocalService 프로필) 가 읽는 경로
  $targets += Join-Path $env:WINDIR 'ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\RustDesk2.toml'
}

$values = [ordered]@{
  'custom-rendezvous-server' = $Server
  'relay-server'             = $Server
  'key'                      = $Key
  'approve-mode'             = $ApproveMode
}

function Set-TomlOptions([string]$path, $values) {
  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path $path) { [IO.File]::ReadAllLines($path) | ForEach-Object { $lines.Add($_) } }

  # [options] 섹션의 범위를 찾는다. 없으면 끝에 만든다.
  $start = $lines.IndexOf('[options]')
  if ($start -lt 0) {
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne '') { $lines.Add('') }
    $lines.Add('[options]'); $start = $lines.Count - 1
  }
  $end = $lines.Count
  for ($i = $start + 1; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*\[') { $end = $i; break } }

  foreach ($k in $values.Keys) {
    $newLine = "$k = '$($values[$k])'"
    $found = $false
    for ($i = $start + 1; $i -lt $end; $i++) {
      if ($lines[$i] -match ('^\s*' + [regex]::Escape($k) + '\s*=')) { $lines[$i] = $newLine; $found = $true; break }
    }
    if (-not $found) { $lines.Insert($end, $newLine); $end++ }
  }

  New-Item -ItemType Directory -Path (Split-Path $path) -Force | Out-Null
  # RustDesk 의 TOML 파서가 BOM 을 싫어할 수 있으므로 BOM 없는 UTF-8 로 쓴다.
  [IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding $false))
}

foreach ($t in $targets) {
  Set-TomlOptions $t $values
  Write-Host "기록: $t"
}

# 3. 서비스가 돌고 있었다면 다시 켠다 (GUI 는 사용자가 다시 실행)
if ($svcWasRunning) { Start-Service -Name RustDesk }

Write-Host "완료 — 서버 $Server, 승인 방식 '$(if ($ApproveMode) { $ApproveMode } else { 'click+password' })'"
Write-Host "RustDesk 를 다시 실행하면 적용됩니다."
