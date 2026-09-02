<#
.SYNOPSIS
  supportlink:// 핸들러를 설치하고 Windows 에 등록한다.

.DESCRIPTION
  핸들러 스크립트를 설치 폴더로 복사하고 서버 주소를 config.json 에 고정한 뒤,
  레지스트리에 supportlink:// 프로토콜을 등록한다.
  관리자(또는 Intune 의 SYSTEM) 권한이면 모든 사용자에게(HKLM), 아니면 현재 사용자에게(HKCU) 등록된다.

.EXAMPLE
  .\Install-SupportLink.ps1 -ServerBase https://support.company.com
#>
param(
  [Parameter(Mandatory = $true)][string]$ServerBase,
  [string]$InstallDir = (Join-Path $env:ProgramData 'SupportLink')
)
$ErrorActionPreference = 'Stop'

if ($ServerBase -notmatch '^https?://[^/\s]+$') {
  throw "ServerBase 는 https://호스트 형태여야 합니다 (끝에 / 없이): $ServerBase"
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  # 관리자가 아니면 현재 사용자 범위로만 설치한다.
  $InstallDir = Join-Path $env:LOCALAPPDATA 'SupportLink\app'
}

# 1. 파일 배치
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$src = Join-Path $PSScriptRoot 'SupportLinkHandler.ps1'
if (-not (Test-Path $src)) { throw "SupportLinkHandler.ps1 를 같은 폴더에서 찾을 수 없습니다" }
Copy-Item $src (Join-Path $InstallDir 'SupportLinkHandler.ps1') -Force
@{ serverBase = $ServerBase.TrimEnd('/') } | ConvertTo-Json |
  Set-Content (Join-Path $InstallDir 'config.json') -Encoding UTF8

# 2. 프로토콜 등록
$handlerPath = Join-Path $InstallDir 'SupportLinkHandler.ps1'
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$command = '"{0}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" "%1"' -f $psExe, $handlerPath

$root = if ($isAdmin) { 'HKLM:\Software\Classes\supportlink' } else { 'HKCU:\Software\Classes\supportlink' }
New-Item -Path $root -Force | Out-Null
Set-ItemProperty -Path $root -Name '(Default)' -Value 'URL:SupportLink 원격지원'
Set-ItemProperty -Path $root -Name 'URL Protocol' -Value ''
New-Item -Path "$root\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$root\shell\open\command" -Name '(Default)' -Value $command

Write-Host "설치 완료"
Write-Host "  범위     : $(if ($isAdmin) { '모든 사용자 (HKLM)' } else { '현재 사용자 (HKCU)' })"
Write-Host "  폴더     : $InstallDir"
Write-Host "  서버     : $ServerBase"
Write-Host "  등록 명령: $command"
