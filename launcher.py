#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3D Earth Platform - 带界面的启动工具
启动/停止地图服务(9001)与 API 服务(9000)，各服务输出在界面中分别显示。
"""
import json
import queue
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext, messagebox
except ImportError:
    print("请安装 Python 并确保带有 tkinter（通常已内置）")
    sys.exit(1)

ROOT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = ROOT_DIR / "config.json"
MAP_DIR = ROOT_DIR / "map"
BACKEND_DIR = ROOT_DIR / "backend"

# 主线程消费输出用的队列：(which, line) 其中 which in ('map', 'api')
output_queue = queue.Queue()


def load_config():
    out = {
        "api_server": "http://127.0.0.1:9000",
        "tile_server_public": "http://127.0.0.1:9001",
    }
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                c = json.load(f)
            out["api_server"] = (c.get("api_server") or out["api_server"]).rstrip("/")
            out["tile_server_public"] = (c.get("tile_server_public") or c.get("tile_service_url") or out["tile_server_public"]).rstrip("/")
        except Exception:
            pass
    return out


def is_windows():
    return sys.platform.startswith("win")


def is_port_in_use(port):
    """检测端口是否已被占用（用连接检测，避免 bind 导致端口短暂占用引发 10048）"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            s.connect(("127.0.0.1", port))
        return True  # 能连上说明已有进程在监听
    except (OSError, socket.error):
        return False


def read_stream(proc, which):
    """在子线程中读取进程 stdout，将每行放入队列"""
    try:
        for line in iter(proc.stdout.readline, ""):
            output_queue.put((which, line))
    except Exception:
        pass
    output_queue.put((which, None))  # 结束标记


