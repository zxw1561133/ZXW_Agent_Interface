#!/usr/bin/env python3
"""
地图瓦片服务器
提供本地瓦片文件的 HTTP 访问
瓦片目录从项目根目录 config.json 的 tiles_dir 读取，与前端、后端共用配置
"""
import http.server
import socketserver
import os
import sys
import json
from pathlib import Path
from urllib.parse import urlparse

# 配置
ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / 'config.json'

def _load_port():
    """从 config.json 的 tile_service_url 或 tile_server_public 解析端口，与 config 一致才能加载地图"""
    default = 9001
    if not CONFIG_PATH.exists():
        return default
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        url_str = d.get('tile_service_url') or d.get('tile_server_public') or ''
        if not url_str:
            return default
        parsed = urlparse(url_str.strip())
        if parsed.port is not None:
            return parsed.port
        if parsed.scheme == 'https':
            return 443
        return default
    except Exception:
        return default

PORT = _load_port()

def _load_tiles_dir():
    default = r'F:\jk\天津滨海\cursor\map_test\tiles'
    if not CONFIG_PATH.exists():
        return default
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return d.get('tiles_dir', default) or default
    except Exception as e:
        print(f"[警告] 读取 config.json 失败: {e}，使用默认瓦片路径")
        return default

TILES_DIR = _load_tiles_dir()

def _load_tile_url():
    """从 config.json 读取瓦片对外地址，用于启动时打印"""
    if not CONFIG_PATH.exists():
        return f"http://127.0.0.1:{PORT}"
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        raw = (d.get('tile_server_public') or d.get('tile_service_url') or '').strip()
        return raw.rstrip('/') if raw else f"http://127.0.0.1:{PORT}"
    except Exception:
        return f"http://127.0.0.1:{PORT}"

class TileHandler(http.server.SimpleHTTPRequestHandler):
    """处理瓦片请求，支持跨域（CORS）供任意端口/域名页面使用"""
    
    def __init__(self, *args, **kwargs):
        # directory 必须为 str，兼容 Python 3.8 在 Linux 下 translate_path（Windows/Linux 通用）
        super().__init__(*args, directory=str(TILES_DIR), **kwargs)
    
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')
    
    def do_OPTIONS(self):
        """预检请求：让浏览器允许跨域 GET/HEAD"""
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()
    
    def end_headers(self):
        self._send_cors_headers()
        super().end_headers()
    
    def log_message(self, format, *args):
        # 简化日志
        print(f"[{self.log_date_time_string()}] {args[0]}")

def serve_tiles():
    """启动瓦片服务器"""
    
    # 检查瓦片目录
    if not os.path.exists(TILES_DIR):
        print(f"[错误] 瓦片目录不存在: {TILES_DIR}")
        print("请修改 TILES_DIR 变量指向正确的路径")
        sys.exit(1)
    
    print(f"[OK] 瓦片目录: {TILES_DIR}")
    
    # 显示目录结构
    print("[诊断] 目录内容:")
    for item in os.listdir(TILES_DIR)[:10]:
        item_path = os.path.join(TILES_DIR, item)
        if os.path.isdir(item_path):
            sub_items = os.listdir(item_path)[:5]
            print(f"  {item}/  ({len(os.listdir(item_path))} 项)")
    
    # 统计瓦片数量
    tile_count = 0
    for root, dirs, files in os.walk(TILES_DIR):
        tile_count += len([f for f in files if f.endswith(('.jpg', '.png'))])
    
    print(f"[信息] 瓦片数量: 约 {tile_count} 张")
    
    if tile_count == 0:
        print("[警告] 未找到任何瓦片文件！")
        print(f"[提示] 请确认 {TILES_DIR} 目录下有 .jpg 或 .png 文件")
        print("[提示] 瓦片目录结构应该是: z/x/y.jpg")
        print("[提示] 例如: 1/0/0.jpg, 2/1/1.jpg")
    
    tile_url = _load_tile_url()
    with socketserver.TCPServer(("", PORT), TileHandler) as httpd:
        print(f"[OK] 瓦片服务器启动成功")
        print(f"访问地址: {tile_url} (来自 config.json)")
        print(f"示例: {tile_url}/1/0/0.jpg")
        print()
        print("按 Ctrl+C 停止服务器")
        print("-" * 50)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")
            sys.exit(0)

if __name__ == '__main__':
    serve_tiles()
