#!/usr/bin/env python3
"""
后端 API 服务器
提供网格数据和系统状态接口；并代理瓦片请求，避免跨域导致 Cesium 无法贴图
"""
import http.server
import socketserver
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# 配置（优先从 config.json 读取，与 map 服务、前端共用）
PORT = 9000
ROOT_DIR = Path(__file__).resolve().parent.parent
# 若按 __file__ 解析的 frontend 下没有 index.html，尝试用当前工作目录的上级（兼容 Linux 下不同启动方式）
FRONTEND_DIR = ROOT_DIR / 'frontend'
if not (FRONTEND_DIR / 'index.html').exists():
    _cwd_parent = Path(os.getcwd()).resolve().parent
    if (_cwd_parent / 'frontend' / 'index.html').exists():
        FRONTEND_DIR = _cwd_parent / 'frontend'
GRID_DIR = ROOT_DIR / 'grid'
CONFIG_PATH = ROOT_DIR / 'config.json'

def _load_config():
    d = {'tile_service_url': 'http://127.0.0.1:9001', 'tiles_dir': '', 'tile_server_public': 'http://127.0.0.1:9001', 'api_server': 'http://127.0.0.1:9000'}
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                d.update(json.load(f))
        except Exception as e:
            print(f"[警告] 读取 config.json 失败: {e}，使用默认配置")
    return d

_CONFIG = _load_config()
TILE_SERVER_URL = _CONFIG.get('tile_service_url', 'http://127.0.0.1:9001')

