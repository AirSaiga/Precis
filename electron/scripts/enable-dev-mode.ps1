#Requires -RunAsAdministrator
# 开启 Windows 开发者模式（允许非管理员创建符号链接）
# 只需运行一次，永久生效

Write-Host "正在开启 Windows 开发者模式..." -ForegroundColor Cyan

try {
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"
    if (!(Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }
    Set-ItemProperty -Path $regPath -Name "AllowDevelopmentWithoutDevLicense" -Value 1 -Type DWord -Force
    Write-Host "开发者模式已开启！" -ForegroundColor Green
    Write-Host "请重新打开终端后运行 npm run pack" -ForegroundColor Yellow
} catch {
    Write-Host "开启失败: $_" -ForegroundColor Red
    Write-Host "请右键 PowerShell 选择以管理员身份运行后重试" -ForegroundColor Red
}
