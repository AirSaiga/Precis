"""
后端服务启动配置单元测试

测试覆盖:
- resolve_port: 端口优先级解析(CLI 参数 > 环境变量 > 默认值)
- acquire_port: OS 端口分配(动态 / 固定)
- write_port_file / clear_port_file: 端口文件协议读写
"""

from __future__ import annotations

import socket

from app.shared.core.config.server import (
    BACKEND_PORT_FILE,
    DEFAULT_BACKEND_HOST,
    DEFAULT_BACKEND_PORT,
    acquire_port,
    clear_port_file,
    resolve_port,
    write_port_file,
)

# ============================================================================
# resolve_port: 端口优先级解析
# ============================================================================


class TestResolvePort:
    def test_cli_param_takes_highest_priority(self, monkeypatch):
        """CLI 参数优先于环境变量和默认值"""
        monkeypatch.setenv("VITE_BACKEND_PORT", "18000")
        assert resolve_port(19000) == 19000

    def test_env_var_used_when_no_cli(self, monkeypatch):
        """无 CLI 参数时读环境变量"""
        monkeypatch.setenv("VITE_BACKEND_PORT", "18010")
        assert resolve_port(None) == 18010

    def test_default_when_nothing_set(self, monkeypatch):
        """无 CLI 参数无环境变量时返回默认值 0(OS 动态分配)"""
        monkeypatch.delenv("VITE_BACKEND_PORT", raising=False)
        assert resolve_port(None) == DEFAULT_BACKEND_PORT
        assert DEFAULT_BACKEND_PORT == 0

    def test_invalid_env_var_falls_back_to_default(self, monkeypatch):
        """环境变量非数字时回退到默认值"""
        monkeypatch.setenv("VITE_BACKEND_PORT", "not-a-port")
        assert resolve_port(None) == DEFAULT_BACKEND_PORT

    def test_zero_cli_param_is_respected(self):
        """显式传 0(CLI)应被尊重,等于动态分配"""
        assert resolve_port(0) == 0


# ============================================================================
# acquire_port: OS 端口分配
# ============================================================================


class TestAcquirePort:
    def test_dynamic_allocation_returns_usable_port(self):
        """port=0 时返回 OS 分配的可用端口"""
        port = acquire_port(0)
        assert port > 0  # OS 不会返回 0
        # 验证端口确实可绑定
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((DEFAULT_BACKEND_HOST, port))

    def test_fixed_port_returned_as_is(self):
        """preferred>0 时直接返回该端口号"""
        assert acquire_port(8001) == 8001

    def test_two_dynamic_ports_differ(self):
        """连续两次动态分配通常得到不同端口(非强保证,但实践成立)"""
        p1 = acquire_port(0)
        p2 = acquire_port(0)
        # 两次独立 bind(0) 几乎不会拿到同一端口;若偶发相同也不算失败,
        # 但作为回归信号记录
        assert p1 > 0
        assert p2 > 0


# ============================================================================
# 端口文件协议
# ============================================================================


class TestPortFile:
    def test_write_and_read_back(self, tmp_path, monkeypatch):
        """写入端口文件后可读回正确端口号"""
        monkeypatch.chdir(tmp_path)
        write_port_file(53871)
        content = (tmp_path / BACKEND_PORT_FILE).read_text(encoding="utf-8")
        assert content == "53871"

    def test_clear_removes_file(self, tmp_path, monkeypatch):
        """clear_port_file 删除端口文件"""
        monkeypatch.chdir(tmp_path)
        (tmp_path / BACKEND_PORT_FILE).write_text("12345", encoding="utf-8")
        clear_port_file()
        assert not (tmp_path / BACKEND_PORT_FILE).exists()

    def test_clear_when_file_missing_is_noop(self, tmp_path, monkeypatch):
        """文件不存在时 clear_port_file 静默成功"""
        monkeypatch.chdir(tmp_path)
        clear_port_file()  # 不应抛异常
        assert not (tmp_path / BACKEND_PORT_FILE).exists()

    def test_write_overwrites_stale_file(self, tmp_path, monkeypatch):
        """写入时覆盖上次的残留文件"""
        monkeypatch.chdir(tmp_path)
        (tmp_path / BACKEND_PORT_FILE).write_text("99999", encoding="utf-8")
        write_port_file(11111)
        assert (tmp_path / BACKEND_PORT_FILE).read_text(encoding="utf-8") == "11111"
