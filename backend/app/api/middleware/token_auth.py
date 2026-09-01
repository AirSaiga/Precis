"""
@fileoverview 后端 API 一次性 token 放行中间件（打包模式 CORS 纵深防御）

功能概述:
- Electron 打包模式每次启动后端生成随机 token：主进程经环境变量 PRECIS_API_TOKEN
  注入本进程，并经 IPC 下发给本应用渲染进程；渲染进程随请求携带 X-Precis-Auth 头
- 对携带有效 token 的请求放行 CORS：
  * 预检 OPTIONS（Origin 为 null/空/非常规本机源）直接代答 200 预检响应
  * 实际请求在响应缺少 Access-Control-Allow-Origin 时补写回显 Origin 的 CORS 头
- 无效/缺失 token 的请求不介入，交由 CORSMiddleware 既有规则处理
  （null Origin 仍被拒绝，本机源正常放行）

威胁模型:
- 后端无鉴权且存在文件读取端点，监听 127.0.0.1 动态端口；浏览器中的恶意网页可用
  sandboxed iframe（Origin 恒为 null）+ 端口扫描对任意本机端口发跨域请求，若后端
  对 null Origin 一律回写 ACAO，响应即可被该网页读取（本机数据泄露）
- 旧方案（PRECIS_ALLOW_NULL_ORIGIN=1 全局放行）对本应用页面与恶意网页不加区分；
  新方案下恶意网页拿不到 token（IPC 仅本应用渲染进程可达），其 null Origin 请求
  依旧被 CORS 拒绝——token 成为"本应用页面"的身份凭据
- token 比较使用 hmac.compare_digest，避免逐字节比较的时序侧信道

生效条件:
- 仅当 PRECIS_API_TOKEN 已配置（Electron spawn 后端时注入）时介入；Web / 开发模式
  （未配置）完全直通，既有 localhost CORS 行为不变
- PRECIS_ALLOW_NULL_ORIGIN 兼容开关保留（见 DynamicPortCORSMiddleware 原逻辑），
  打包模式不再注入该变量

架构设计:
- 纯 ASGI 中间件（不继承 BaseHTTPMiddleware）：无请求体/响应体解析开销，
  且预检代答只需两个 ASGI send 消息即可完成
"""

import hmac
import os
import re

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

# 携带 token 的自定义请求头（渲染进程 httpClient / sseClient 统一注入）
AUTH_HEADER_NAME = "X-Precis-Auth"

# "常规本机源"：http(s)://127.0.0.1[:port] 或 http(s)://localhost[:port]。
# 这类 Origin 交给 CORSMiddleware 既有规则放行（动态端口正则），无需 token 代答。
_LOCAL_ORIGIN_RE = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", re.IGNORECASE)

# 预检代答回写的允许头列表（本应用实际使用的全部自定义头 + 常规 Content-Type）
_ALLOWED_HEADERS = "X-Precis-Auth, X-Project-Config-Path, Content-Type"
# 预检代答回写的允许方法列表
_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS"


