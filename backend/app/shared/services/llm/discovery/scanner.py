"""
@fileoverview 本地服务扫描器

功能概述:
- 自动发现本地运行的 AI 服务（Ollama、OpenAI 兼容服务）
- 扫描常用端口：Ollama(11434)、OpenAI 兼容(1234, 8080, 8000)
- 检测服务健康状态并获取可用模型列表
- 返回结构化的服务发现结果

架构设计:
- 配置驱动扫描：SCANS 字典定义各服务类型的检测规则
- 异步 IO：使用 aiohttp 并发检测多个端口
- 单例模式：全局 scanner 实例供 API 层调用

输入示例:
    services = await scanner.scan()
    # 或指定主机
    services = await scanner.scan(["localhost", "192.168.1.100"])

输出示例:
    [
        DiscoveredService(
            id="detected-ollama-11434",
            name="Ollama @ :11434",
            type="ollama",
            base_url="http://localhost:11434",
            models=["llama3.2", "qwen2.5"],
            status="available"
        )
    ]
"""

from dataclasses import dataclass
from typing import Any


@dataclass
class DiscoveredService:
    """
    @classdesc 发现的服务数据类

    封装本地扫描到的 AI 服务信息，包括服务类型、URL、可用模型和状态。

    字段:
        id: 服务唯一标识
        name: 服务显示名称
        type: 服务类型（openai / ollama）
        base_url: API 基础 URL
        models: 可用模型列表
        status: 服务状态（available / unavailable）
    """

    id: str
    name: str
    type: str  # openai / ollama
    base_url: str
    models: list[str]
    status: str  # available / unavailable


class ServiceScanner:
    """
    @classdesc 本地服务扫描器

    自动发现本地运行的 AI 服务（Ollama、OpenAI 兼容服务）。
    扫描常用端口：Ollama(11434)、OpenAI 兼容(1234, 8080, 8000)。
    """

    # 服务类型 -> 检测配置
    SCANS: dict[str, dict[str, Any]] = {
        "ollama": {"ports": [11434], "health_path": "/api/tags", "model_field": "models", "model_name_field": "name"},
        "openai": {
            "ports": [1234, 8080, 8000],
            "health_path": "/v1/models",
            "model_field": "data",
            "model_name_field": "id",
        },
    }

    async def scan(self, hosts: list[str] | None = None) -> list[DiscoveredService]:
        """
        @methoddesc 扫描本地运行的 AI 服务

        遍历预定义的端口列表，尝试连接并识别 Ollama 和 OpenAI 兼容服务。

        参数:
            hosts: 要扫描的主机列表，默认扫描 localhost 和 127.0.0.1

        返回:
            发现的服务列表（DiscoveredService 对象列表）
        """
        if hosts is None:
            hosts = ["localhost", "127.0.0.1"]

        results = []
        # 遍历所有服务类型（ollama / openai）和主机/端口组合
        for svc_type, cfg in self.SCANS.items():
            for host in hosts:
                for port in cfg["ports"]:
                    service = await self._detect(
                        svc_type, host, port, cfg["health_path"], cfg["model_field"], cfg["model_name_field"]
                    )
                    if service:
                        results.append(service)

        return results

    async def _detect(
        self, svc_type: str, host: str, port: int, path: str, model_field: str, name_field: str
    ) -> DiscoveredService | None:
        """
        @methoddesc 检测单个地址是否运行着指定的 AI 服务

        通过发送 GET 请求到健康检查路径，根据响应格式判断服务类型并提取模型列表。

        参数:
            svc_type: 服务类型标识（"ollama" 或 "openai"）
            host: 主机名或 IP 地址
            port: 端口号
            path: 健康检查路径（如 /api/tags 或 /v1/models）
            model_field: 响应 JSON 中模型列表的字段名
            name_field: 模型对象中名称的字段名

        返回:
            如果发现服务返回 DiscoveredService，否则 None
        """
        url = f"http://{host}:{port}"
        try:
            # aiohttp 是 [ai]/[full] 可选依赖，按需延迟导入
            import aiohttp

            # 使用 aiohttp 发送异步 GET 请求，超时 5 秒
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{url}{path}", timeout=timeout) as resp:
                    if resp.status != 200:
                        return None

                    data = await resp.json()
                    # 从响应中提取模型名称列表
                    models = [m[name_field] for m in data.get(model_field, [])]

                    # 根据类型生成友好名称
                    name_map = {"ollama": "Ollama", "openai": "OpenAI-Compatible"}
                    base_name = name_map.get(svc_type, svc_type)

                    return DiscoveredService(
                        id=f"detected-{svc_type}-{port}",
                        name=f"{base_name} @ :{port}",
                        type=svc_type,
                        base_url=url,
                        models=models,
                        status="available",
                    )
        except Exception:
            # 连接失败、超时或响应格式不对，都视为未检测到服务
            return None


# 全局实例
scanner = ServiceScanner()
