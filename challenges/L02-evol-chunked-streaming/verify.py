"""L02 verify — 多级评分：分块加载 v1（中间帧释放 + 快照时机）/ v2（Excel openpyxl 重写）。

评分契约：
- stdout 首行 `SCORE: n/m`（n=得分，m=满分 9）
- 后续逐行 `  [i/j] 子项名：说明`
- 退出码 0 = 评分完成；仅环境异常才非 0
- finally 清理注入的测试文件、__pycache__ 与临时 fixture

评分项：
  1. v1 快照修正（1 分）——注入测试：快照时间戳真实 + 进程级 RSS
  2. v1 快照时机（1 分）——注入测试：分块执行期间快照覆盖合并窗口，且结果不变
  3. v2 行为等价（1 分）——注入测试：Excel 行号连续 / 表头偏移 / 尾部空行（仅当 openpyxl 重写存在时计分）
  4. v2 openpyxl 静态检查（1 分）——_load_excel_chunked 使用 openpyxl read_only
  5. 跨块护栏回归（2 分）——chunked 簇既有测试相关子集全绿
  6. 内存档（2 分）——psutil 子进程实测固定 fixture 峰值 RSS，两档阈值
  7. 质量（1 分）——改动文件 ruff
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
BACKEND_TESTS_UNIT = os.path.join(BACKEND_DIR, "tests", "unit")
TEST_SRC = os.path.join(HERE, "test_l02_v1v2.py")
TEST_DST = os.path.join(BACKEND_TESTS_UNIT, "test_l02_v1v2.py")
CHUNKED_LOADER_REL = os.path.join(
    "app", "shared", "services", "validation", "chunked_loader.py"
)

# 注入测试分组：组名 -> (测试名列表, 该组满分)
TEST_GROUPS = [
    (
        "v1-快照修正",
        ["test_snapshot_records_real_timestamp", "test_snapshot_records_process_rss"],
        1,
    ),
    ("v1-快照时机", ["test_snapshots_cover_merge_window"], 1),
    (
        "v2-行为等价",
        [
            "test_multi_chunk_continuous_row_index",
            "test_header_row_offset",
            "test_trailing_empty_rows_dropped",
        ],
        1,
    ),
]

# 跨块护栏回归子集（相对 BACKEND_DIR）。
# 注：test_chunked_loader_perf.py 内含用 mock 钉死 pd.read_excel 内部调用序列的用例，
# 与 v2 的"openpyxl read_only 重写"要求互斥，故不纳入回归门。
REGRESSION_TARGETS = [
    os.path.join("tests", "unit", "test_chunked_loader.py"),
    os.path.join("tests", "unit", "test_chunked_loader_deep.py"),
    os.path.join("tests", "unit", "test_chunked_constraint_correctness.py"),
    os.path.join("tests", "unit", "test_executor_chunked.py"),
    os.path.join("tests", "unit", "test_executor_execute_chunked.py"),
]

# 内存档阈值（MB，峰值 RSS）：T1=2 分，T2=1 分
# 定档依据（出题机上实测，min-of-2）：未实现 ≈774MB，参考答案 ≈687MB
MEM_T1_MB = 725.0
MEM_T2_MB = 748.0

# 固定 fixture：60 万行 × 11 列 CSV（2 int + 9 string），chunk_rows=20000 → 30 块
FIXTURE_ROWS = 600_000
FIXTURE_CHUNK_ROWS = 20_000

# 子进程测量脚本：生成 fixture 后仅对 _execute_chunked 全程采样自身 RSS
MEASURE_SCRIPT = r"""
import csv
import os
import sys
import threading
import time

sys.path.insert(0, os.environ["PRECIS_BACKEND"])

import psutil

fixture_dir = sys.argv[1]
csv_path = os.path.join(fixture_dir, "perf_fixture.csv")

