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
import threading
import time
import queue
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# SSE：网格保存后推送一次，前端据此刷新，无需轮询
_grid_sse_queues = []
_grid_sse_lock = threading.Lock()

def _notify_grid_saved(payload):
    """POST 保存成功后调用，向所有已连接的前端推送一次刷新事件。payload 为 dict，含 changedKeys/task3GridOnly/task3PreferenceOnly。"""
    with _grid_sse_lock:
        queues = list(_grid_sse_queues)
    msg = json.dumps(payload, ensure_ascii=False)
    for q in queues:
        try:
            q.put_nowait(msg)
        except queue.Full:
            pass

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

# 用于前端区分 task3 是「仅网格保存」还是「仅偏好保存」
last_task3_grid_save_at = 0.0
last_preference_save_at = 0.0

# 任务区域确认流程：Agent POST 保存后 HTTP 连接阻塞等待，前端与本地后端交互确认/修改，用户确认后由 confirm 接口向等待中的 POST 连接返回数据
_task_area_pending_lock = threading.Lock()
_task_area_pending_handlers = []  # [(handler, event), ...]，confirm 时向这些 handler 发送 task_area 并 event.set()

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
        elif path == '/api/grid/preference':
            self.handle_grid_preference()
        elif path == '/api/grid/group-members':
            self.handle_grid_group_members()
        elif path == '/api/grid/last-update':
            self.handle_grid_last_update()
        elif path == '/api/grid/events':
            self.handle_grid_events_sse()
        elif path == '/api/grid/channel':
            self.handle_grid_channel()
        elif path == '/api/grid/task-area':
            self.handle_grid_task_area()
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
        """处理 POST 请求 - 网格保存 / 偏好保存（独立接口）"""
        parsed = urlparse(self.path)
        path = (parsed.path or '/').strip()

        # 偏好保存接口：仅写 task3 文件中的 preferences，保留原有 task3Grid
        if path == '/api/grid/preference/save':
            self._handle_preference_save()
            return
        # 通道保存接口：Agent 写入 channel.json，前端收到 SSE 后显示立方体
        if path == '/api/grid/channel/save':
            self._handle_channel_save()
            return
        # 任务区域保存接口：Agent 写入 task_area.json，前端收到 SSE 后显示各任务区域矩形
        if path == '/api/grid/task-area/save':
            self._handle_task_area_save()
            return
        # 前端地图编辑保存：仅写文件并推送 SSE，不阻塞（避免与 Agent 阻塞式 save 共用同一接口导致前端 await 卡死）
        if path == '/api/grid/task-area/save-ui':
            self._handle_task_area_save_ui()
            return
        if path == '/api/grid/task-area/confirm':
            self._handle_task_area_confirm()
            return
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
            global last_task3_grid_save_at
            if task_type == 'task3':
                last_task3_grid_save_at = time.time()
            self.send_json({
                'status': 'success',
                'message': f'网格数据已保存到 {filepath}',
                'task': task_type,
                'dataCount': self._count_grid_cells(grid_data)
            })
            print(f"[保存] 网格数据已保存: {task_type} - 成功")
            # 推送一次 SSE，前端据此刷新，无需轮询
            _notify_grid_saved({
                'changedKeys': [task_type],
                'task3GridOnly': (task_type == 'task3'),
                'task3PreferenceOnly': False
            })
        except json.JSONDecodeError as e:
            self.send_json({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self.send_json({'error': f'服务器错误: {str(e)}'}, 500)

    def _handle_preference_save(self):
        """保存网格偏好到 Test_grid_task3.json：保留 task3Grid，仅更新 preferences（格式与现有文件一致）"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))
            preferences = request_data.get('preferences')
            if preferences is None:
                preferences = request_data.get('data')
            if preferences is None:
                self.send_json({'error': '缺少 preferences 或 data 字段'}, 400)
                return
            if not isinstance(preferences, list):
                self.send_json({'error': 'preferences 必须为数组（格式参考 Test_grid_task3.json）'}, 400)
                return
            filepath = GRID_DIR / 'Test_grid_task3.json'
            task3_grid = []
            if filepath.exists():
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                    task3_grid = existing.get('task3Grid', [])
                except Exception:
                    pass
            out = {'task3Grid': task3_grid, 'preferences': preferences}
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(out, f, ensure_ascii=False, indent=2)
            global last_preference_save_at
            last_preference_save_at = time.time()
            self.send_json({
                'status': 'success',
                'message': f'偏好已保存到 {filepath}（task3Grid 已保留，preferences 已更新）',
                'preferenceGroupCount': len(preferences),
            })
            print(f"[保存] 网格偏好已保存到 task3 文件 - 成功")
            _notify_grid_saved({
                'changedKeys': [],
                'task3GridOnly': False,
                'task3PreferenceOnly': True
            })
        except json.JSONDecodeError as e:
            self.send_json({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self.send_json({'error': f'服务器错误: {str(e)}'}, 500)
    
    def _count_grid_cells(self, grid_data):
        """统计网格数据中的单元格数量"""
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
        """获取网格列表。initGrid 仅作为获取键，数据从 task1 文件读；无单独初始化网格文件。"""
        self.send_json(['initGrid', 'task1', 'task2', 'task3', 'group'])
    
    def handle_grid_data(self, params):
        """获取网格数据。task=initGrid 时仍从 Test_grid_task1.json 读取并只返回 initGrid 键；无单独初始化网格文件。"""
        task = params.get('task', ['task1'])[0]
        file_map = {
            'task1': 'Test_grid_task1.json',
            'task2': 'Test_grid_task2.json',
            'task3': 'Test_grid_task3.json',
            'group': 'Test_group.json'
        }
        if task == 'initGrid':
            filepath = GRID_DIR / file_map['task1']
            try:
                if filepath.exists():
                    with open(filepath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    self.send_json({'initGrid': data.get('initGrid', [])})
                else:
                    self.send_json(self.generate_mock_data('initGrid'))
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
            return
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

    def handle_grid_preference(self):
        """偏好网格独立接口：从 Test_grid_task3.json 读取并返回 task3Grid + preferences，不增加新文件。"""
        filepath = GRID_DIR / 'Test_grid_task3.json'
        try:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.send_json({
                    'task3Grid': data.get('task3Grid', []),
                    'preferences': data.get('preferences', [])
                })
            else:
                self.send_json({'task3Grid': [], 'preferences': []})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def handle_grid_group_members(self):
        """分组信息（members）独立接口：从 Test_group.json 读取并返回 groups，不增加新文件。"""
        filepath = GRID_DIR / 'Test_group.json'
        try:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.send_json({'groups': data.get('groups', [])})
            else:
                self.send_json({'groups': []})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def handle_grid_channel(self):
        """通道数据：从 channel.json 读取并返回完整内容，供前端绘制立方体。"""
        filepath = GRID_DIR / 'channel.json'
        try:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.send_json(data)
            else:
                self.send_json({'channel': {'cubeList': []}})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def _handle_channel_save(self):
        """保存通道数据到 channel.json。Body: { "channel": { "cubeList": [ { center_jd, center_wd, center_gc, length, width, height }, ... ] } }。"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))
            channel = request_data.get('channel')
            if channel is None:
                self.send_json({'error': '缺少 channel 字段'}, 400)
                return
            if not isinstance(channel, dict):
                self.send_json({'error': 'channel 必须为对象'}, 400)
                return
            cube_list = channel.get('cubeList', [])
            if not isinstance(cube_list, list):
                self.send_json({'error': 'channel.cubeList 必须为数组'}, 400)
                return
            filepath = GRID_DIR / 'channel.json'
            GRID_DIR.mkdir(parents=True, exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump({'channel': channel}, f, ensure_ascii=False, indent=2)
            self.send_json({
                'status': 'success',
                'message': f'通道数据已保存到 {filepath}',
                'cubeCount': len(cube_list)
            })
            print(f"[保存] 通道数据已保存: {len(cube_list)} 个立方体")
            _notify_grid_saved({
                'changedKeys': ['channel'],
                'task3GridOnly': False,
                'task3PreferenceOnly': False
            })
        except json.JSONDecodeError as e:
            self.send_json({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self.send_json({'error': f'服务器错误: {str(e)}'}, 500)

    def handle_grid_task_area(self):
        """任务区域数据：从 task_area.json 读取并返回完整内容，供前端绘制各任务区域矩形。"""
        filepath = GRID_DIR / 'task_area.json'
        try:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.send_json(data)
            else:
                self.send_json({'task_area': {}})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def _handle_task_area_save(self):
        """保存任务区域数据到 task_area.json。HTTP 连接阻塞等待，直到前端用户确认后由 confirm 接口向本连接返回 task_area 数据。"""
        global _task_area_pending_handlers
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))
            task_area = request_data.get('task_area')
            if task_area is None:
                self.send_json({'error': '缺少 task_area 字段'}, 400)
                return
            if not isinstance(task_area, dict):
                self.send_json({'error': 'task_area 必须为对象'}, 400)
                return
            filepath = GRID_DIR / 'task_area.json'
            GRID_DIR.mkdir(parents=True, exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump({'task_area': task_area}, f, ensure_ascii=False, indent=2)
            print(f"[保存] 任务区域已保存: {len(task_area)} 个区域，等待用户确认（HTTP 阻塞）")
            _notify_grid_saved({
                'changedKeys': ['task_area'],
                'task3GridOnly': False,
                'task3PreferenceOnly': False
            })
            ev = threading.Event()
            with _task_area_pending_lock:
                _task_area_pending_handlers.append((self, ev))
            if not ev.wait(timeout=600):
                self.send_json({'error': 'confirmed_timeout', 'message': '等待用户确认超时（10分钟）'}, 408)
            with _task_area_pending_lock:
                _task_area_pending_handlers[:] = [(h, e) for h, e in _task_area_pending_handlers if h is not self]
        except json.JSONDecodeError as e:
            self.send_json({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self.send_json({'error': f'服务器错误: {str(e)}'}, 500)

    def _handle_task_area_save_ui(self):
        """前端在地图上修改任务区域后保存：写 task_area.json 并推送 SSE，立即返回，不参与 Agent 阻塞等待。"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            request_data = json.loads(post_data.decode('utf-8'))
            task_area = request_data.get('task_area')
            if task_area is None:
                self.send_json({'error': '缺少 task_area 字段'}, 400)
                return
            if not isinstance(task_area, dict):
                self.send_json({'error': 'task_area 必须为对象'}, 400)
                return
            filepath = GRID_DIR / 'task_area.json'
            GRID_DIR.mkdir(parents=True, exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump({'task_area': task_area}, f, ensure_ascii=False, indent=2)
            print(f"[保存] 任务区域已保存（前端 save-ui）: {len(task_area)} 个区域，不阻塞")
            _notify_grid_saved({
                'changedKeys': ['task_area'],
                'task3GridOnly': False,
                'task3PreferenceOnly': False
            })
            self.send_json({
                'status': 'success',
                'message': '任务区域已保存',
                'areaCount': len(task_area)
            })
        except json.JSONDecodeError as e:
            self.send_json({'error': f'JSON解析错误: {str(e)}'}, 400)
        except Exception as e:
            self.send_json({'error': f'服务器错误: {str(e)}'}, 500)

    def _handle_task_area_confirm(self):
        """用户在前端确认接收或已修改完毕时由前端调用。向所有等待中的 POST /task-area/save 连接返回当前 task_area 数据，解除阻塞。"""
        global _task_area_pending_handlers
        filepath = GRID_DIR / 'task_area.json'
        try:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            else:
                data = {'task_area': {}}
        except Exception:
            data = {'task_area': {}}
        with _task_area_pending_lock:
            pending = list(_task_area_pending_handlers)
            _task_area_pending_handlers.clear()
        for handler, ev in pending:
            try:
                handler.send_json(data)
            except Exception as ex:
                print(f"[确认] 向等待中的 Agent 返回数据时出错: {ex}")
            try:
                ev.set()
            except Exception:
                pass
        print(f'[确认] 任务区域已确认，已向 {len(pending)} 个等待连接返回数据')
        self.send_json({'status': 'success', 'message': '已确认，等待中的 Agent 已收到任务区域数据。'})

    def handle_grid_events_sse(self):
        """SSE 流：前端订阅后，仅在 POST 保存时推送一次刷新事件，其他时间不推送。"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            self.wfile.flush()
        except OSError:
            return
        q = queue.Queue()
        with _grid_sse_lock:
            _grid_sse_queues.append(q)
        try:
            while True:
                try:
                    msg = q.get(timeout=25)
                except queue.Empty:
                    msg = None
                try:
                    if msg is not None:
                        self.wfile.write(('data: %s\n\n' % msg).encode('utf-8'))
                    else:
                        self.wfile.write(b': keepalive\n\n')
                    self.wfile.flush()
                except (OSError, BrokenPipeError):
                    break
                if msg is None:
                    continue
                # 收到一次推送后继续等待下一次（连接不关闭）
        except (OSError, BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with _grid_sse_lock:
                if q in _grid_sse_queues:
                    _grid_sse_queues.remove(q)

    def handle_grid_last_update(self):
        """返回各网格文件的最后修改时间及 task3 的网格/偏好分别由谁更新，供前端区分只刷新网格或只刷新偏好。"""
        file_map = {
            'task1': 'Test_grid_task1.json',
            'task2': 'Test_grid_task2.json',
            'task3': 'Test_grid_task3.json',
            'group': 'Test_group.json'
        }
        out = {}
        for key, filename in file_map.items():
            filepath = GRID_DIR / filename
            try:
                out[key] = filepath.stat().st_mtime if filepath.exists() else 0
            except OSError:
                out[key] = 0
        out['task3_grid_save_at'] = last_task3_grid_save_at
        out['task3_preference_save_at'] = last_preference_save_at
        self.send_json(out)
    
    def generate_mock_data(self, task):
        """生成模拟网格数据（仅 task1/task2/task3/group）"""
        # 不同任务在不同区域
        regions = {
            'task1': [(39.0, 117.0)],   # 天津附近
            'initGrid': [(39.0, 117.0)],  # 与 task1 同源
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
        
        # task1 文件含 initGrid 与 task1Grid；task2/3 为 task2Grid/task3Grid；group 为 groups；initGrid 单独键仍用 task1 区域数据
        if task == 'task1':
            return {'initGrid': grids, 'task1Grid': grids}
        if task == 'initGrid':
            return {'initGrid': grids}
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
    
    class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True
    with ThreadedTCPServer(("", PORT), APIHandler) as httpd:
        print(f"[OK] API 服务器启动成功")
        api_url = _CONFIG.get('api_server', 'http://127.0.0.1:9000').rstrip('/')
        print(f"API 地址: {api_url} (来自 config.json)")
        index_html = FRONTEND_DIR / 'index.html'
        print(f"前端目录: {FRONTEND_DIR}")
        print(f"index.html: {'存在' if index_html.exists() else '不存在 -> 根路径会 404'}")
        print(f"网格目录: {GRID_DIR}")
        print()
        print("API 端点（详见 docs/API.md）:")
        print("  [系统]")
        print(f"    GET  {api_url}/api/health           健康检查")
        print(f"    GET  {api_url}/config.json         配置文件（瓦片/API 地址）")
        print(f"    GET  {api_url}/api/config          配置（同上，备用）")
        print(f"    GET  {api_url}/api/tile-proxy-test 瓦片代理测试")
        print("  [网格]")
        print(f"    GET  {api_url}/api/grid/list        任务类型列表 → ['initGrid','task1','task2','task3','group']")
        print(f"    GET  {api_url}/api/grid/data?task= initGrid|task1|task2|task3|group，按 task 读对应 JSON")
        print(f"    GET  {api_url}/api/grid/preference 偏好网格 → Test_grid_task3.json（task3Grid+preferences）")
        print(f"    GET  {api_url}/api/grid/group-members 分组 members → Test_group.json（groups）")
        print(f"    GET  {api_url}/api/grid/last-update 各网格文件最后修改时间（可选，兼容旧前端）")
        print(f"    GET  {api_url}/api/grid/events       SSE 订阅，POST 保存后推送一次，前端据此刷新")
        print(f"    POST {api_url}/api/grid/save            Body: {{ task, data }}，保存到对应 JSON（Agent 等）")
        print(f"    POST {api_url}/api/grid/preference/save  Body: {{ preferences }}，仅更新 task3 的偏好（Agent 等）")
        print(f"    GET  {api_url}/api/grid/channel         通道立方体数据（channel.json）")
        print(f"    POST {api_url}/api/grid/channel/save    Body: {{ channel: {{ cubeList }} }}，保存通道（Agent 等）")
        print(f"    GET  {api_url}/api/grid/task-area      任务区域数据（task_area.json）")
        print(f"    POST {api_url}/api/grid/task-area/save     Body: {{ task_area }}，Agent 调用；HTTP 阻塞直到用户确认后返回数据")
        print(f"    POST {api_url}/api/grid/task-area/save-ui  Body: {{ task_area }}，前端地图修改保存；立即返回，不阻塞")
        print(f"    POST {api_url}/api/grid/task-area/confirm  前端用户确认后调用，向等待中的 Agent 返回数据")
        print("  [瓦片]")
        print(f"    GET  {api_url}/tiles/{{z}}/{{x}}/{{y}}.jpg  代理到瓦片服务（同源）")
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
