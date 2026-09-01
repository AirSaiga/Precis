"""@fileoverview register_port_file_cleanup 信号处理单元测试

回归：原实现 SIGINT/SIGTERM handler 只清端口文件不退出——信号被 lambda 吞掉，
进程无法用 Ctrl+C/SIGTERM 终止。修复后 handler 清理后链回默认行为：
SIGINT 抛 KeyboardInterrupt，SIGTERM 以 128+signum 退出。
"""

from __future__ import annotations

import signal

import pytest

from app.shared.core.config.server import (
    BACKEND_PORT_FILE,
    register_port_file_cleanup,
    write_port_file,
)


@pytest.fixture
def port_dir(tmp_path, monkeypatch):
    """切换 cwd 到临时目录（端口文件写在 cwd 下），并在测试后恢复信号 handler。"""
    monkeypatch.chdir(tmp_path)
    prev_int = signal.getsignal(signal.SIGINT)
    prev_term = signal.getsignal(signal.SIGTERM)
    yield tmp_path
    signal.signal(signal.SIGINT, prev_int)
    signal.signal(signal.SIGTERM, prev_term)


class TestRegisterPortFileCleanup:
    def test_sigint_handler_clears_file_then_raises_keyboardinterrupt(self, port_dir):
        """SIGINT handler 清理端口文件后链回默认行为（抛 KeyboardInterrupt），不吞信号。"""
        write_port_file(12345)
        register_port_file_cleanup()

        handler = signal.getsignal(signal.SIGINT)
        assert handler is not signal.default_int_handler

        with pytest.raises(KeyboardInterrupt):
            handler(signal.SIGINT, None)

        assert not (port_dir / BACKEND_PORT_FILE).exists()

    def test_sigterm_handler_clears_file_then_exits_with_128_plus_signum(self, port_dir):
        """SIGTERM handler 清理端口文件后以 128+signum 退出。"""
        write_port_file(12345)
        register_port_file_cleanup()

        handler = signal.getsignal(signal.SIGTERM)
        with pytest.raises(SystemExit) as exc_info:
            handler(signal.SIGTERM, None)

        assert exc_info.value.code == 128 + signal.SIGTERM
        assert not (port_dir / BACKEND_PORT_FILE).exists()

    def test_repeated_registration_safe(self, port_dir):
        """多次注册安全：handler 仍可清理并正确退出。"""
        register_port_file_cleanup()
        register_port_file_cleanup()

        write_port_file(999)
        handler = signal.getsignal(signal.SIGTERM)
        with pytest.raises(SystemExit):
            handler(signal.SIGTERM, None)

        assert not (port_dir / BACKEND_PORT_FILE).exists()
