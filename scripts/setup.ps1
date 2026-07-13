#Requires -Version 5.1
<#
.SYNOPSIS
    Precis 完整部署脚本 (Windows)

.DESCRIPTION
    一键部署脚本，自动完成：
    1. 检查 Python 3.12+ 和 Node.js 20+
    2. 创建 Python 虚拟环境
    3. 安装后端依赖
    4. 安装前端依赖 (root + frontend + electron)
    5. 构建前端和 Electron

.PARAMETER SkipBuild
    跳过构建步骤，只安装依赖（bash 等价: --skip-build）

.PARAMETER UseSystemPython
    使用系统 Python 而不是创建虚拟环境（不推荐）（bash 等价: --system-py）

.EXAMPLE
    .\setup.ps1
    完整部署流程

.EXAMPLE
    .\setup.ps1 -SkipBuild
    只安装依赖，不构建

.EXAMPLE
    .\setup.ps1 -UseSystemPython
    使用系统 Python（开发测试用）

.NOTES
    跨平台参数对应（bash 版 setup.sh）:
    -SkipBuild        ↔  --skip-build
    -UseSystemPython  ↔  --system-py
#>

param(
    [switch]$SkipBuild,
    [switch]$UseSystemPython,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "Continue"

# 颜色定义
$Colors = @{
    Success = 'Green'
    Info = 'Cyan'
    Warning = 'Yellow'
    Error = 'Red'
    Normal = 'White'
}

function Write-Status {
    param([string]$Message, [string]$Type = 'Info')
    $color = $Colors[$Type]
    Write-Host "[$Type] $Message" -ForegroundColor $color
}

function Write-Separator {
    Write-Host "=" * 60 -ForegroundColor $Colors.Info
}

# 项目路径
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$ElectronDir = Join-Path $ProjectRoot "electron"
$VenvDir = Join-Path $BackendDir ".venv"

Set-Location $ProjectRoot

Write-Separator
Write-Status "Precis 部署脚本 (Python 3.12+)" "Info"
Write-Status "项目路径: $ProjectRoot" "Info"
Write-Separator
Write-Host ""

# ============================================
# 1. 检查 Python (3.12+)
# ============================================
Write-Status "检查 Python 3.12+ 环境..." "Info"

$PythonCmd = $null
$PythonVersion = $null

# 检查 pyenv
$pyenvPython = Get-Command "pyenv" -ErrorAction SilentlyContinue
if ($pyenvPython) {
    Write-Status "检测到 pyenv" "Success"
    $pyenvVersions = pyenv versions 2>$null
    $has312 = $pyenvVersions | Select-String "3\.(12|13)"

    if (-not $has312) {
        Write-Status "pyenv 中没有找到 Python 3.12+，正在安装 Python 3.13.5..." "Warning"
        Write-Status "这可能需要几分钟..." "Info"
        pyenv install 3.13.5
        if ($LASTEXITCODE -ne 0) {
            Write-Status "pyenv 安装 Python 3.13.5 失败，尝试安装 3.13.0..." "Warning"
            pyenv install 3.13.0
        }
        $pyenvVersions = pyenv versions 2>$null
        $has312 = $pyenvVersions | Select-String "3\.(12|13)"
    }

    if ($has312) {
        # 使用 pyenv 的 Python 3.12+
        $pyenvRoot = $env:PYENV_ROOT
        if (-not $pyenvRoot) { $pyenvRoot = "$env:USERPROFILE\.pyenv" }

        # 获取所有 3.12+/3.13.x 版本并选择最高的一个
        $targetVersion = ($pyenvVersions | Select-String -Pattern "3\.(12|13)\.\d+" -AllMatches).Matches.Value | Sort-Object { [version]$_ } -Descending | Select-Object -First 1

        if ($targetVersion) {
            $PythonCmd = "$pyenvRoot\pyenv-win\versions\$targetVersion\python.exe"
            if (Test-Path $PythonCmd) {
                Write-Status "使用 pyenv Python: $targetVersion" "Success"
            }
        }
    } else {
        Write-Status "未能通过 pyenv 安装 Python 3.12+" "Error"
    }
}

# 检查系统 Python
if (-not $PythonCmd) {
    $systemPython = Get-Command "python" -ErrorAction SilentlyContinue
    if ($systemPython) {
        try {
            $versionStr = python --version 2>&1
            if ($versionStr -match "Python (\d+)\.(\d+)") {
                $major = [int]$Matches[1]
                $minor = [int]$Matches[2]
                if ($major -eq 3 -and $minor -ge 12) {
                    $PythonCmd = "python"
                    $PythonVersion = "$major.$minor"
                    Write-Status "检测到系统 Python: $PythonVersion" "Success"
                } else {
                    Write-Status "系统 Python 版本过低: $major.$minor (需要 3.12+)" "Error"
                    Write-Status "请先安装 Python 3.12+: https://www.python.org/downloads/release/python-3135/" "Info"
                    exit 1
                }
            }
        } catch {
            Write-Status "无法检测系统 Python 版本" "Warning"
        }
    }
}

if (-not $PythonCmd) {
    Write-Separator
    Write-Status "未找到 Python 3.12+" "Error"
    Write-Status "请通过以下方式安装:" "Info"
    Write-Status "  1. pyenv-win: pyenv install 3.13.5" "Info"
    Write-Status "  2. 官网下载: https://www.python.org/downloads/release/python-3135/" "Info"
    exit 1
}

# 验证 Python
try {
    $versionOutput = & $PythonCmd --version 2>&1
    Write-Status "Python 版本: $versionOutput" "Success"
} catch {
    Write-Status "无法执行 Python: $PythonCmd" "Error"
    exit 1
}

Write-Host ""

# ============================================
# 2. 检查 Node.js
# ============================================
Write-Status "检查 Node.js..." "Info"

$NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Separator
    Write-Status "未找到 Node.js" "Error"
    Write-Status "请安装 Node.js 20.19.0+: https://nodejs.org" "Info"
    exit 1
}

