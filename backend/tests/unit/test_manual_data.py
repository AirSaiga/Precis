"""
@fileoverview ManualData 类型与全配置 roundtrip 测试
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.shared.core.project.manual_data.types import ManualDataFile


class TestManualDataFile:
    """ManualDataFile 模型测试"""

    def test_valid_manual_data_file(self):
        """合法 manual data 文件应能正常构造。"""
        mdf = ManualDataFile(
            id="md1",
            column_name="age",
            column_data_type="integer",
            rows=[["18"], ["25"]],
        )
        assert mdf.id == "md1"
        assert mdf.column_name == "age"
        assert mdf.rows == [["18"], ["25"]]
        assert mdf.enabled is True

    def test_default_values(self):
        """未提供可选字段时应使用默认值。"""
        mdf = ManualDataFile(id="md1")
        assert mdf.column_name == "Column1"
        assert mdf.column_data_type == "string"
        assert mdf.rows == []
        assert mdf.enabled is True
        assert mdf.description is None
        assert mdf.input_from_node is None

    def test_invalid_data_type_rejected(self):
        """非法 column_data_type 应被拒绝。"""
        with pytest.raises(ValidationError):
            ManualDataFile(id="md1", column_data_type="unknown")

    def test_model_dump_excludes_none(self):
        """model_dump 应排除 None 字段。"""
        mdf = ManualDataFile(id="md1")
        data = mdf.model_dump(exclude_none=True)
        assert "description" not in data
        assert "input_from_node" not in data


class TestManualDataFullConfigRoundtrip:
    """manual_data 全配置读写 roundtrip 测试"""

    def test_get_v2_full_config_returns_manual_data(self, tmp_path):
        """get_v2_full_config 应返回 manifest 中引用的 manual_data 文件内容。"""
        from fastapi.testclient import TestClient

        from app.api.main import app

        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "manual_data").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: proj\n  name: Proj\nmanual_data:\n  - id: md1\n    path: manual_data/md1.manual_data.yaml\n",
            encoding="utf-8",
        )
        (proj / "manual_data" / "md1.manual_data.yaml").write_text(
            'version: 2\nid: md1\ncolumn_name: age\ncolumn_data_type: integer\nrows:\n  - ["18"]\n',
            encoding="utf-8",
        )

        client = TestClient(app)
        resp = client.get("/api/latest/project/config/full", headers={"X-Project-Config-Path": str(proj)})
        assert resp.status_code == 200
        body = resp.json()
        assert "md1" in body["manual_data"]
        assert body["manual_data"]["md1"]["column_name"] == "age"
        assert body["manual_data"]["md1"]["rows"] == [["18"]]
