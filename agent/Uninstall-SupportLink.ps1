<#
.SYNOPSIS
  supportlink:// 핸들러 등록과 파일을 제거한다.
#>
$ErrorActionPreference = 'SilentlyContinue'
foreach ($root in 'HKLM:\Software\Classes\supportlink', 'HKCU:\Software\Classes\supportlink') {
  if (Test-Path $root) { Remove-Item $root -Recurse -Force; Write-Host "등록 제거: $root" }
}
foreach ($dir in (Join-Path $env:ProgramData 'SupportLink'), (Join-Path $env:LOCALAPPDATA 'SupportLink')) {
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force; Write-Host "폴더 제거: $dir" }
}
Write-Host "제거 완료"