try {
    $nodeVersion = node --version
    $npmVersion = npm --version
    Write-Status "Node.js: $nodeVersion" "Success"
    Write-Status "npm: v$npmVersion" "Success"

    # 检查版本
    if ($nodeVersion -match "v(\d+)\.(\d+)") {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 19)) {
            Write-Status "Node.js 版本过低 (需要 20.19.0+)，当前为 $nodeVersion，可能会导致构建失败" "Warning"
        }
    }
} catch {
    Write-Status "无法检测 Node.js 版本" "Warning"
}

Write-Host ""

# ============================================
# 3. 设置 Python 虚拟环境
# ============================================
if (-not $UseSystemPython) {
    Write-Status "设置 Python 虚拟环境..." "Info"

    if (Test-Path $VenvDir) {
        Write-Status "虚拟环境已存在: $VenvDir" "Info"
    } else {
        Write-Status "创建虚拟环境..." "Info"
        & $PythonCmd -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) {
            Write-Status "创建虚拟环境失败" "Error"
            exit 1
        }
        Write-Status "虚拟环境创建成功" "Success"
    }

    $VenvPython = Join-Path $VenvDir "Scripts\python.exe"
    $PythonCmd = $VenvPython
    Write-Status "使用虚拟环境 Python" "Success"
} else {
    Write-Status "使用系统 Python (不推荐用于生产环境)" "Warning"
}

Write-Host ""

# ============================================
# 4. 安装后端依赖
# ============================================
Write-Status "安装后端依赖..." "Info"
Set-Location $BackendDir

# 升级 pip
Write-Status "升级 pip..." "Info"
& $PythonCmd -m pip install --upgrade pip | Out-Null

# 安装依赖
Write-Status "安装 requirements..." "Info"
$pipOutput = & $PythonCmd -m pip install -r requirements.txt 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Status "依赖安装失败" "Error"
    Write-Host $pipOutput
    exit 1
}
Write-Status "后端依赖安装完成" "Success"

# 验证关键包
try {
    & $PythonCmd -c "import fastapi, pydantic, pandas, yaml; print('OK')" | Out-Null
    Write-Status "关键包验证通过" "Success"
} catch {
    Write-Status "关键包验证失败" "Error"
    exit 1
}

Set-Location $ProjectRoot
Write-Host ""

# ============================================
# 5. 安装前端依赖
# ============================================
Write-Status "安装前端依赖..." "Info"

# 根目录依赖
if (Test-Path "node_modules") {
    Write-Status "根目录依赖已安装" "Info"
} else {
    Write-Status "安装根目录依赖..." "Info"
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Status "根目录依赖安装失败" "Error"
        exit 1
    }
}

# Frontend 依赖
if (Test-Path "$FrontendDir\node_modules") {
    Write-Status "Frontend 依赖已安装" "Info"
} else {
    Write-Status "安装 Frontend 依赖..." "Info"
    Set-Location $FrontendDir
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Frontend 依赖安装失败" "Error"
        exit 1
    }
    Set-Location $ProjectRoot
}

# Electron 依赖
if (Test-Path "$ElectronDir\node_modules") {
    Write-Status "Electron 依赖已安装" "Info"
} else {
    Write-Status "安装 Electron 依赖..." "Info"
    Set-Location $ElectronDir
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Electron 依赖安装失败" "Error"
        exit 1
    }
    Set-Location $ProjectRoot
}

Write-Status "所有前端依赖安装完成" "Success"
Write-Host ""

# ============================================
# 6. 构建项目
# ============================================
if (-not $SkipBuild) {
    Write-Separator
    Write-Status "开始构建项目..." "Info"
    Write-Separator
    Write-Host ""

    # 构建 Frontend
    Write-Status "构建 Frontend..." "Info"
    Set-Location $FrontendDir
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Frontend 构建失败" "Error"
        exit 1
    }
    Write-Status "Frontend 构建完成" "Success"
    Set-Location $ProjectRoot
    Write-Host ""

    # 构建 Electron
    Write-Status "构建 Electron..." "Info"
    Set-Location $ElectronDir
    npm run build:electron
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Electron 构建失败" "Warning"
        Write-Status "开发模式下将使用 ts-node 直接运行" "Info"
    } else {
        Write-Status "Electron 构建完成" "Success"
    }
    Set-Location $ProjectRoot
    Write-Host ""
} else {
    Write-Status "跳过构建步骤 (-SkipBuild)" "Info"
}

Write-Host ""
Write-Separator
Write-Status "部署完成!" "Success"
Write-Separator
Write-Host ""

# 显示启动命令
Write-Status "可用启动命令:" "Info"
Write-Host ""
Write-Host "  CLI 模式:" -ForegroundColor $Colors.Info
Write-Host "    .\scripts\windows\start-cli.bat" -ForegroundColor $Colors.Normal
Write-Host ""
Write-Host "  桌面应用 (开发模式):" -ForegroundColor $Colors.Info
Write-Host "    .\scripts\windows\start-electron.bat" -ForegroundColor $Colors.Normal
Write-Host ""
Write-Host "  手动启动:" -ForegroundColor $Colors.Info
Write-Host "    后端: cd backend; .venv\Scripts\activate; python app/start_server.py" -ForegroundColor $Colors.Normal
Write-Host "    前端: cd frontend; npm run dev" -ForegroundColor $Colors.Normal
Write-Host "    Electron: cd electron; npm start" -ForegroundColor $Colors.Normal
Write-Host ""
