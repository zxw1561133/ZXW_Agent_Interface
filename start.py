import subprocess
import time
import os
import json
import webbrowser

print("="*50)
print("  3D Earth Platform - 启动器")
print("="*50)
print()

base_dir = os.path.dirname(os.path.abspath(__file__))
config_path = os.path.join(base_dir, "config.json")

def _load_urls():
    api_url = "http://127.0.0.1:9000"
    tile_url = "http://127.0.0.1:9001"
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                c = json.load(f)
            api_url = c.get("api_server") or api_url
            tile_url = c.get("tile_server_public") or c.get("tile_service_url") or tile_url
        except Exception:
            pass
    return api_url.rstrip("/"), tile_url.rstrip("/")

API_URL, TILE_URL = _load_urls()

# 1. 启动瓦片服务器
print("[1/2] 启动瓦片服务器 (端口 9001)...")
map_dir = os.path.join(base_dir, "map")
tile_server = subprocess.Popen(
    ["python", "server.py"],
    cwd=map_dir,
    creationflags=subprocess.CREATE_NEW_CONSOLE
)

time.sleep(2)

# 2. 启动前端服务器
print("[2/2] 启动前端服务器 (端口 9000)...")
frontend_dir = os.path.join(base_dir, "frontend")
frontend_server = subprocess.Popen(
    ["python", "-m", "http.server", "9000"],
    cwd=frontend_dir,
    creationflags=subprocess.CREATE_NEW_CONSOLE
)

time.sleep(2)

print()
print("="*50)
print("  服务已启动 (地址来自 config.json):")
print("    - 瓦片服务:", TILE_URL)
print("    - 前端页面:", API_URL)
print("="*50)
print()

# 打开浏览器
print("正在打开浏览器...")
webbrowser.open(API_URL)

print()
input("按 Enter 键停止所有服务...")

# 停止服务
print("正在停止服务...")
tile_server.terminate()
frontend_server.terminate()

print("服务已停止")
input("按 Enter 键退出...")
