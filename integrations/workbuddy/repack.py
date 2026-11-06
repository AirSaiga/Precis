# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""重新打包 WorkBuddy 上传包（技能包 / 连接器包），包根目录保持在 zip 顶层。"""

import os
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))

for root_dir, zip_name in [
    ("spreadsheet-data-check", "spreadsheet-data-check.zip"),
    ("precis", "precis-connector.zip"),
]:
    src = os.path.join(BASE, root_dir)
    out = os.path.join(BASE, zip_name)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _dirnames, filenames in os.walk(src):
            for fn in sorted(filenames):
                full = os.path.join(dirpath, fn)
                arc = os.path.relpath(full, BASE).replace(os.sep, "/")
                z.write(full, arc)
    with zipfile.ZipFile(out) as z:
        print(zip_name, "->")
        for name in z.namelist():
            print("   ", name)
