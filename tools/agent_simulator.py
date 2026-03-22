#!/usr/bin/env python3
"""
Agent 调用模拟程序：选择要调用的接口，发送网格/偏好数据到后端，用于验证界面绘制是否正常。
- 网格保存：在现有数据基础上对经纬度施加偏移后保存，便于观察地图上位置是否变化。
- 偏好保存：可原样重写或使用示例偏好。
"""
import json
import sys
from pathlib import Path

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError
except ImportError:
    print('需要 Python 3')
    sys.exit(1)

# 项目根目录
ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / 'config.json'


def load_config():
    api = 'http://127.0.0.1:9000'
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                c = json.load(f)
            api = (c.get('api_server') or api).rstrip('/')
        except Exception:
            pass
    return api


def http_get(base_url, path):
    url = f'{base_url}{path}'
    req = Request(url, method='GET')
    with urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))


def http_get_status_and_json(base_url, path):
    """GET 请求并返回 (status_code, body_dict 或 None)。204 时 body 为 None。"""
    url = f'{base_url}{path}'
    req = Request(url, method='GET')
    with urlopen(req, timeout=10) as r:
        code = r.getcode() if hasattr(r, 'getcode') else getattr(r, 'status', getattr(r, 'code', 200))
        raw = r.read().decode('utf-8')
        if not raw.strip():
            return (code, None)
        return (code, json.loads(raw))