class APIHandler(http.server.SimpleHTTPRequestHandler):
    """处理 API 请求"""
    
    def __init__(self, *args, **kwargs):
        # directory 必须为 str，否则 Python 3.8 在 Linux 下 translate_path 会报 PosixPath += str 的 TypeError
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def translate_path(self, path):
        # Linux 下 os.path.join(directory, "/") 会得到 "/"，导致根路径请求到根目录找文件而 404；Windows 无此问题。统一把 URL 路径转为相对路径再拼接。
        path = path.split('?', 1)[0].split('#', 1)[0]
        path = unquote(path)
        path = os.path.normpath(path)
        path = path.lstrip(os.sep).replace('/', os.sep).lstrip(os.sep) or 'index.html'
        base = os.path.abspath(self.directory)
        full = os.path.normpath(os.path.join(base, path))
        if not full.startswith(base):
            full = os.path.join(base, 'index.html')
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        return full

    def serve_index(self):
        """显式返回 frontend/index.html，保证 Windows/Linux 下根路径都能打开"""
        index_path = os.path.join(str(FRONTEND_DIR), 'index.html')
        if not os.path.isfile(index_path):
            self.send_error(404, 'File not found')
            return
        try:
            with open(index_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except OSError as e:
            self.send_error(404, str(e))

    def serve_index_head(self):
        """HEAD 请求时只返回 index.html 的头部"""
        index_path = os.path.join(str(FRONTEND_DIR), 'index.html')
        if not os.path.isfile(index_path):
            self.send_error(404, 'File not found')
            return
        try:
            length = os.path.getsize(index_path)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(length))
            self.end_headers()
        except OSError as e:
            self.send_error(404, str(e))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_GET(self):
        """处理 GET 请求"""
        parsed = urlparse(self.path)
        path = (parsed.path or '/').strip()
        # 根路径优先显式返回 index.html（避免 Linux translate_path 导致 404）
        if path == '/' or path == '' or path.rstrip('/').lower() in ('/index.html', 'index.html'):
            self.serve_index()
            return
        # API 路由
        if path == '/api/health':
            self.handle_health()
        elif path == '/config.json':
            self.handle_config_file()
        elif path == '/api/config':
            self.handle_config()
        elif path == '/api/tile-proxy-test':
            self.send_json({'ok': True, 'tileProxy': True})
        elif path == '/api/grid/list':
            self.handle_grid_list()
        elif path == '/api/grid/data':
            self.handle_grid_data(parse_qs(parsed.query))
        elif path.rstrip('/').lower() == '/tiles':
            self.handle_tile_root()
        elif path.lower().startswith('/tiles/'):
            self.handle_tile_proxy(path)
        else:
            # 静态文件
            super().do_GET()

    def do_HEAD(self):
        """处理 HEAD 请求（与 GET 同路由，瓦片代理需转发 HEAD 以正确返回 404）"""
        parsed = urlparse(self.path)
        path = parsed.path
        if path.rstrip('/').lower() == '/tiles':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
        elif path.lower().startswith('/tiles/'):
            self.handle_tile_proxy(path, method='HEAD')
        else:
            path = (parsed.path or '/').strip()
            if path == '/' or path == '' or path.rstrip('/').lower() in ('/index.html', 'index.html'):
                self.serve_index_head()
                return
            super().do_HEAD()

    def do_OPTIONS(self):
        """CORS 预检"""
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        """处理 POST 请求 - 接收 Agent 发送的网格数据并保存（与 DA_Interface_wyj 一致）"""
        parsed = urlparse(self.path)
        path = (parsed.path or '/').strip()
        if path != '/api/grid/save':
            self.send_json({'error': 'Not Found'}, 404)
            return
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))
            task_type = request_data.get('task', 'task1')
            grid_data = request_data.get('data')
            if grid_data is None:
                self.send_json({'error': '缺少data字段'}, 400)
                return
            file_map = {
                'task1': 'Test_grid_task1.json',
                'task2': 'Test_grid_task2.json',
                'task3': 'Test_grid_task3.json',
                'group': 'Test_group.json'
            }
            filename = file_map.get(task_type)
            if not filename:
                self.send_json({'error': f'未知任务类型: {task_type}'}, 400)
                return
            filepath = GRID_DIR / filename
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(grid_data, f, ensure_ascii=False, indent=2)
            self.send_json({
                'status': 'success',
                'message': f'网格数据已保存到 {filepath}',
                'task': task_type,
                'dataCount': self._count_grid_cells(grid_data)
            })
            print(f"[保存] 网格数据已保存: {task_type} - 成功")
        except json.JSONDecodeError as e:
            self.send_json({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self.send_json({'error': f'服务器错误: {str(e)}'}, 500)
    
    def _count_grid_cells(self, grid_data):
        """统计网格数据中的单元格数量（与 DA_Interface_wyj 一致）"""
        count = 0
        if isinstance(grid_data, dict):
            for key, value in grid_data.items():
                if isinstance(value, list):
                    count += len(value)
                elif isinstance(value, dict):
                    count += self._count_grid_cells(value)
        return count
    
    def handle_health(self):
        """健康检查"""
        self.send_json({
            'status': 'ok',
            'message': 'Service is running',
            'version': '1.0.0'
        })

    def handle_config_file(self):
        """直接返回 config.json 内容（每次从磁盘读取，过滤掉 _ 开头的注释键），供前端瓦片源等从配置文件读取"""
        if not CONFIG_PATH.exists():
            self.send_json({}, status=404)
            return
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            out = {k: v for k, v in data.items() if not (isinstance(k, str) and k.startswith('_'))}
            self.send_json(out)
        except Exception as e:
            self.send_json({'error': str(e)}, status=500)

    def handle_config(self):
        """返回地图/瓦片相关配置，供前端统一从配置读取路径"""
        self.send_json({
            'tileServer': _CONFIG.get('tile_server_public', 'http://127.0.0.1:9001'),
            'localTilesPath': _CONFIG.get('tiles_dir', ''),
            'apiServer': _CONFIG.get('api_server', 'http://127.0.0.1:9000')
        })
    
    def handle_grid_list(self):
        """获取网格列表。与 DA_Interface 一致：仅返回 task1/task2/task3/group，initGrid 由前端从 task1 的 initGrid 键解析。"""
        self.send_json(['task1', 'task2', 'task3', 'group'])
    
    def handle_grid_data(self, params):
        """获取网格数据。与 DA_Interface 一致：仅支持 task1/task2/task3/group，返回对应文件原始 JSON。"""
        task = params.get('task', ['task1'])[0]
        
        # 与 DA_Interface 一致：只读 4 个文件，仅 task1/task2/task3/group
        file_map = {
            'task1': 'Test_grid_task1.json',
            'task2': 'Test_grid_task2.json',
            'task3': 'Test_grid_task3.json',
            'group': 'Test_group.json'
        }
        
        filename = file_map.get(task)
        if not filename:
            self.send_json({'error': f'未知任务类型: {task}'}, 400)
            return
        filepath = GRID_DIR / filename
        
        try:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.send_json(data)
            else:
                self.send_json(self.generate_mock_data(task))
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def generate_mock_data(self, task):
        """生成模拟网格数据（仅 task1/task2/task3/group）"""
        # 不同任务在不同区域
        regions = {
            'task1': [(39.0, 117.0)],   # 天津附近
            'task2': [(39.1, 117.1), (39.2, 117.2)],
            'task3': [(39.3, 117.3), (39.4, 117.4)],
            'group': [(39.2, 117.3)]
        }
        
        task_regions = regions.get(task, [(39.0, 117.0)])
        grids = []
        
        grid_index = 1
        for base_lat, base_lon in task_regions:
            for i in range(5):
                for j in range(5):
                    grids.append({
                        'gridIndex': grid_index,
                        'latitude': base_lat + i * 0.05,
                        'longitude': base_lon + j * 0.05,
                        'length': 3,
                        'width': 3
                    })
                    grid_index += 1
        
        # 与 DA_Interface 一致：task1 文件含 initGrid 与 task1Grid；task2/3 为 task2Grid/task3Grid；group 为 groups
        if task == 'task1':
            return {'initGrid': grids, 'task1Grid': grids}
        if task == 'task2':
            return {'task2Grid': grids}
        if task == 'task3':
            return {'task3Grid': grids}
        if task == 'group':
            return {'groups': []}
        return {task: grids}
    
    def handle_tile_root(self):
        """访问 /tiles 或 /tiles/ 时返回说明，避免 404"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        msg = (
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>瓦片代理</title></head><body>'
            '<h1>瓦片同源代理</h1>'
            '<p>瓦片地址格式: <code>/tiles/{z}/{x}/{y}.jpg</code></p>'
            '<p>请用 <b>start_project.bat</b> 启动并保留 MapService(9001) 与 APIService(9000) 两个窗口。</p>'
            '<p><a href="/">返回 3D Earth Platform</a></p>'
            '</body></html>'
        )
        self.wfile.write(msg.encode('utf-8'))

    def handle_tile_proxy(self, path, method='GET'):
        """代理瓦片请求到 9001，使前端与瓦片同源，避免 CORS 导致 Cesium 贴图失败"""
        # 兼容 /tiles/ 与 /Tiles/ 等大小写
        i = path.lower().index('tiles') + 5
        subpath = path[i:].lstrip('/')
        tile_url = f'{TILE_SERVER_URL}/{subpath}'
        try:
            req = Request(tile_url, method=method)
            with urlopen(req, timeout=10) as resp:
                self.send_response(resp.status)
                ct = resp.headers.get('Content-Type', 'image/jpeg')
                self.send_header('Content-Type', ct)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                if method == 'GET':
                    self.wfile.write(resp.read())
        except HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
        except (URLError, OSError) as e:
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            if method == 'GET':
                self.wfile.write(f'Tile proxy error: {e}'.encode())
    
    def send_json(self, data, status=200):
        """发送 JSON 响应"""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())
    
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

def serve_api():
    """启动 API 服务器"""
    
    # 确保 grid 目录存在
    GRID_DIR.mkdir(exist_ok=True)
    
    with socketserver.TCPServer(("", PORT), APIHandler) as httpd:
        print(f"[OK] API 服务器启动成功")
        api_url = _CONFIG.get('api_server', 'http://127.0.0.1:9000').rstrip('/')
        print(f"API 地址: {api_url} (来自 config.json)")
        index_html = FRONTEND_DIR / 'index.html'
        print(f"前端目录: {FRONTEND_DIR}")
        print(f"index.html: {'存在' if index_html.exists() else '不存在 -> 根路径会 404'}")
        print(f"网格目录: {GRID_DIR}")
        print()
        print("API 端点:")
        print(f"  GET  {api_url}/api/health")
        print(f"  GET  {api_url}/api/grid/list")
        print(f"  GET  {api_url}/api/grid/data?task=task1")
        print(f"  POST {api_url}/api/grid/save - 保存网格数据（Agent 调用）")
        print()
        print("按 Ctrl+C 停止服务器")
        print("-" * 50)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")
            sys.exit(0)

if __name__ == '__main__':
    serve_api()
