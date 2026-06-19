"""
Precis Web Mode - Start Server

Usage:
    precis-start [--work-dir <path>] [--port <port>] [--no-browser]

Starts the FastAPI backend server and opens the browser for Web mode.
"""

from __future__ import annotations

import argparse
import os
import sys
import webbrowser
from pathlib import Path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="precis-start",
        description="Start Precis in Web mode",
    )
    parser.add_argument(
        "--work-dir",
        default=None,
        help="Precis projects work directory (default: env PRECIS_WORK_DIR or current dir)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Server port (default: 18000)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not automatically open browser",
    )
    return parser.parse_args()


def _resolve_work_dir(arg_work_dir: str | None) -> str:
    """确定工作目录：CLI 参数 > 环境变量 > 用户配置 > 当前目录。"""
    if arg_work_dir:
        return os.path.abspath(arg_work_dir)

    env_dir = os.environ.get("PRECIS_WORK_DIR")
    if env_dir:
        return os.path.abspath(env_dir)

    config_path = Path.home() / ".precis" / "config.yaml"
    if config_path.exists():
        try:
            import yaml

            with open(config_path, encoding="utf-8") as f:
                config = yaml.safe_load(f)
            if isinstance(config, dict) and "work_dir" in config:
                return os.path.abspath(config["work_dir"])
        except Exception:
            pass

    return os.path.abspath(".")


def _resolve_port(arg_port: int | None) -> int:
    """确定端口：CLI 参数 > 环境变量 > 默认值。"""
    if arg_port:
        return arg_port
    env_port = os.environ.get("VITE_BACKEND_PORT")
    if env_port:
        try:
            return int(env_port)
        except ValueError:
            pass
    return 18000


def main() -> int:
    """Main entry point for precis-start."""
    args = _parse_args()
    work_dir = _resolve_work_dir(args.work_dir)
    port = _resolve_port(args.port)

    if not os.path.isdir(work_dir):
        print(f"Error: Work directory does not exist: {work_dir}", file=sys.stderr)
        return 1

    print(f"  ✓ Work directory: {work_dir}")
    print(f"  ✓ Port: {port}")

    # Scan and count projects
    project_count = 0
    if os.path.isdir(work_dir):
        for entry in os.scandir(work_dir):
            if entry.is_dir():
                manifest = os.path.join(entry.path, "project.precis.yaml")
                if os.path.isfile(manifest):
                    project_count += 1
    print(f"  ✓ Found {project_count} project(s)")

    # Inject work_dir into app state via environment variable
    os.environ["PRECIS_WORK_DIR"] = work_dir

    url = f"http://localhost:{port}"

    if not args.no_browser:
        print(f"  → Opening browser at {url}")
        webbrowser.open(url)

    print(f"\n  Server starting... (Ctrl+C to stop)")
    print(f"  {url}")
    print()

    # Start uvicorn server
    import uvicorn

    uvicorn.run(
        "app.api.main:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
