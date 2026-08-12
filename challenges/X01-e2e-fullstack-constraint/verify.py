"""X01 verify — 在真实 Precis 仓库上验证 Precision 约束全栈链路。

退出码：0 = PASS，非 0 = FAIL。
stdout 首行：PASS 或 FAIL，随后按 `  [✓]/[✗]` 列出明细。

流程（两段，后端 → 前端）：
  A. 后端段：
     1. 把 test_x01_precision.py 复制到 backend/tests/unit/test_x01_precision.py
     2. 以 PYTHONPATH=backend 运行 pytest 该注入文件（功能测试）
     3. 回归门：运行仓库既有的相关测试子集
        （test_validation_constraints_imports.py 硬编码断言 validation_constraints.__all__
        等于固定 13 项集合——实现 Precision 约束时若把它加进该 __all__ 或弄坏兼容层导出，
        回归即失败；另含约束注册表与约束工厂既有测试）
  B. 前端段：
     4. 把 test_x01_precision.test.ts 复制到 frontend/tests/test_x01_precision.test.ts
     5. 在 frontend/ 下以 vitest 运行该注入文件（注册断言 + handler 本地执行）
     6. 回归门：运行前端既有的约束测试子集（注册表完整性 / 注册表核心 / 节点数据构建器 /
        round-trip / 导出适配器）。注意：注册表完整性测试与注册表核心测试各含一处硬编码
        "10 种约束"的参考副本，新增第 11 种必须同步更新——这是任务要求的一部分。
     7. 静态检查（防弱化 + 类型接通 + 导出适配层穷尽）：
        (a) registryIntegrity.test.ts 保留全部 10 个既有 v2Type 且补入 'Precision'
        (b) validationRegistryCore.test.ts 的长度断言更新为 toHaveLength(11)
        (c) 约束服务层类型模块含 'precision' / 'precisionConstraint' 联合成员
        (d) PrecisionConstraintNodeData 接口声明存在，且 nodes.ts 中引用 ≥2 次（联合成员）
        (e) constraintExportAdapter.ts 含 case 'Precision'（该文件对 v2Type 做穷尽 switch，
            default 分支 `const _exhaustive: never = v2Type`；ConstraintTypeV2 加 'Precision'
            后若不同步加 case，`npm run type-check` 红——注入测试与回归子集不覆盖此编译期契约，
            本静态检查专为兜底）
  注入测试、回归子集、静态检查全部通过才 PASS。
  8. 无论成败，finally 清理复制进去的测试文件与字节码缓存（不污染真实仓库）。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))  # D:/Precis/Precis
BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
BACKEND_TESTS_UNIT = os.path.join(BACKEND_DIR, "tests", "unit")
FRONTEND_DIR = os.path.join(REPO_ROOT, "frontend")
FRONTEND_TESTS = os.path.join(FRONTEND_DIR, "tests")
FRONTEND_SRC = os.path.join(FRONTEND_DIR, "src")

BTEST_SRC = os.path.join(HERE, "test_x01_precision.py")
BTEST_DST = os.path.join(BACKEND_TESTS_UNIT, "test_x01_precision.py")
FTEST_SRC = os.path.join(HERE, "test_x01_precision.test.ts")
FTEST_DST = os.path.join(FRONTEND_TESTS, "test_x01_precision.test.ts")

# 后端回归门：仓库既有的相关测试子集（相对 BACKEND_DIR）。
BACKEND_REGRESSION = [
    os.path.join("tests", "unit", "test_validation_constraints_imports.py"),
    os.path.join("tests", "unit", "test_constraint_registry.py"),
    os.path.join("tests", "unit", "test_constraint_factory.py"),
]

# 前端回归门：仓库既有的约束测试子集（相对 frontend/，vitest 参数用正斜杠）。
# registryIntegrity / validationRegistryCore 各含一处硬编码 "10 种约束" 参考副本，
# 任务要求同步更新（数量 +1、补 'Precision'）；静态检查防弱化（见 SYNC_ORIGINAL_V2）。
FRONTEND_REGRESSION = [
    "tests/services/constraints/registryIntegrity.test.ts",
    "tests/services/constraints/validationRegistryCore.test.ts",
    "tests/services/constraints/nodeDataBuilder.test.ts",
    "tests/services/constraints/roundTrip.test.ts",
    "tests/services/constraints/constraintExportAdapter.test.ts",
]

# 既有 10 种约束的 v2Type 字面量——参考副本同步检查要求它们全部保留（防"删除以通过"）。
SYNC_ORIGINAL_V2 = [
    "'Unique'",
    "'NotNull'",
    "'ForeignKey'",
    "'AllowedValues'",
    "'Range'",
    "'Conditional'",
    "'Scripted'",
    "'Charset'",
    "'DateLogic'",
    "'Composite'",
]

RI_TEST = os.path.join(
    FRONTEND_DIR, "tests", "services", "constraints", "registryIntegrity.test.ts"
)
VRC_TEST = os.path.join(
    FRONTEND_DIR, "tests", "services", "constraints", "validationRegistryCore.test.ts"
)
CONSTRAINT_TYPES_TS = os.path.join(FRONTEND_SRC, "services", "constraints", "types.ts")
TYPES_CONSTRAINTS_TS = os.path.join(FRONTEND_SRC, "types", "constraints.ts")
TYPES_NODES_TS = os.path.join(FRONTEND_SRC, "types", "nodes.ts")
EXPORT_ADAPTER_TS = os.path.join(
    FRONTEND_SRC, "services", "constraints", "constraintExportAdapter.ts"
)


def _read(p: str) -> str:
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def _tail(text: str, limit: int) -> str:
    return text[-limit:] if len(text) > limit else text


def _run_pytest(
    targets: list[str], env: dict[str, str], verbose: bool
) -> subprocess.CompletedProcess:
    """以统一的 cwd/env 运行 pytest（-p no:cacheprovider 保证不产生 .pytest_cache）。"""
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            *targets,
            "-v" if verbose else "-q",
            "--tb=short",
            "-p",
            "no:cacheprovider",
        ],
        capture_output=True,
        text=True,
        cwd=BACKEND_DIR,
        env=env,
    )


def _run_vitest(rel_targets: list[str], timeout: int) -> tuple[bool, str, str, bool]:
    """在 frontend/ 下运行一次 vitest（run 模式）。返回 (ok, stdout, stderr, timed_out)。

    注：Windows 下 npx 是 npx.cmd，必须 shell=True 才能解析。
    """
    cmd = f"npx vitest run {' '.join(rel_targets)} --reporter=dot"
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=FRONTEND_DIR,
            timeout=timeout,
        )
        return proc.returncode == 0, proc.stdout, proc.stderr, False
    except subprocess.TimeoutExpired as exc:
        out = (
            exc.stdout.decode("utf-8", "replace")
            if isinstance(exc.stdout, bytes)
            else (exc.stdout or "")
        )
        err = (
            exc.stderr.decode("utf-8", "replace")
            if isinstance(exc.stderr, bytes)
            else (exc.stderr or "")
        )
        return False, out, err, True


def main() -> int:
    # ======================= 0. 前置检查 =======================
    if not os.path.isfile(BTEST_SRC):
        print("FAIL")
        print(f"  后端测试源文件不存在: {BTEST_SRC}")
        return 1
    if not os.path.isdir(BACKEND_TESTS_UNIT):
        print("FAIL")
        print(f"  后端测试目录不存在: {BACKEND_TESTS_UNIT}")
        return 1
    if not os.path.isfile(FTEST_SRC):
        print("FAIL")
        print(f"  前端测试源文件不存在: {FTEST_SRC}")
        return 1
    if not os.path.isdir(FRONTEND_DIR):
        print("FAIL")
        print(f"  前端目录不存在: {FRONTEND_DIR}")
        return 1
    # worktree/副本通常不含 node_modules，vitest 不存在时给出明确指引而非裸报错
    vitest_bin = os.path.join(FRONTEND_DIR, "node_modules", ".bin", "vitest")
    if not os.path.exists(vitest_bin):
        print("FAIL")
        print(f"  未找到 vitest: {vitest_bin}")
        print(
            "  当前 frontend/ 缺少 node_modules（worktree/副本不含依赖），请先二选一："
        )
        print("    1) 安装依赖: cd frontend && npm ci")
        print(
            "    2) (Windows) 建 junction 共享主仓库依赖: "
            "cmd /c mklink /J <worktree>\\frontend\\node_modules <主仓库>\\frontend\\node_modules"
        )
        return 1

    injected_b_ok = False
    regression_b_ok = False
    injected_b = None
    regression_b = None
    injected_f_ok = False
    regression_f_ok = False
    injected_f = (False, "", "", False)
    regression_f = (False, "", "", False)

    # 复制两个测试文件进真实仓库（verify 期间临时存在）
    shutil.copy2(BTEST_SRC, BTEST_DST)
    os.makedirs(os.path.dirname(FTEST_DST), exist_ok=True)
    shutil.copy2(FTEST_SRC, FTEST_DST)

    try:
        # ======================= A. 后端段 =======================
        env = {**os.environ, "PYTHONPATH": BACKEND_DIR}
        injected_b = _run_pytest([BTEST_DST], env, verbose=True)
        injected_b_ok = injected_b.returncode == 0
        regression_b = _run_pytest(BACKEND_REGRESSION, env, verbose=False)
        regression_b_ok = regression_b.returncode == 0

        # ======================= B. 前端段 =======================
        injected_f = _run_vitest(["tests/test_x01_precision.test.ts"], timeout=180)
        injected_f_ok = injected_f[0]
        regression_f = _run_vitest(FRONTEND_REGRESSION, timeout=300)
        regression_f_ok = regression_f[0]

        # ======================= C. 静态检查 =======================
        ri_text = _read(RI_TEST)
        vrc_text = _read(VRC_TEST)
        ctypes_text = _read(CONSTRAINT_TYPES_TS)
        tcons_text = _read(TYPES_CONSTRAINTS_TS)
        tnodes_text = _read(TYPES_NODES_TS)
        adapter_text = _read(EXPORT_ADAPTER_TS)

        # (a) 参考副本：全部 10 个既有 v2Type 保留 + 补入 'Precision'；数量断言更新为 11
        sync_ri_ok = (
            all(t in ri_text for t in SYNC_ORIGINAL_V2) and "'Precision'" in ri_text
        )
        sync_vrc_ok = "toHaveLength(11)" in vrc_text
        sync_ok = sync_ri_ok and sync_vrc_ok
        # (b) 前端类型：约束服务层类型联合 + 节点数据接口 + CustomNodeData 联合
        union_ok = (
            "'precision'" in ctypes_text and "'precisionConstraint'" in ctypes_text
        )
        iface_ok = "interface PrecisionConstraintNodeData" in tcons_text
        union_member_ok = tnodes_text.count("PrecisionConstraintNodeData") >= 2
        types_ok = union_ok and iface_ok and union_member_ok
        # (e) 导出适配层穷尽 switch：ConstraintTypeV2 加 'Precision' 后必须给
        # constraintExportAdapter.ts 的 switch 同步加 case，否则 type-check 红。
        # 注入测试/回归子集是运行时验证，覆盖不了这条编译期契约，漏改也能全绿——必须静态兜底。
        adapter_ok = "case 'Precision'" in adapter_text

        passed = (
            injected_b_ok
            and regression_b_ok
            and injected_f_ok
            and regression_f_ok
            and sync_ok
            and types_ok
            and adapter_ok
        )

        # ======================= 输出（标准契约） =======================
        print("PASS" if passed else "FAIL")
        print(
            f"  [{'✓' if injected_b_ok else '✗'}] 后端注入测试: {os.path.relpath(BTEST_DST, BACKEND_DIR)}"
        )
        print(
            f"  [{'✓' if regression_b_ok else '✗'}] 后端回归（既有测试）: "
            + ", ".join(BACKEND_REGRESSION)
        )
        print(
            f"  [{'✓' if injected_f_ok else '✗'}] 前端注入测试: tests/test_x01_precision.test.ts"
        )
        print(
            f"  [{'✓' if regression_f_ok else '✗'}] 前端回归（既有测试）: "
            + ", ".join(FRONTEND_REGRESSION)
        )
        print(
            f"  [{'✓' if sync_ok else '✗'}] 参考副本同步 "
            "(registryIntegrity BACKEND_V2_TYPES 补 'Precision' 且保留 10 项 / "
            "validationRegistryCore 长度断言 toHaveLength(11))"
        )
        print(
            f"  [{'✓' if types_ok else '✗'}] 前端类型接通 "
            "(ConstraintKind/ConstraintNodeType 联合 + PrecisionConstraintNodeData 接口 + "
            "CustomNodeData 联合成员)"
        )
        print(
            f"  [{'✓' if adapter_ok else '✗'}] 导出适配层穷尽检查 "
            "(constraintExportAdapter.ts 含 case 'Precision'，漏改则 ConstraintTypeV2 穷尽 "
            "switch 报错、npm run type-check 红)"
        )

        print("--- 后端注入测试输出 ---")
        print(_tail(injected_b.stdout, 2500))
        if injected_b.stderr:
            print("--- 后端注入测试 stderr ---")
            print(_tail(injected_b.stderr, 800))
        if not regression_b_ok:
            print("--- 后端回归失败输出 ---")
            print(_tail(regression_b.stdout, 2500))
            if regression_b.stderr:
                print("--- 后端回归 stderr ---")
                print(_tail(regression_b.stderr, 800))

        print("--- 前端注入测试输出 ---")
        print(_tail(injected_f[1], 3000))
        if injected_f[2]:
            print("--- 前端注入测试 stderr ---")
            print(_tail(injected_f[2], 1200))
        if injected_f[3]:
            print("--- 前端注入测试 vitest 进程超时被杀 ---")
        if not regression_f_ok:
            print("--- 前端回归失败输出 ---")
            print(_tail(regression_f[1], 3000))
            if regression_f[2]:
                print("--- 前端回归 stderr ---")
                print(_tail(regression_f[2], 1200))
            if regression_f[3]:
                print("--- 前端回归 vitest 进程超时被杀 ---")

        if not sync_ok:
            print(
                "--- 参考副本同步详情 ---\n"
                f"registryIntegrity 保留 10 项 + 补 Precision: {sync_ri_ok}\n"
                f"validationRegistryCore toHaveLength(11): {sync_vrc_ok}"
            )
        if not types_ok:
            print(
                "--- 前端类型接通详情 ---\n"
                f"types.ts 联合含 'precision'/'precisionConstraint': {union_ok}\n"
                f"types/constraints.ts 含 PrecisionConstraintNodeData 接口: {iface_ok}\n"
                f"types/nodes.ts 引用 ≥2 次（联合成员）: {union_member_ok}"
            )
        if not adapter_ok:
            print(
                "--- 导出适配层穷尽检查详情 ---\n"
                f"constraintExportAdapter.ts 未找到 case 'Precision'（adapter_ok={adapter_ok}）。\n"
                "ConstraintTypeV2 已含 'Precision'，但导出适配器的 switch 未同步加 case，"
                "default 分支的穷尽检查会令 npm run type-check 报错。"
            )

        return 0 if passed else 1
    finally:
        # ======================= 清理 =======================
        for dst, cache_dir, prefix in (
            (
                BTEST_DST,
                os.path.join(BACKEND_TESTS_UNIT, "__pycache__"),
                "test_x01_precision",
            ),
        ):
            if os.path.exists(dst):
                try:
                    os.remove(dst)
                except OSError:
                    pass
            if os.path.isdir(cache_dir):
                for fname in os.listdir(cache_dir):
                    if fname.startswith(prefix):
                        try:
                            os.remove(os.path.join(cache_dir, fname))
                        except OSError:
                            pass
        if os.path.exists(FTEST_DST):
            try:
                os.remove(FTEST_DST)
            except OSError:
                pass
        # 注：pytest 带 -p no:cacheprovider 不写 .pytest_cache；vitest run 的缓存在
        # node_modules/.vite（依赖目录常态产物），均无需清理。


if __name__ == "__main__":
    sys.exit(main())
