/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/
/**
 * @file constants.ts
 * @description 主进程共享常量
 *
 * 从 main.ts 抽出的、被多模块引用的常量。单独成文件避免循环依赖。
 */

/**
 * 后端端口哨兵值。
 *
 * 端口发现协议:后端 spawn 时传 --port 0,由 OS 原子分配端口,实际端口写入
 * <backend>/.backend-port。主进程通过读该文件发现端口并存入 appState.currentPythonServerPort。
 *
 * 此常量仅作 appState.currentPythonServerPort 的初始哨兵值(0 = 尚未发现),
 * 不再代表"默认监听端口"——后端不再有固定默认端口。
 */
export const PYTHON_PORT_SENTINEL: number = 0;

/** Python 启动信号超时（stdout/stderr 未检测到就绪信号的等待上限） */
export const PYTHON_STARTUP_SIGNAL_TIMEOUT_MS = 30000;

/** Python API 就绪超时（FastAPI /docs 响应的等待上限） */
export const PYTHON_API_READY_TIMEOUT_MS = 15000;