class LauncherApp:
    def __init__(self):
        self.config = load_config()
        self.proc_map = None
        self.proc_api = None
        self.thread_map = None
        self.thread_api = None
        self.win = tk.Tk()
        self.win.title("3D Earth Platform - 启动工具")
        self.win.minsize(880, 620)
        self.win.geometry("1100x780")
        # 启动时最大化窗口（Windows 用 zoomed，其他用 state normal 后再 geometry）
        try:
            if is_windows():
                self.win.state("zoomed")
            else:
                self.win.attributes("-zoomed", True)
        except Exception:
            pass

        # 顶部
        f_top = ttk.Frame(self.win, padding=10)
        f_top.pack(fill=tk.X)
        ttk.Label(f_top, text="3D Earth Platform", font=("", 14, "bold")).pack(anchor=tk.W)
        ttk.Label(f_top, text=f"前端/API: {self.config['api_server']}  瓦片: {self.config['tile_server_public']}", foreground="gray").pack(anchor=tk.W)

        # 按钮
        f_btn = ttk.Frame(self.win, padding=10)
        f_btn.pack(fill=tk.X)
        self.btn_start = ttk.Button(f_btn, text="启动服务", command=self.on_start)
        self.btn_start.pack(side=tk.LEFT, padx=(0, 8))
        self.btn_stop = ttk.Button(f_btn, text="停止服务", command=self.on_stop, state=tk.DISABLED)
        self.btn_stop.pack(side=tk.LEFT, padx=(0, 8))
        self.btn_browser = ttk.Button(f_btn, text="打开浏览器", command=self.on_open_browser)
        self.btn_browser.pack(side=tk.LEFT)

        # 提示：端口被占用时的说明
        ttk.Label(self.win, text="若提示端口被占用，请先点击「停止服务」再启动，或关闭占用 9000/9001 端口的程序。", foreground="gray", font=("", 9)).pack(anchor=tk.W, padx=10)

        # 分割区域：上下两栏同时显示，可拖动分隔线调整高度
        self.paned = ttk.PanedWindow(self.win, orient=tk.VERTICAL)
        self.paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        # 上区：地图服务 (9001)
        f_map = ttk.LabelFrame(self.paned, text="地图服务 (9001)", padding=4)
        self.paned.add(f_map, weight=1)
        self.log_map = scrolledtext.ScrolledText(f_map, height=20, state=tk.DISABLED, wrap=tk.WORD, font=("Consolas", 9))
        self.log_map.pack(fill=tk.BOTH, expand=True)

        # 下区：API 服务 (9000)
        f_api = ttk.LabelFrame(self.paned, text="API 服务 (9000)", padding=4)
        self.paned.add(f_api, weight=1)
        self.log_api = scrolledtext.ScrolledText(f_api, height=20, state=tk.DISABLED, wrap=tk.WORD, font=("Consolas", 9))
        self.log_api.pack(fill=tk.BOTH, expand=True)

        self.win.protocol("WM_DELETE_WINDOW", self.on_close)
        self._update_buttons()
        self._flush_output()

    def _append(self, which, line):
        if which == "map":
            w = self.log_map
        else:
            w = self.log_api
        w.config(state=tk.NORMAL)
        w.insert(tk.END, line if line.endswith("\n") else line + "\n")
        w.see(tk.END)
        w.config(state=tk.DISABLED)

    def _flush_output(self):
        """主线程中消费队列，把各服务输出写到对应文本框"""
        try:
            while True:
                which, line = output_queue.get_nowait()
                if line is None:
                    continue
                self._append(which, line.rstrip("\n"))
        except queue.Empty:
            pass
        self.win.after(100, self._flush_output)

    def _update_buttons(self):
        running = self.proc_map is not None or self.proc_api is not None
        self.btn_start.config(state=tk.NORMAL if not running else tk.DISABLED)
        self.btn_stop.config(state=tk.NORMAL if running else tk.DISABLED)

    def _start_async(self):
        try:
            kwargs = {
                "cwd": str(MAP_DIR),
                "stdout": subprocess.PIPE,
                "stderr": subprocess.STDOUT,
                "text": True,
                "bufsize": 1,
            }
            if is_windows():
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                if flags:
                    kwargs["creationflags"] = flags
            self.proc_map = subprocess.Popen([sys.executable, "server.py"], **kwargs)
            self._append("map", "[已启动] PID %s" % self.proc_map.pid)
            self.thread_map = threading.Thread(target=read_stream, args=(self.proc_map, "map"), daemon=True)
            self.thread_map.start()

            kwargs = {
                "cwd": str(BACKEND_DIR),
                "stdout": subprocess.PIPE,
                "stderr": subprocess.STDOUT,
                "text": True,
                "bufsize": 1,
            }
            if is_windows():
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                if flags:
                    kwargs["creationflags"] = flags
            self.proc_api = subprocess.Popen([sys.executable, "server.py"], **kwargs)
            self._append("api", "[已启动] PID %s" % self.proc_api.pid)
            self.thread_api = threading.Thread(target=read_stream, args=(self.proc_api, "api"), daemon=True)
            self.thread_api.start()

            self.win.after(0, lambda: self._append("api", "就绪。可点击「打开浏览器」访问 %s" % self.config["api_server"]))
        except Exception as e:
            self._append("map", "启动失败: %s" % e)
            self._append("api", "启动失败: %s" % e)
            self._do_stop()
        finally:
            self.win.after(0, self._update_buttons)

    def on_start(self):
        # 启动前检查端口，避免重复启动导致 10048 错误
        if is_port_in_use(9001):
            self._append("map", "[提示] 端口 9001 已被占用，请先点击「停止服务」或关闭占用该端口的程序。")
            messagebox.showwarning("端口被占用", "端口 9001 已被占用，无法启动地图服务。\n请先点击「停止服务」再试，或关闭占用 9001 端口的其他程序。")
            return
        if is_port_in_use(9000):
            self._append("api", "[提示] 端口 9000 已被占用，请先点击「停止服务」或关闭占用该端口的程序。")
            messagebox.showwarning("端口被占用", "端口 9000 已被占用，无法启动 API 服务。\n请先点击「停止服务」再试，或关闭占用 9000 端口的其他程序。")
            return
        self.btn_start.config(state=tk.DISABLED)
        self._append("map", "正在启动地图服务 (端口 9001)...")
        self._append("api", "正在启动 API 服务 (端口 9000)...")
        threading.Thread(target=self._start_async, daemon=True).start()

    def _do_stop(self):
        if self.proc_map:
            try:
                self.proc_map.terminate()
                if self.proc_map.stdout:
                    self.proc_map.stdout.close()
                self.proc_map.wait(timeout=3)
            except Exception:
                try:
                    self.proc_map.kill()
                except Exception:
                    pass
            self.proc_map = None
            self._append("map", "[已停止] 地图服务")
        if self.proc_api:
            try:
                self.proc_api.terminate()
                if self.proc_api.stdout:
                    self.proc_api.stdout.close()
                self.proc_api.wait(timeout=3)
            except Exception:
                try:
                    self.proc_api.kill()
                except Exception:
                    pass
            self.proc_api = None
            self._append("api", "[已停止] API 服务")

    def on_stop(self):
        self._append("map", "正在停止...")
        self._append("api", "正在停止...")
        self._do_stop()
        self._update_buttons()

    def on_open_browser(self):
        url = self.config["api_server"]
        try:
            webbrowser.open(url)
            self._append("api", "已打开浏览器: %s" % url)
        except Exception as e:
            messagebox.showerror("打开浏览器失败", str(e))

    def on_close(self):
        if self.proc_map or self.proc_api:
            if messagebox.askokcancel("退出", "服务正在运行，是否停止并退出？"):
                self._do_stop()
        self.win.destroy()

    def run(self):
        self._append("map", "启动工具已就绪。点击「启动服务」开始。")
        self._append("api", "启动工具已就绪。")
        self.win.mainloop()


def main():
    if not MAP_DIR.is_dir() or not (MAP_DIR / "server.py").exists():
        print("错误: 未找到 map/server.py，请在项目根目录运行 launcher.py")
        sys.exit(1)
    if not BACKEND_DIR.is_dir() or not (BACKEND_DIR / "server.py").exists():
        print("错误: 未找到 backend/server.py，请在项目根目录运行 launcher.py")
        sys.exit(1)
    app = LauncherApp()
    app.run()


if __name__ == "__main__":
    main()
