<#
.SYNOPSIS
  이 PC 에서 핸들러가 동작할 조건을 갖췄는지 점검한다. 서버에는 아무것도 보내지 않는다.

.DESCRIPTION
  실제 링크 없이도 핸들러가 읽을 값들(RustDesk ID, 회사 계정, 등록 상태, 서버 연결)을
  하나씩 확인해서 어디서 막히는지 보여준다.
#>
$ErrorActionPreference = 'SilentlyContinue'
function Show($ok, $label, $detail) {
  $mark = if ($ok) { '[OK]  ' } else { '[문제]' }
  Write-Host ("{0} {1,-22} {2}" -f $mark, $label, $detail)
}

Write-Host "`n=== SupportLink 핸들러 점검 ===`n"

# 1. 프로토콜 등록
$cmd = $null; $scope = $null
foreach ($root in 'HKLM:\Software\Classes\supportlink', 'HKCU:\Software\Classes\supportlink') {
  $v = (Get-ItemProperty "$root\shell\open\command" -ErrorAction SilentlyContinue).'(Default)'
  if ($v) { $cmd = $v; $scope = $root.Split(':')[0]; break }
}
Show ($null -ne $cmd) '프로토콜 등록' $(if ($cmd) { "$scope → $cmd" } else { '등록되지 않음. Install-SupportLink.ps1 를 실행하세요' })

# 2. 설정 파일
$handler = $null
if ($cmd -and $cmd -match '-File "([^"]+)"') { $handler = $Matches[1] }
$configPath = if ($handler) { Join-Path (Split-Path $handler) 'config.json' } else { $null }
$serverBase = $null
if ($configPath -and (Test-Path $configPath)) {
  $serverBase = (Get-Content $configPath -Raw | ConvertFrom-Json).serverBase
}
Show ($null -ne $serverBase) '서버 주소' $(if ($serverBase) { $serverBase } else { 'config.json 없음' })

# 3. RustDesk ID (핸들러와 같은 순서: CLI → 설정 파일)
$id = $null; $found = $null
$exe = @((Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
         (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe')) |
       Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Show ($null -ne $exe) 'RustDesk 설치' $(if ($exe) { $exe } else { 'rustdesk.exe 를 찾지 못함' })
if ($exe) {
  $tmp = [IO.Path]::GetTempFileName()
  $proc = Start-Process -FilePath $exe -ArgumentList '--get-id' -RedirectStandardOutput $tmp -WindowStyle Hidden -PassThru
  if ($proc.WaitForExit(5000)) {
    $out = ([string](Get-Content $tmp -Raw)).Trim()
    if ($out -match '^\d{6,16}$') { $id = $out; $found = '--get-id' }
  } else { try { $proc.Kill() } catch { } }
  Remove-Item $tmp -Force
}
if (-not $id) {
  foreach ($p in (Join-Path $env:APPDATA 'RustDesk\config\RustDesk.toml'),
                 (Join-Path $env:WINDIR 'ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\RustDesk.toml')) {
    if (Test-Path $p) {
      $t = Get-Content $p -Raw
      if ($t -match "(?m)^\s*id\s*=\s*'(\d{6,16})'") { $id = $Matches[1]; $found = $p; break }
    }
  }
}
Show ($null -ne $id) 'RustDesk ID' $(if ($id) { "$id  (출처: $found)" } else { 'ID 를 찾지 못함 - RustDesk 를 한 번 실행해 ID 를 발급받았는지 확인' })

# 4. 회사 계정
$upn = (whoami.exe /upn 2>$null | Select-Object -First 1)
$upnOk = $upn -and ($upn -match '^[^@\s]+@[^@\s]+$')
Show $upnOk '회사 계정(UPN)' $(if ($upnOk) { $upn } else { '확인 불가 - 회사 가입(Entra joined) PC 가 아니면 값이 없습니다' })

# 5. 서버 연결
if ($serverBase) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $h = Invoke-RestMethod "$serverBase/healthz" -TimeoutSec 8
    Show $true '서버 연결' "healthz ok (auth: $($h.auth))"
  } catch { Show $false '서버 연결' $_.Exception.Message }
}

Write-Host "`n로그: $(Join-Path $env:LOCALAPPDATA 'SupportLink\handler.log')`n"
