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
"""@fileoverview AgentJobStorage 单元测试

覆盖 job 状态的持久化、checkpoint、清理和恢复。
"""

from __future__ import annotations

import tempfile

from app.shared.services.ai.job_storage import AgentJobStorage


def test_save_and_load_status():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = AgentJobStorage(tmpdir)
        storage.save_status("job_1", {"status": "running", "stage": "profiling"})

        loaded = storage.load_status("job_1")
        assert loaded["status"] == "running"
        assert loaded["stage"] == "profiling"


def test_save_checkpoint_and_load_latest():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = AgentJobStorage(tmpdir)
        storage.save_checkpoint("job_1", {"turn": 1, "config": {"schemas": {}}})
        storage.save_checkpoint("job_1", {"turn": 2, "config": {"schemas": {"a": {}}}})

        latest = storage.load_latest_checkpoint("job_1")
        assert latest["turn"] == 2
        assert "a" in latest["config"]["schemas"]


def test_list_jobs():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = AgentJobStorage(tmpdir)
        storage.save_status("job_a", {"status": "running"})
        storage.save_status("job_b", {"status": "pending"})

        jobs = storage.list_jobs()
        assert sorted(jobs) == ["job_a", "job_b"]


def test_cleanup_old_jobs():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = AgentJobStorage(tmpdir)
        # 已完成但 updated_at 很新的不会被清理
        storage.save_status("job_new", {"status": "completed"})
        # 手动修改 updated_at 为旧时间
        import json
        from pathlib import Path

        path = Path(tmpdir) / ".precis" / "agent_jobs" / "job_new.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["updated_at"] = "2020-01-01T00:00:00+00:00"
        data["status"]["updated_at"] = "2020-01-01T00:00:00+00:00"
        path.write_text(json.dumps(data), encoding="utf-8")

        removed = storage.cleanup_old_jobs(max_age_hours=1.0)
        assert removed == 1
        assert storage.load_status("job_new") is None


def test_delete_job():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = AgentJobStorage(tmpdir)
        storage.save_status("job_x", {"status": "running"})
        assert storage.delete_job("job_x") is True
        assert storage.load_status("job_x") is None
        assert storage.delete_job("job_x") is False
