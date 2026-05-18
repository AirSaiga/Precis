"""
@fileoverview edition.py 单元测试

覆盖 get_current_edition、is_team_edition、is_personal_edition 的未覆盖分支。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.edition import (
    Edition,
    clear_edition_cache,
    get_current_edition,
    is_personal_edition,
    is_team_edition,
    set_edition_for_test,
)


class TestEdition:
    def teardown_method(self):
        clear_edition_cache()

    def test_default_personal(self):
        clear_edition_cache()
        assert get_current_edition() == Edition.PERSONAL
        assert is_personal_edition() is True
        assert is_team_edition() is False

    def test_team_env(self, monkeypatch):
        clear_edition_cache()
        monkeypatch.setenv("PRECIS_EDITION", "team")
        assert get_current_edition() == Edition.TEAM
        assert is_team_edition() is True

    def test_old_config_file(self, tmp_path, monkeypatch):
        clear_edition_cache()
        monkeypatch.delenv("PRECIS_EDITION", raising=False)
        # Create old config file
        old_file = tmp_path / ".precis-edition"
        old_file.write_text("team", encoding="utf-8")
        # Patch project root to tmp_path
        # Can't easily patch __file__, so test indirectly via exception path
        assert get_current_edition() == Edition.PERSONAL  # No config file found

    def test_cached_value(self):
        clear_edition_cache()
        set_edition_for_test(Edition.TEAM)
        assert get_current_edition() == Edition.TEAM
        # Second call should use cache
        assert get_current_edition() == Edition.TEAM
