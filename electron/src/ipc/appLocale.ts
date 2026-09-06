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
 * @file appLocale.ts
 * @description 应用语言同步 IPC
 *
 * 渲染进程在启动时与切换语言时，把用户在设置中选择的语言推送给主进程，
 * 使主进程的原生对话框/崩溃弹窗等用户可见文案跟随应用语言（见 i18n.ts）。
 * 单向 fire-and-forget：主进程无需向渲染进程回执。
 */

import { ipcMain } from 'electron';
import { setAppLocale } from '../i18n';
import { logger } from '../logger';

export function registerAppLocaleIpc(): void {
  ipcMain.on('app:set-locale', (_event, locale: unknown) => {
    if (typeof locale === 'string') {
      setAppLocale(locale);
      logger.debug('[Main] 应用语言已同步:', locale);
    }
  });
}
