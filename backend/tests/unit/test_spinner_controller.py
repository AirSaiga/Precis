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
"""@fileoverview SpinnerController 幂等性与 pause 停机应答握手测试

覆盖：
- start/stop/pause/resume 幂等性守卫（一次对话存在多个等待窗口，重复调用无副作用）
- pause 停机应答握手：清行序列之后不会再有 spinner 帧（否则后台帧会从行首
  覆盖随后打印文本——确认框动作清单首条的 "  1. " 前缀被抹）
"""

from __future__ import annotations

import time

from app.cli.shell.commands.ai.executor_utils import SpinnerController

# pause()/stop() 打印的清行序列（\r + 20 空格 + \r）
CLEAR_SEQUENCE = f"\r{' ' * 20}\r"


def _speed_up_spinner_frames(monkeypatch):
    """把 time.sleep 缩短到 ≤10ms 提高 spinner 帧率，放大 pause 清行与后台帧的交错窗口。

    返回真实 sleep 供测试自身计时（避免测试代码也跟着提速）。
    """
    real_sleep = time.sleep
    monkeypatch.setattr(time, "sleep", lambda s: real_sleep(min(s, 0.01)))
    return real_sleep


class TestSpinnerIdempotency:
    """幂等性守卫：重复调用无副作用。"""

    def test_start_twice_keeps_single_thread(self, capsys):
        spinner = SpinnerController()
        spinner.start()
        thread_after_first_start = spinner._thread
        spinner.start()
        assert spinner._thread is thread_after_first_start
        assert spinner.is_running
        spinner.stop()
        capsys.readouterr()

    def test_stop_twice_prints_clear_sequence_once(self, capsys):
        spinner = SpinnerController()
        spinner.start()
        spinner.stop()
        spinner.stop()
        assert capsys.readouterr().out.count(CLEAR_SEQUENCE) == 1

    def test_stop_when_not_running_outputs_nothing(self, capsys):
        spinner = SpinnerController()
        spinner.stop()
        assert capsys.readouterr().out == ""

    def test_pause_resume_when_not_running_are_noop(self, capsys):
        spinner = SpinnerController()
        spinner.pause()
        spinner.resume()
        assert capsys.readouterr().out == ""


class TestPauseHandshake:
    """pause 停机应答握手：清行之后不会再有帧。"""

    def test_pause_waits_ack_and_silences_after_clear(self, capsys, monkeypatch):
        real_sleep = _speed_up_spinner_frames(monkeypatch)
        spinner = SpinnerController()
        try:
            spinner.start()
            real_sleep(0.1)  # 让后台线程先吐若干帧
            spinner.pause()  # 停机应答握手后再清行
            # pause 返回即表示后台线程已观察到暂停并应答，不会再吐帧
            assert spinner._paused_ack.is_set()
            real_sleep(0.1)  # 观察窗口：若存在竞态帧会在此期间出现
        finally:
            out = capsys.readouterr().out
            spinner.stop()
            capsys.readouterr()

        assert "AI>" in out  # spinner 确实运行过
        assert CLEAR_SEQUENCE in out  # pause 输出了清行序列
        tail = out[out.rindex(CLEAR_SEQUENCE) + len(CLEAR_SEQUENCE) :]
        assert "AI>" not in tail  # 清行之后无任何帧

    def test_pause_resume_pause_rearms_handshake(self, capsys, monkeypatch):
        real_sleep = _speed_up_spinner_frames(monkeypatch)
        spinner = SpinnerController()
        try:
            spinner.start()
            real_sleep(0.05)
            spinner.pause()
            capsys.readouterr()

            spinner.resume()
            real_sleep(0.05)  # 恢复后应重新吐帧
            frames_after_resume = capsys.readouterr().out
            spinner.pause()
            assert spinner._paused_ack.is_set()  # 第二次 pause 重新完成握手
            real_sleep(0.05)  # 观察窗口
            out = capsys.readouterr().out
        finally:
            spinner.stop()
            capsys.readouterr()

        assert "AI>" in frames_after_resume
        assert CLEAR_SEQUENCE in out
        tail = out[out.rindex(CLEAR_SEQUENCE) + len(CLEAR_SEQUENCE) :]
        assert "AI>" not in tail
