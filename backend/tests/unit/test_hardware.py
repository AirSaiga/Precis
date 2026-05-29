"""测试硬件信息采集模块"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import FrozenInstanceError
from unittest.mock import MagicMock, patch

import pytest

from app.shared.services.hardware import (
    HardwareSnapshot,
    _cpu_cores,
    _disk_free_bytes,
    _has_nvidia_gpu,
    _memory_total_bytes,
    snapshot,
)


class TestHardwareSnapshot:
    def test_create(self):
        hs = HardwareSnapshot(
            os_name="Windows",
            os_version="10",
            arch="AMD64",
            cpu_cores=8,
            memory_total_bytes=16_000_000_000,
            disk_free_bytes=100_000_000_000,
            has_nvidia_gpu=False,
        )
        assert hs.os_name == "Windows"
        assert hs.cpu_cores == 8

    def test_frozen(self):
        hs = HardwareSnapshot(
            os_name="Linux",
            os_version="5.0",
            arch="x86_64",
            cpu_cores=4,
            memory_total_bytes=8_000_000_000,
            disk_free_bytes=50_000_000_000,
            has_nvidia_gpu=True,
        )
        with pytest.raises(FrozenInstanceError):
            hs.cpu_cores = 8


class TestCpuCores:
    def test_normal_return(self):
        with patch("os.cpu_count", return_value=8):
            assert _cpu_cores() == 8

    def test_none_returns_one(self):
        with patch("os.cpu_count", return_value=None):
            assert _cpu_cores() == 1

    def test_exception_returns_one(self):
        with patch("os.cpu_count", side_effect=OSError("fail")):
            assert _cpu_cores() == 1

    def test_zero_returns_one(self):
        with patch("os.cpu_count", return_value=0):
            assert _cpu_cores() == 1


class TestMemoryTotalBytes:
    @pytest.mark.skipif(sys.platform != "win32", reason="Windows only")
    def test_windows_failure_returns_zero(self):
        with patch("os.name", "nt"):
            with patch("ctypes.windll.kernel32.GlobalMemoryStatusEx", side_effect=Exception("fail")):
                assert _memory_total_bytes() == 0

    def test_linux_success(self):
        with patch("os.name", "posix"):
            with patch("os.sysconf", side_effect=[4096, 4_000_000], create=True):
                assert _memory_total_bytes() == 4096 * 4_000_000

    def test_linux_exception_returns_zero(self):
        with patch("os.name", "posix"):
            with patch("os.sysconf", side_effect=OSError("fail"), create=True):
                assert _memory_total_bytes() == 0

    def test_unsupported_platform_returns_zero(self):
        with patch("os.name", "java"):
            with patch("os.sysconf", side_effect=OSError("fail"), create=True):
                assert _memory_total_bytes() == 0


class TestDiskFreeBytes:
    def test_custom_path(self):
        with patch("shutil.disk_usage", return_value=MagicMock(free=100_000)):
            assert _disk_free_bytes("/tmp") == 100_000

    def test_failure_returns_zero(self):
        with patch("shutil.disk_usage", side_effect=OSError("fail")):
            assert _disk_free_bytes("/tmp") == 0

    def test_default_path_windows(self):
        with patch("os.name", "nt"):
            with patch.dict("os.environ", {"SystemDrive": "D:"}):
                with patch("shutil.disk_usage", return_value=MagicMock(free=50_000)):
                    assert _disk_free_bytes() == 50_000

    def test_default_path_unix(self):
        with patch("os.name", "posix"):
            with patch("os.path.expanduser", return_value="/home/user"):
                with patch("shutil.disk_usage", return_value=MagicMock(free=75_000)):
                    assert _disk_free_bytes() == 75_000


class TestHasNvidiaGpu:
    def test_gpu_present(self):
        mock_res = MagicMock()
        mock_res.returncode = 0
        with patch("subprocess.run", return_value=mock_res):
            assert _has_nvidia_gpu() is True

    def test_gpu_not_present(self):
        mock_res = MagicMock()
        mock_res.returncode = 1
        with patch("subprocess.run", return_value=mock_res):
            assert _has_nvidia_gpu() is False

    def test_command_not_found(self):
        with patch("subprocess.run", side_effect=FileNotFoundError("not found")):
            assert _has_nvidia_gpu() is False

    def test_timeout(self):
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("cmd", 1)):
            assert _has_nvidia_gpu() is False


class TestSnapshot:
    def test_returns_hardware_snapshot(self):
        with patch("app.shared.services.hardware._cpu_cores", return_value=4):
            with patch("app.shared.services.hardware._memory_total_bytes", return_value=8_000_000_000):
                with patch("app.shared.services.hardware._disk_free_bytes", return_value=100_000_000_000):
                    with patch("app.shared.services.hardware._has_nvidia_gpu", return_value=False):
                        result = snapshot()
                        assert isinstance(result, HardwareSnapshot)
                        assert result.cpu_cores == 4
                        assert result.memory_total_bytes == 8_000_000_000
                        assert result.disk_free_bytes == 100_000_000_000
                        assert result.has_nvidia_gpu is False
                        assert result.os_name != ""
                        assert result.arch != ""
