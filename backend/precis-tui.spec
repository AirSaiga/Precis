# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包规格：precis-tui（终端界面版）。

与 precis.spec 的区别：
- 入口改为 TUI 主应用（app.cli.tui.app:main）
- datas 增加 copy_metadata('textual')，确保 Textual 的元数据被打包
  （Textual 依赖元数据来定位 widgets 等子包的资源）
- hiddenimports 增加 textual / textual.widgets，避免动态导入被漏掉

注意：本 spec 由 P0a 建立，实际打包验证留给 P6（集成打磨）阶段。
"""

from PyInstaller.utils.hooks import copy_metadata

block_cipher = None

datas = []
datas += copy_metadata("textual")
datas += copy_metadata("precis")


a = Analysis(
    ["tui_entrypoint.py"],
    pathex=["D:\\Github Project\\Precis\\backend"],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "pandas",
        "openpyxl",
        "sqlalchemy",
        "yaml",
        "ruamel.yaml",
        "pydantic",
        "rich",
        "cryptography",
        "cryptography.fernet",
        "readchar",
        "simpleeval",
        "filelock",
        "numpy",
        # Textual 相关：动态导入的子包需显式声明
        "textual",
        "textual.widgets",
        "app",
        "app.cli",
        "app.cli.tui",
        "app.shared",
        "app.shared.core",
        "app.shared.domain",
        "app.shared.services",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="precis-tui",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