def http_post_json(base_url, path, data, timeout=15):
    url = f'{base_url}{path}'
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    req = Request(url, data=body, method='POST', headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def apply_offset_to_grid_data(data, offset_lat, offset_lon):
    """对 data 中所有带 latitude/longitude 的列表项施加偏移（原地修改）。"""
    if not isinstance(data, dict):
        return
    for key, value in data.items():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            if 'latitude' in value[0] and 'longitude' in value[0]:
                for item in value:
                    if 'latitude' in item:
                        item['latitude'] = item['latitude'] + offset_lat
                    if 'longitude' in item:
                        item['longitude'] = item['longitude'] + offset_lon
        elif isinstance(value, dict):
            apply_offset_to_grid_data(value, offset_lat, offset_lon)


def do_grid_save(base_url, task, offset_lat, offset_lon):
    """拉取当前网格数据，应用偏移后 POST /api/grid/save。"""
    task_to_param = {'task1': 'task1', 'task2': 'task2', 'task3': 'task3', 'group': 'group'}
    param = task_to_param[task]
    print(f'正在拉取当前 {task} 数据...')
    try:
        data = http_get(base_url, f'/api/grid/data?task={param}')
    except Exception as e:
        print(f'拉取失败: {e}')
        return
    if offset_lat != 0 or offset_lon != 0:
        apply_offset_to_grid_data(data, offset_lat, offset_lon)
        print(f'已应用偏移: lat+{offset_lat}, lon+{offset_lon}')
    print(f'正在发送 POST /api/grid/save (task={param})...')
    try:
        resp = http_post_json(base_url, '/api/grid/save', {'task': param, 'data': data})
        print('成功:', resp)
    except HTTPError as e:
        print(f'HTTP 错误: {e.code}', e.read().decode('utf-8'))
    except Exception as e:
        print('失败:', e)


# 写死的模拟数据：网格保存时的经纬度偏移（度），便于观察地图上位置变化
GRID_OFFSET_LAT = 0.03
GRID_OFFSET_LON = 0.03

# 写死的示例偏好（3 组 gridIndex）
SAMPLE_PREFERENCES = [
    [300, 301, 302],
    [303, 304, 305],
    [306, 307, 308],
]


def do_preference_save(base_url):
    """使用写死的示例偏好 POST /api/grid/preference/save。"""
    preferences = SAMPLE_PREFERENCES
    print('使用写死示例偏好（3 组）发送...')
    print('正在发送 POST /api/grid/preference/save...')
    try:
        resp = http_post_json(base_url, '/api/grid/preference/save', {'preferences': preferences})
        print('成功:', resp)
    except HTTPError as e:
        print(f'HTTP 错误: {e.code}', e.read().decode('utf-8'))
    except Exception as e:
        print('失败:', e)


# 通道立方体示例：中心经纬高，长宽 km，高度 m
SAMPLE_CHANNEL = {
    'channel': {
        'cubeList': [
            {
                'center_jd': 108.381466,
                'center_wd': 34.60209,
                'center_gc': 2950,
                'length': 105,
                'width': 72,
                'height': 2300
            }
        ]
    }
}

# 任务区域示例：各区域中心经纬度、高程、长宽 km（init + task1/task2/task3）
SAMPLE_TASK_AREA = {
    'task_area': {
        'init':  {'longitude': 108.38, 'latitude': 34.60, 'altitude': 2000, 'length': 6, 'width': 6},
        'task1': {'longitude': 108.45, 'latitude': 34.62, 'altitude': 2000, 'length': 6, 'width': 6},
        'task2': {'longitude': 108.52, 'latitude': 34.58, 'altitude': 2000, 'length': 6, 'width': 6},
        'task3': {'longitude': 108.58, 'latitude': 34.55, 'altitude': 2000, 'length': 10, 'width': 10}
    }
}


def do_channel_save(base_url, use_file=True):
    """POST /api/grid/channel/save：写入通道数据到 grid/channel.json，前端收到 SSE 后显示立方体。"""
    if use_file:
        path = ROOT / 'grid' / 'channel.json'
        if path.exists():
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                print(f'使用当前 channel.json（{len(data.get("channel", {}).get("cubeList", []))} 个立方体）')
            except Exception as e:
                print(f'读取 channel.json 失败: {e}，使用示例数据')
                data = SAMPLE_CHANNEL
        else:
            print('未找到 channel.json，使用示例数据')
            data = SAMPLE_CHANNEL
    else:
        data = SAMPLE_CHANNEL
        print('使用示例通道数据发送...')
    print('正在发送 POST /api/grid/channel/save...')
    try:
        resp = http_post_json(base_url, '/api/grid/channel/save', data)
        print('成功:', resp)
    except HTTPError as e:
        print(f'HTTP 错误: {e.code}', e.read().decode('utf-8'))
    except Exception as e:
        print('失败:', e)


def do_task_area_save(base_url, use_file=True, wait_timeout=600):
    """POST /api/grid/task-area/save：HTTP 连接阻塞等待，直到前端用户确认后服务端返回 task_area 数据。"""
    if use_file:
        path = ROOT / 'grid' / 'task_area.json'
        if path.exists():
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                n = len(data.get('task_area', {}))
                print(f'使用当前 task_area.json（{n} 个区域）')
            except Exception as e:
                print(f'读取 task_area.json 失败: {e}，使用示例数据')
                data = SAMPLE_TASK_AREA
        else:
            print('未找到 task_area.json，使用示例数据')
            data = SAMPLE_TASK_AREA
    else:
        data = SAMPLE_TASK_AREA
        print('使用示例任务区域数据发送...')
    print('正在发送 POST /api/grid/task-area/save（连接将阻塞直到用户确认，最长 %d 秒）...' % wait_timeout)
    try:
        resp = http_post_json(base_url, '/api/grid/task-area/save', data, timeout=wait_timeout)
        if resp.get('error'):
            print('服务端返回错误:', resp)
        else:
            print('服务端已确认，返回数据:')
            print(json.dumps(resp, ensure_ascii=False, indent=2))
    except HTTPError as e:
        print(f'HTTP 错误: {e.code}', e.read().decode('utf-8'))
    except Exception as e:
        print('失败:', e)


def main():
    base_url = load_config()
    print('=' * 50)
    print('Agent 调用模拟程序')
    print(f'API 地址: {base_url}')
    print('=' * 50)
    print()
    print('请选择要调用的接口：')
    print('  1) 网格保存 (POST /api/grid/save) - task1')
    print('  2) 网格保存 (POST /api/grid/save) - task2')
    print('  3) 网格保存 (POST /api/grid/save) - task3')
    print('  4) 网格保存 (POST /api/grid/save) - group')
    print('  5) 偏好保存 (POST /api/grid/preference/save)')
    print('  6) 通道保存 (POST /api/grid/channel/save) - 写入 grid/channel.json，前端显示立方体')
    print('  7) 任务区域保存 (POST /api/grid/task-area/save) - 写入 grid/task_area.json，前端显示各区域矩形')
    print('  0) 退出')
    try:
        choice = input('输入选项 (0-7): ').strip() or '0'
    except EOFError:
        choice = '0'
    print()

    if choice == '0':
        print('已退出')
        return
    if choice == '5':
        do_preference_save(base_url)
        return
    if choice == '6':
        do_channel_save(base_url, use_file=True)
        return
    if choice == '7':
        do_task_area_save(base_url, use_file=True)
        return
    if choice in ('1', '2', '3', '4'):
        task = {'1': 'task1', '2': 'task2', '3': 'task3', '4': 'group'}[choice]
        print(f'使用写死偏移: lat+{GRID_OFFSET_LAT}, lon+{GRID_OFFSET_LON}')
        do_grid_save(base_url, task, GRID_OFFSET_LAT, GRID_OFFSET_LON)
        return
    print('无效选项')


if __name__ == '__main__':
    main()
