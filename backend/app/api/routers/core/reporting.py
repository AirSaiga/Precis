"""
@fileoverview 报告通知 API 路由模块

功能概述:
- 提供校验结果报告配置的读取和修改接口
- 支持多种报告渠道：本地文件、邮件、企业微信、飞书、钉钉
- 管理各报告服务的启用/禁用状态和详细配置

架构设计:
- 每种报告渠道对应独立的 Pydantic 配置模型
- 配置持久化为项目目录下的 reporting_config.yaml
- 不存在的配置返回默认值（local_file 启用，其余禁用）

输入示例:
    POST /reporting/config
    {
        "reporters": {
            "local_file": {"enabled": true, "log_dir": "logs"},
            "email": {"enabled": false}
        }
    }

输出示例:
    {"message": "报告配置已成功更新。"}
"""

import os
from pathlib import Path
from typing import Optional

import yaml  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.api.dependencies import ProjectStore, get_project_store
from app.shared.core.io.yaml import write_yaml_atomic

router = APIRouter(prefix="/api/latest")


class LocalFileConfig(BaseModel):
    """本地文件报告配置

    将校验结果输出到本地日志文件。

    字段说明:
        enabled: 是否启用本地文件报告
        log_dir: 日志文件存放目录（相对于项目路径）
    """

    enabled: bool
    log_dir: str = "logs"


class EmailConfig(BaseModel):
    """邮件报告配置

    通过 SMTP 服务器发送校验结果邮件。

    字段说明:
        enabled: 是否启用邮件报告
        smtp_server: SMTP 服务器地址
        smtp_port: SMTP 服务器端口
        sender_email: 发件人邮箱
        sender_password: 发件人邮箱密码
        receiver_email: 收件人邮箱
    """

    enabled: bool
    smtp_server: Optional[str] = None
    smtp_port: Optional[int] = None
    sender_email: Optional[EmailStr] = None
    sender_password: Optional[str] = None
    receiver_email: Optional[EmailStr] = None


class WeComAppConfig(BaseModel):
    """企业微信应用报告配置

    通过企业微信应用发送校验结果消息。

    字段说明:
        enabled: 是否启用企业微信报告
        corp_id: 企业ID
        corp_secret: 应用Secret
        agent_id: 应用ID
        touser: 接收消息的成员ID列表，多个用'|'分隔，默认@all（所有人）
    """

    enabled: bool
    corp_id: Optional[str] = Field(None, description="企业ID")
    corp_secret: Optional[str] = Field(None, description="应用Secret")
    agent_id: Optional[int] = Field(None, description="应用ID")
    touser: Optional[str] = Field("@all", description="接收消息的成员ID列表，多个用'|'分隔")


class FeishuAppConfig(BaseModel):
    """飞书应用报告配置

    通过飞书应用发送校验结果消息。

    字段说明:
        enabled: 是否启用飞书报告
        app_id: 应用App ID
        app_secret: 应用App Secret
        receive_id_type: 接收者ID类型（open_id/user_id/email）
        receive_ids: 接收者ID，多个用','分隔
    """

    enabled: bool
    app_id: Optional[str] = Field(None, description="应用App ID")
    app_secret: Optional[str] = Field(None, description="应用App Secret")
    receive_id_type: Optional[str] = Field("open_id", description="接收者ID类型, 例如: open_id, user_id, email")
    receive_ids: Optional[str] = Field(None, description="接收者ID, 多个用','分隔")


class DingTalkAppConfig(BaseModel):
    """钉钉应用报告配置

    通过钉钉应用发送校验结果消息。

    字段说明:
        enabled: 是否启用钉钉报告
        app_key: 应用AppKey（client_id）
        app_secret: 应用AppSecret（client_secret）
        agent_id: 应用AgentId
        userid_list: 接收者的用户ID列表，多个用','分隔
    """

    enabled: bool
    app_key: Optional[str] = Field(None, description="应用AppKey (client_id)")
    app_secret: Optional[str] = Field(None, description="应用AppSecret (client_secret)")
    agent_id: Optional[int] = Field(None, description="应用AgentId")
    userid_list: Optional[str] = Field(None, description="接收者的用户ID列表, 多个用','分隔")


class ReportersConfig(BaseModel):
    """报告渠道汇总配置

    包含所有支持的报告渠道配置，每个渠道独立管理。

    字段说明:
        local_file: 本地文件报告配置
        email: 邮件报告配置
        wecom: 企业微信报告配置
        feishu: 飞书报告配置
        dingtalk: 钉钉报告配置
    """

    local_file: LocalFileConfig
    email: EmailConfig
    wecom: WeComAppConfig
    feishu: FeishuAppConfig
    dingtalk: DingTalkAppConfig


class ReportingConfig(BaseModel):
    """报告配置根模型

    作为 API 请求和响应的根对象，包含所有报告渠道的配置。

    字段说明:
        reporters: 报告渠道汇总配置
    """

    reporters: ReportersConfig


@router.get(
    "/reporting/config",
    response_model=ReportingConfig,
    summary="获取报告配置",
    responses={
        500: {"description": "读取报告配置文件失败"},
    },
)
def get_reporting_config(store: ProjectStore = Depends(get_project_store)):
    """获取报告配置

    从项目目录下的 reporting_config.yaml 读取配置。
    如果文件不存在，返回默认配置（仅启用本地文件报告）。

    Args:
        store: 项目存储依赖，包含项目路径

    Returns:
        当前项目的报告配置对象

    Raises:
        HTTPException: 读取配置文件失败时返回 500 错误
    """
    # 构建配置文件完整路径
    config_path = os.path.join(store.project_path, "reporting_config.yaml")
    if not os.path.exists(config_path):
        # 配置文件不存在时返回默认配置
        return ReportingConfig(
            reporters=ReportersConfig(
                local_file=LocalFileConfig(enabled=True, log_dir="logs"),
                email=EmailConfig(enabled=False),
                wecom=WeComAppConfig(enabled=False, corp_id=None, corp_secret=None, agent_id=None, touser="@all"),
                feishu=FeishuAppConfig(
                    enabled=False, app_id=None, app_secret=None, receive_id_type="open_id", receive_ids=None
                ),
                dingtalk=DingTalkAppConfig(
                    enabled=False, app_key=None, app_secret=None, agent_id=None, userid_list=None
                ),
            )
        )
    try:
        # 读取并解析 YAML 配置文件
        with open(config_path, encoding="utf-8") as f:
            config_data = yaml.safe_load(f)
        return ReportingConfig(**config_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取报告配置文件失败: {e}")


@router.post(
    "/reporting/config",
    summary="更新报告配置",
    responses={
        500: {"description": "写入报告配置文件失败"},
    },
)
def update_reporting_config(config: ReportingConfig, store: ProjectStore = Depends(get_project_store)):
    """更新报告配置

    将新的报告配置持久化保存到项目目录下的 reporting_config.yaml。

    Args:
        config: 新的报告配置对象
        store: 项目存储依赖，包含项目路径

    Returns:
        更新成功消息

    Raises:
        HTTPException: 写入配置文件失败时返回 500 错误
    """
    # 构建配置文件完整路径
    config_path = os.path.join(store.project_path, "reporting_config.yaml")
    try:
        write_yaml_atomic(Path(config_path), config.model_dump())
        return {"message": "报告配置已成功更新。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入报告配置文件失败: {e}")