with open(csv_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["id", "name", "value", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"])
    for i in range(%(rows)d):
        w.writerow(
            [
                i, "name_%%d_segment_text_for_memory_pressure" %% i, i,
                "payload_%%d_alpha_beta_gamma" %% i, "payload_%%d_delta_epsilon_zeta" %% i,
                "payload_%%d_eta_theta_iota" %% i, "payload_%%d_kappa_lambda_mu" %% i,
                "payload_%%d_nu_xi_omicron" %% i, "payload_%%d_pi_rho_sigma" %% i,
                "payload_%%d_tau_upsilon_phi" %% i, "payload_%%d_chi_psi_omega" %% i,
            ]
        )

from unittest.mock import MagicMock

from app.shared.domain.constraints import NotNullConstraint, UniqueConstraint
from app.shared.domain.data_types import IntegerType, StringType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.services.validation.chunked_loader import ChunkedDataLoader
from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions
from app.shared.services.validation.memory_monitor import MemoryMonitor
from app.shared.services.validation.resolver import DataSourceResolver

string_cols = ["name", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
schema = DataSetSchema(
    tables={
        "main": TableSchema(
            id="main",
            name="main",
            columns=[ColumnSchema(name="id", id="id", data_type=IntegerType())]
            + [ColumnSchema(name=c, id=c, data_type=StringType()) for c in string_cols]
            + [ColumnSchema(name="value", id="value", data_type=IntegerType())],
        ),
    },
    constraints=[
        NotNullConstraint(table="main", column="id"),
        UniqueConstraint(table="main", column="id"),
    ],
)

executor = ValidationExecutor.__new__(ValidationExecutor)
executor.project_root = "D:\\project"
executor.loaded_project = MagicMock()
executor.loaded_project.loading_errors = []
executor.loaded_project.warnings = []
executor.dataset_schema = schema
executor.settings = MagicMock()
executor.manifest = MagicMock()
executor.allow_unsafe_eval = None
executor._schema_by_id = {}
executor._resolve_allow_unsafe_eval = lambda options: False

schema_file = MagicMock()
schema_file.source_file = csv_path
schema_file.sheet_name = None
schema_file.header_row = 0
schema_file.source_config = {"delimiter": ","}

resolver = DataSourceResolver("D:\\project", MagicMock(), {})
resolver.resolve_first_data_source = lambda: fixture_dir
resolver.resolve_source_path = lambda data_directory, sf: (csv_path, None)
executor._resolver = resolver

monitor = MemoryMonitor(chunk_threshold_mb=0.001, chunk_rows=%(chunk_rows)d)
executor._memory_monitor = monitor
loader = ChunkedDataLoader(resolver, schema, {"main": schema_file}, MagicMock(), memory_monitor=monitor)
executor._get_chunked_loader = lambda options: loader

result = {
    "raw_datasets": {},
    "parsed_datasets": {},
    "errors": [],
    "loading_errors": [],
    "duration_ms": 0,
    "timeout_occurred": False,
    "validation_details": {"format_checks": [], "constraint_checks": []},
    "chunked_mode": False,
    "memory_info": {},
    "warnings": [],
}

proc = psutil.Process()
peak = [0.0]
stop = [False]


def _sample():
    while not stop[0]:
        try:
            rss = proc.memory_info().rss / (1024 * 1024)
            if rss > peak[0]:
                peak[0] = rss
        except Exception:
            pass
        time.sleep(0.005)


t = threading.Thread(target=_sample, daemon=True)
t.start()
try:
    result = executor._execute_chunked(
        fixture_dir,
        ValidationOptions(timeout_seconds=600, chunk_threshold_mb=0.001, chunk_rows=%(chunk_rows)d),
        time.monotonic(),
        result,
    )
finally:
    stop[0] = True
    t.join(timeout=2)

print("PEAK_MB: %%.1f" %% peak[0])
print("ERRORS: %%d" %% len(result["errors"]))
"""


def _run(
    cmd: list[str], cwd: str, env: dict[str, str], timeout: int = 600
) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, cwd=cwd, env=env, timeout=timeout
    )


def _backend_env() -> dict[str, str]:
    existing = os.environ.get("PYTHONPATH", "")
    return {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(p for p in [BACKEND_DIR, existing] if p),
        "PRECIS_BACKEND": BACKEND_DIR,
    }


def _run_pytest(targets: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    return _run(
        [
            sys.executable,
            "-m",
            "pytest",
            *targets,
            "-q",
            "--tb=no",
            "-p",
            "no:cacheprovider",
        ],
        cwd=BACKEND_DIR,
        env=env,
    )


def _parse_failed_tests(output: str) -> set[str]:
    failed: set[str] = set()
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("FAILED"):
            name = line.split("::")[-1].split(" ", 1)[0].split("-", 1)[0].strip()
            if name:
                failed.add(name)
    return failed


def _changed_py_files() -> list[str]:
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    tracked = _run(
        ["git", "diff", "--name-only", "--diff-filter=ACM", "--", "*.py"],
        cwd=REPO_ROOT,
        env=env,
    )
    untracked = _run(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "*.py"],
        cwd=REPO_ROOT,
        env=env,
    )
    injected_base = os.path.basename(TEST_DST)
    files: list[str] = []
    for proc in (tracked, untracked):
        if proc.returncode != 0:
            continue
        for rel in proc.stdout.splitlines():
            rel = rel.strip().replace("/", os.sep)
            if not rel.startswith(f"backend{os.sep}") or rel.endswith(
                f"tests{os.sep}unit{os.sep}{injected_base}"
            ):
                continue
            files.append(os.path.join(REPO_ROOT, rel))
    return sorted(set(files))


def _tail(text: str, limit: int) -> str:
    return text[-limit:] if len(text) > limit else text


def _cleanup() -> None:
    if os.path.exists(TEST_DST):
        try:
            os.remove(TEST_DST)
        except OSError:
            pass
    cache_dir = os.path.join(BACKEND_TESTS_UNIT, "__pycache__")
    if os.path.isdir(cache_dir):
        for fname in os.listdir(cache_dir):
            if fname.startswith("test_l02_v1v2"):
                try:
                    os.remove(os.path.join(cache_dir, fname))
                except OSError:
                    pass


def main() -> int:
    if not os.path.isfile(TEST_SRC) or not os.path.isdir(BACKEND_TESTS_UNIT):
        print("SCORE: 0/9")
        print("  [0/9] 环境异常：注入测试源或 backend/tests/unit 不存在")
        return 1

    scores: list[tuple[int, int, str]] = []
    env = _backend_env()

    shutil.copy2(TEST_SRC, TEST_DST)
    fixture_tmp = None
    try:
        # ---------- 1-3. 注入测试分组 ----------
        injected = _run_pytest([TEST_DST], env)
        failed = (
            _parse_failed_tests(injected.stdout)
            if injected.returncode in (0, 1)
            else {t for _, ts, _ in TEST_GROUPS for t in ts}
        )
        for group_name, test_names, max_points in TEST_GROUPS:
            group_failed = sorted(t for t in test_names if t in failed)
            passed_all = not group_failed
            scores.append(
                (
                    max_points if passed_all else 0,
                    max_points,
                    f"{group_name} — {'全部通过' if passed_all else '存在失败: ' + ', '.join(group_failed)}",
                )
            )
        if failed:
            print(f"--- 注入测试输出 ---\n{_tail(injected.stdout, 2000)}")
            if injected.stderr:
                print(f"--- 注入测试 stderr ---\n{_tail(injected.stderr, 800)}")

        # ---------- 4. v2 openpyxl 静态检查 ----------
        loader_path = os.path.join(BACKEND_DIR, CHUNKED_LOADER_REL)
        static_ok = False
        if os.path.isfile(loader_path):
            with open(loader_path, encoding="utf-8") as f:
                src = f.read().lower()
            static_ok = "openpyxl" in src and "read_only" in src
        scores.append(
            (
                1 if static_ok else 0,
                1,
                "v2-openpyxl 重写 — _load_excel_chunked 需使用 openpyxl read_only 模式（静态检查）",
            )
        )
        # v2 行为等价分仅在重写存在时计分（否则旧实现天然通过、无意义）
        if not static_ok:
            for i, (s, m, desc) in enumerate(scores):
                if desc.startswith("v2-行为等价"):
                    scores[i] = (0, m, desc + "（openpyxl 重写未检出，不计分）")
                    break

        # ---------- 5. 跨块护栏回归 ----------
        regression = _run_pytest(REGRESSION_TARGETS, env)
        reg_ok = regression.returncode == 0
        scores.append(
            (
                2 if reg_ok else 0,
                2,
                "跨块护栏回归（chunked 簇既有测试）— "
                + (f"{len(REGRESSION_TARGETS)} 个文件全绿" if reg_ok else "存在失败"),
            )
        )
        if not reg_ok:
            print(f"--- 回归失败输出 ---\n{_tail(regression.stdout, 2000)}")

        # ---------- 6. 内存档（子进程峰值 RSS，两档阈值） ----------
        fixture_tmp = tempfile.mkdtemp(prefix="l02_fixture_")
        peak_mb: float | None = None
        for _ in range(2):
            proc = _run(
                [
                    sys.executable,
                    "-c",
                    MEASURE_SCRIPT
                    % {"rows": FIXTURE_ROWS, "chunk_rows": FIXTURE_CHUNK_ROWS},
                    fixture_tmp,
                ],
                cwd=BACKEND_DIR,
                env=env,
                timeout=900,
            )
            if proc.returncode != 0:
                print(
                    f"--- 内存测量子进程异常 ---\n{_tail(proc.stdout, 800)}\n{_tail(proc.stderr, 800)}"
                )
                continue
            for line in proc.stdout.splitlines():
                if line.startswith("PEAK_MB:"):
                    try:
                        v = float(line.split(":", 1)[1].strip())
                        peak_mb = v if peak_mb is None else min(peak_mb, v)
                    except ValueError:
                        pass
        if peak_mb is None:
            scores.append((0, 2, "内存档 — 测量失败（psutil 子进程未产出 PEAK_MB）"))
        else:
            tier = 2 if peak_mb <= MEM_T1_MB else (1 if peak_mb <= MEM_T2_MB else 0)
            scores.append(
                (
                    tier,
                    2,
                    f"内存档 — 峰值 RSS {peak_mb:.1f}MB（T1≤{MEM_T1_MB:.0f}MB 得 2 分，T2≤{MEM_T2_MB:.0f}MB 得 1 分）",
                )
            )

        # ---------- 7. 质量 ruff ----------
        changed = _changed_py_files()
        if not changed:
            scores.append((0, 1, "质量-ruff — 未检测到 backend 改动文件，不得分"))
        else:
            changed_rel = [os.path.relpath(f, BACKEND_DIR) for f in changed]
            ruff = _run(
                [sys.executable, "-m", "ruff", "check", *changed_rel],
                cwd=BACKEND_DIR,
                env=env,
            )
            scores.append(
                (
                    1 if ruff.returncode == 0 else 0,
                    1,
                    "质量-ruff — "
                    + (
                        "全部改动文件通过"
                        if ruff.returncode == 0
                        else "有 lint 违规：\n" + _tail(ruff.stdout, 800)
                    ),
                )
            )
    finally:
        _cleanup()
        if fixture_tmp and os.path.isdir(fixture_tmp):
            shutil.rmtree(fixture_tmp, ignore_errors=True)

    total = sum(s for s, _, _ in scores)
    max_total = sum(m for _, m, _ in scores)
    print(f"SCORE: {total}/{max_total}")
    for i, (s, m, desc) in enumerate(scores, 1):
        print(f"  [{s}/{m}] {desc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
