"""
@fileoverview API Key 加密存储模块

功能概述:
- 使用 Fernet 对称加密保护 api_key 字段
- 密钥文件存储在 ~/.precis/.precis_key
- 加密后的值以 "enc:" 前缀标记，与明文和环境变量引用区分
- 首次使用自动生成密钥文件
- 向后兼容：明文 api_key 在 load 时正常读取，下次 save 时自动加密

架构设计:
- 加密/解密对 ConfigLoader 透明：save 时加密，load 时解密
- 密钥与用户绑定，不同操作系统的用户各有独立密钥
- _ENC_PREFIX = "enc:" 前缀用于区分加密值与明文值
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

_ENC_PREFIX = "enc:"

_KEY_FILE_NAME = ".precis_key"


def _key_file_path() -> Path:
    """密钥文件路径: ~/.precis/.precis_key"""
    return Path.home() / ".precis" / _KEY_FILE_NAME


def _get_or_create_key() -> bytes:
    """
    @methoddesc 获取或创建加密密钥

    首次使用时自动生成 Fernet 密钥并保存到 ~/.precis/.precis_key。
    密钥文件权限设为 0600（仅用户可读写），Windows 上无此限制。

    返回:
        Fernet 密钥字节（32 字节，base64 编码为 44 字节）
    """
    key_path = _key_file_path()

    if key_path.exists():
        try:
            key_data = key_path.read_bytes().strip()
            if key_data:
                return key_data
        except Exception:
            logger.warning("读取密钥文件失败，将重新生成")

    key_path.parent.mkdir(parents=True, exist_ok=True)
    new_key = Fernet.generate_key()
    key_path.write_bytes(new_key)

    try:
        os.chmod(str(key_path), 0o600)
    except OSError:
        pass

    logger.info("已生成新的 API Key 加密密钥: %s", key_path)
    return new_key


def _get_fernet() -> Fernet:
    """获取 Fernet 实例（懒加载密钥）"""
    key = _get_or_create_key()
    return Fernet(key)


def encrypt_api_key(plain: str) -> str:
    """
    @methoddesc 加密 API Key

    参数:
        plain: 明文 API Key

    返回:
        "enc:" 前缀 + base64 编码的加密值
    """
    if not plain:
        return plain
    f = _get_fernet()
    encrypted = f.encrypt(plain.encode("utf-8"))
    return _ENC_PREFIX + encrypted.decode("ascii")


def decrypt_api_key(encrypted: str) -> str:
    """
    @methoddesc 解密 API Key

    参数:
        encrypted: "enc:" 前缀的加密值，或明文值（向后兼容）

    返回:
        明文 API Key
    """
    if not encrypted:
        return encrypted

    if not encrypted.startswith(_ENC_PREFIX):
        return encrypted

    cipher_text = encrypted[len(_ENC_PREFIX) :]
    try:
        f = _get_fernet()
        return f.decrypt(cipher_text.encode("ascii")).decode("utf-8")
    except Exception:
        logger.warning("API Key 解密失败，可能密钥文件已更换")
        return ""


def is_encrypted(value: str | None) -> bool:
    """判断值是否为加密格式"""
    return value is not None and value.startswith(_ENC_PREFIX)
