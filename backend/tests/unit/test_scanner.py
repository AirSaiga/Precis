"""ServiceScanner 单元测试

测试本地 AI 服务发现扫描器的核心逻辑：
- scan() 并发探测与结果过滤
- _detect() 单地址检测（成功/失败/异常路径）
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.llm.discovery.scanner import DiscoveredService, ServiceScanner


def _mock_aiohttp_response(status: int, json_data: dict):
    """构造模拟 aiohttp GET 响应的上下文管理器。"""
    resp = AsyncMock()
    resp.status = status
    resp.json = AsyncMock(return_value=json_data)

    get_cm = AsyncMock()
    get_cm.__aenter__ = AsyncMock(return_value=resp)
    get_cm.__aexit__ = AsyncMock(return_value=False)

    session = AsyncMock()
    session.get = MagicMock(return_value=get_cm)

    session_cm = AsyncMock()
    session_cm.__aenter__ = AsyncMock(return_value=session)
    session_cm.__aexit__ = AsyncMock(return_value=False)

    return session_cm


class TestDiscoveredService:
    def test_dataclass_fields(self):
        svc = DiscoveredService(
            id="test-id",
            name="Test Service",
            type="ollama",
            base_url="http://localhost:11434",
            models=["model1"],
            status="available",
        )
        assert svc.id == "test-id"
        assert svc.name == "Test Service"
        assert svc.type == "ollama"
        assert svc.base_url == "http://localhost:11434"
        assert svc.models == ["model1"]
        assert svc.status == "available"


class TestServiceScannerDetect:
    @pytest.mark.asyncio
    async def test_detect_ollama_success(self):
        scanner = ServiceScanner()
        json_data = {"models": [{"name": "llama3.2"}, {"name": "qwen2.5"}]}
        mock_session_cm = _mock_aiohttp_response(200, json_data)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await scanner._detect("ollama", "localhost", 11434, "/api/tags", "models", "name")

        assert result is not None
        assert result.id == "detected-ollama-11434"
        assert result.name == "Ollama @ :11434"
        assert result.type == "ollama"
        assert result.base_url == "http://localhost:11434"
        assert result.models == ["llama3.2", "qwen2.5"]
        assert result.status == "available"

    @pytest.mark.asyncio
    async def test_detect_openai_success(self):
        scanner = ServiceScanner()
        json_data = {"data": [{"id": "gpt-4"}, {"id": "gpt-3.5-turbo"}]}
        mock_session_cm = _mock_aiohttp_response(200, json_data)

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await scanner._detect("openai", "localhost", 1234, "/v1/models", "data", "id")

        assert result is not None
        assert result.id == "detected-openai-1234"
        assert result.name == "OpenAI-Compatible @ :1234"
        assert result.type == "openai"
        assert result.models == ["gpt-4", "gpt-3.5-turbo"]

    @pytest.mark.asyncio
    async def test_detect_non_200_returns_none(self):
        scanner = ServiceScanner()
        mock_session_cm = _mock_aiohttp_response(404, {})

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await scanner._detect("ollama", "localhost", 11434, "/api/tags", "models", "name")

        assert result is None

    @pytest.mark.asyncio
    async def test_detect_connection_error_returns_none(self):
        scanner = ServiceScanner()

        with patch("aiohttp.ClientSession", side_effect=OSError("Connection refused")):
            result = await scanner._detect("ollama", "localhost", 11434, "/api/tags", "models", "name")

        assert result is None

    @pytest.mark.asyncio
    async def test_detect_empty_model_list(self):
        scanner = ServiceScanner()
        mock_session_cm = _mock_aiohttp_response(200, {"models": []})

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await scanner._detect("ollama", "localhost", 11434, "/api/tags", "models", "name")

        assert result is not None
        assert result.models == []

    @pytest.mark.asyncio
    async def test_detect_missing_model_field_returns_empty_list(self):
        scanner = ServiceScanner()
        mock_session_cm = _mock_aiohttp_response(200, {})

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await scanner._detect("ollama", "localhost", 11434, "/api/tags", "models", "name")

        assert result is not None
        assert result.models == []

    @pytest.mark.asyncio
    async def test_detect_unknown_service_type_uses_type_as_name(self):
        scanner = ServiceScanner()
        mock_session_cm = _mock_aiohttp_response(200, {"models": []})

        with patch("aiohttp.ClientSession", return_value=mock_session_cm):
            result = await scanner._detect("custom", "localhost", 9999, "/health", "models", "name")

        assert result is not None
        assert result.name == "custom @ :9999"


class TestServiceScannerScan:
    @pytest.mark.asyncio
    async def test_scan_default_hosts(self):
        scanner = ServiceScanner()

        async def mock_detect(svc_type, host, port, path, model_field, name_field):
            if svc_type == "ollama" and host == "localhost" and port == 11434:
                return DiscoveredService(
                    id="detected-ollama-11434",
                    name="Ollama @ :11434",
                    type="ollama",
                    base_url="http://localhost:11434",
                    models=["llama3.2"],
                    status="available",
                )
            return None

        with patch.object(scanner, "_detect", side_effect=mock_detect):
            results = await scanner.scan()

        assert len(results) == 1
        assert results[0].id == "detected-ollama-11434"

    @pytest.mark.asyncio
    async def test_scan_custom_hosts(self):
        scanner = ServiceScanner()
        called_hosts = []

        async def mock_detect(svc_type, host, port, path, model_field, name_field):
            called_hosts.append(host)
            return None

        with patch.object(scanner, "_detect", side_effect=mock_detect):
            await scanner.scan(hosts=["192.168.1.1"])

        assert "192.168.1.1" in called_hosts
        assert "localhost" not in called_hosts

    @pytest.mark.asyncio
    async def test_scan_filters_exceptions(self):
        scanner = ServiceScanner()
        call_count = [0]

        async def mock_detect(svc_type, host, port, path, model_field, name_field):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("boom")
            return DiscoveredService(
                id=f"detected-{svc_type}-{port}",
                name="test",
                type=svc_type,
                base_url=f"http://{host}:{port}",
                models=[],
                status="available",
            )

        with patch.object(scanner, "_detect", side_effect=mock_detect):
            results = await scanner.scan(hosts=["localhost"])

        # 异常被过滤，只返回 DiscoveredService 实例
        assert all(isinstance(r, DiscoveredService) for r in results)

    @pytest.mark.asyncio
    async def test_scan_all_fail_returns_empty(self):
        scanner = ServiceScanner()

        async def mock_detect(*args):
            return None

        with patch.object(scanner, "_detect", side_effect=mock_detect):
            results = await scanner.scan(hosts=["localhost"])

        assert results == []

    @pytest.mark.asyncio
    async def test_scan_covers_all_configured_ports(self):
        """验证 scan 会探测 SCANS 中定义的所有端口。"""
        scanner = ServiceScanner()
        probed_ports = []

        async def mock_detect(svc_type, host, port, path, model_field, name_field):
            probed_ports.append(port)
            return None

        with patch.object(scanner, "_detect", side_effect=mock_detect):
            await scanner.scan(hosts=["localhost"])

        # ollama: 11434; openai: 1234, 8080, 8000
        assert 11434 in probed_ports
        assert 1234 in probed_ports
        assert 8080 in probed_ports
        assert 8000 in probed_ports
