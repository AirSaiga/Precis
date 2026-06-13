# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import copy_metadata

datas = []
datas += copy_metadata('readchar')
datas += copy_metadata('precis')


a = Analysis(
    ['entrypoint.py'],
    pathex=['D:\\Github Project\\Precis\\backend'],
    binaries=[],
    datas=datas,
    hiddenimports=['pandas', 'openpyxl', 'sqlalchemy', 'yaml', 'ruamel.yaml', 'pydantic', 'rich', 'cryptography', 'cryptography.fernet', 'readchar', 'simpleeval', 'filelock', 'numpy', 'app', 'app.cli', 'app.cli.shell', 'app.shared', 'app.shared.core', 'app.shared.domain', 'app.shared.services'],
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
    name='precis',
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
