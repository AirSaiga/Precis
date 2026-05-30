#Requires -RunAsAdministrator
# 寮€鍚?Windows 寮€鍙戣€呮ā寮忥紙鍏佽闈炵鐞嗗憳鍒涘缓绗﹀彿閾炬帴锛?# 鍙渶杩愯涓€娆★紝姘镐箙鐢熸晥

Write-Host "姝ｅ湪寮€鍚?Windows 寮€鍙戣€呮ā寮?.." -ForegroundColor Cyan

try {
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"
    if (!(Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }
    Set-ItemProperty -Path $regPath -Name "AllowDevelopmentWithoutDevLicense" -Value 1 -Type DWord -Force
    Write-Host "寮€鍙戣€呮ā寮忓凡寮€鍚紒" -ForegroundColor Green
    Write-Host "璇烽噸鏂版墦寮€缁堢鍚庤繍琛?npm run pack" -ForegroundColor Yellow
} catch {
    Write-Host "寮€鍚け璐? $_" -ForegroundColor Red
    Write-Host "璇峰彸閿?PowerShell 閫夋嫨浠ョ鐞嗗憳韬唤杩愯鍚庨噸璇? -ForegroundColor Red
}