class TokenOriginAuthMiddleware:
    """
    一次性 token 放行中间件（纯 ASGI）

    处理流程:
    1. 非 HTTP scope 或未配置 PRECIS_API_TOKEN → 完全直通
    2. X-Precis-Auth 与环境 token 不等（含缺失）→ 完全直通
       （null Origin 预检/请求由 CORSMiddleware 按既有规则拒绝）
    3. OPTIONS 预检 + 非常规本机源 + 预检声明携带 X-Precis-Auth → 直接代答 200
    4. 其余有效 token 请求 → 透传，响应缺少 ACAO 头时补写回显 Origin 的 CORS 头

    补写时机说明:
    - 本中间件在 add_middleware 顺序上位于 CORSMiddleware 之后添加（先执行，外层），
      能看到 CORS 中间件处理后的响应头；仅当其未回写 ACAO（即 Origin 未被放行，
      如 null Origin）时才补写，避免与 app://. / localhost 等 Origin 的既有
      ACAO 头重复（重复 ACAO 头会被浏览器判定为 CORS 失败）
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # 非 HTTP scope（websocket/lifespan）直接透传
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # token 逐请求读取（与 PRECIS_ALLOW_NULL_ORIGIN 的读取时机一致），
        # 未配置即 Web / 开发模式，中间件完全直通
        token = os.environ.get("PRECIS_API_TOKEN", "").strip()
        if not token:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin", "")
        request_token = headers.get(AUTH_HEADER_NAME, "")

        # token 比较走 compare_digest 防时序侧信道；编码为 bytes 以兼容任意请求头值
        if not hmac.compare_digest(request_token.encode("utf-8"), token.encode("utf-8")):
            # 无效/缺失 token：不介入。null Origin 的预检与实际请求由
            # CORSMiddleware 按既有规则拒绝（不回写任何 CORS 头 / 预检 400）
            await self.app(scope, receive, send)
            return

        # 预检代答：仅针对"非常规本机源"（null/空/app:// 等无法被既有 CORS 规则
        # 放行的 Origin），且预检请求声明将携带 X-Precis-Auth 头。常规本机源的
        # 预检直接透传，由 CORSMiddleware 按既有规则应答（行为不变）。
        if (
            scope["method"] == "OPTIONS"
            and not _LOCAL_ORIGIN_RE.match(origin)
            and self._preflight_declares_auth_header(headers)
        ):
            await self._send_preflight(send, origin)
            return

        # OPTIONS 一律透传，不再补写头：预检要么已被上面代答放行，要么由
        # CORSMiddleware 按既有规则应答（本机源放行；携带有效 token 但未声明
        # X-Precis-Auth 的非本机源预检被拒绝 400）——拒绝响应必须保持无 ACAO，
        # 否则"拒绝"语义被破坏且响应头自相矛盾。
        if scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return

        # 有效 token 的实际请求：透传给下游（CORS + 路由），响应缺少 ACAO 时补写
        await self._call_with_cors_echo(scope, receive, send, origin)

    @staticmethod
    def _preflight_declares_auth_header(headers: Headers) -> bool:
        """
        @methoddesc 判断预检请求的 Access-Control-Request-Headers 是否声明了 token 头

        业务用途:
        - 浏览器预检会列出实际请求将携带的非简单头；仅当其中包含 X-Precis-Auth
          时才需要代答（实际请求才能真正带上 token）

        参数:
            headers: ASGI 请求头（大小写不敏感访问）

        返回:
            True 表示预检声明将携带 X-Precis-Auth 头
        """
        declared = headers.get("access-control-request-headers", "")
        declared_names = {name.strip().lower() for name in declared.split(",") if name.strip()}
        return AUTH_HEADER_NAME.lower() in declared_names

    @staticmethod
    async def _send_preflight(send: Send, origin: str) -> None:
        """
        @methoddesc 直接代答 CORS 预检（200 + 回显 Origin 的放行头）

        业务用途:
        - null Origin 的预检会被 CORSMiddleware 拒绝（400），本应用打包模式页面
          （app:// 协议）恰是 null Origin，故对携带有效 token 的预检在此代答放行

        参数:
            send: ASGI send 可调用对象
            origin: 请求 Origin 原样回显（null / app://. 等）
        """
        response_headers = [
            (b"access-control-allow-origin", origin.encode("latin-1")),
            (b"access-control-allow-headers", _ALLOWED_HEADERS.encode("latin-1")),
            (b"access-control-allow-methods", _ALLOWED_METHODS.encode("latin-1")),
            (b"access-control-allow-credentials", b"true"),
            (b"vary", b"Origin"),
            (b"content-length", b"0"),
        ]
        await send({"type": "http.response.start", "status": 200, "headers": response_headers})
        await send({"type": "http.response.body", "body": b""})

    async def _call_with_cors_echo(self, scope: Scope, receive: Receive, send: Send, origin: str) -> None:
        """
        @methoddesc 透传请求，并在响应缺少 ACAO 头时补写回显 Origin 的 CORS 头

        业务用途:
        - 有效 token 的实际请求（如 null Origin 的 GET）路由层正常处理，但
          CORSMiddleware 不会为 null Origin 回写 ACAO，浏览器会拦截响应读取；
          此处在响应阶段补写 ACAO（回显 Origin）+ Allow-Credentials。
          对路由返回的 4xx/5xx 同样补写——前端需要能读到错误响应体

        参数:
            scope/receive/send: 标准 ASGI 三元组
            origin: 请求 Origin（无 Origin 头时为空串，此时不补写任何 CORS 头）

        [去重说明]
        - allow_credentials=True 时 CORSMiddleware 对所有实际请求都会回写
          access-control-allow-credentials（即使 Origin 未放行），因此每个待补写头
          都必须先做存在性检查——重复的 CORS 头会被浏览器判定为 CORS 检查失败
        """

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start" and origin:
                response_headers: list[tuple[bytes, bytes]] = list(message.get("headers", []))
                header_names = {key.decode("latin-1").lower() for key, _ in response_headers}
                if "access-control-allow-origin" not in header_names:
                    additions: list[tuple[bytes, bytes]] = [(b"access-control-allow-origin", origin.encode("latin-1"))]
                    if "access-control-allow-credentials" not in header_names:
                        additions.append((b"access-control-allow-credentials", b"true"))
                    if "vary" not in header_names:
                        additions.append((b"vary", b"Origin"))
                    response_headers.extend(additions)
                    message = dict(message)
                    message["headers"] = response_headers
            await send(message)

        await self.app(scope, receive, send_wrapper)
