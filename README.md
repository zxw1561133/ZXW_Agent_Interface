# 3D Earth Platform - 离线地球可视化平台

## 项目概述

**纯本地方案**，无在线图源与 Cesium Ion 依赖。基于 CesiumJS 的 3D 地球可视化平台，支持：
- 离线瓦片地图加载（本地 1-10 级）
- 3D 地球交互浏览
- 网格数据可视化
- Agent 智能助手对话
- 网格导入/选择/管理

## 技术栈

- **前端**: CesiumJS 1.110（本地部署）, 原生 JavaScript (ES6+)
- **后端**: Python 3 + http.server
- **地图**: 本地瓦片 (XYZ 格式, jpg/png)，无在线图源
- **网格**: JSON 数据格式

## 项目结构

```
earth-3d-platform/
├── frontend/              # 前端代码
│   ├── index.html         # 主页面
│   ├── css/
│   │   └── style.css      # 样式
│   └── js/
│       ├── core/          # 核心模块
│       │   ├── Config.js      # 配置
│       │   ├── EventBus.js    # 事件总线
│       │   └── ApiService.js  # API 服务
│       ├── globe/         # 3D 地球
│       │   └── Globe3D.js     # Cesium 地球（纯本地）
│       ├── grid/          # 网格系统
│       │   └── GridSystem.js  # 网格渲染
│       ├── chat/          # 聊天
│       │   └── ChatAgent.js   # Agent 对话
│       ├── ui/            # UI 组件
│       │   ├── PanelManager.js   # 面板管理
│       │   └── ContextMenu.js    # 右键菜单
│       └── app.js         # 应用入口
├── backend/               # 后端服务
│   └── server.py          # API 服务器 (端口 9000)
├── map/                   # 地图服务
│   └── server.py          # 瓦片服务器 (端口 9001)
├── grid/                  # 网格数据
│   └── (JSON 文件)
├── start.bat              # Windows 启动脚本
├── start.sh               # Linux/Mac 启动脚本
└── README.md              # 本文件
```

## 快速开始

### 1. 部署 Cesium 到本地（纯离线）

Cesium 库需放在前端本地，不从 CDN 加载。任选其一：

- **自动**：在项目根目录执行 `frontend\lib\download_cesium.bat`，将自动下载并解压到 `frontend/lib/Cesium/`。
- **手动**：按 `frontend/lib/README_Cesium.md` 说明，下载 Cesium 1.110 的 Build，将 `Build/Cesium` 下全部内容复制到 `frontend/lib/Cesium/`。

确认存在 `frontend/lib/Cesium/Cesium.js` 和 `frontend/lib/Cesium/Widgets/widgets.css` 后再启动。

### 2. 配置瓦片路径

在项目根目录编辑 **`config.json`**，设置 `tiles_dir` 为你的瓦片目录（地图服务从该路径读瓦片）：
- **Windows 示例**：`"tiles_dir": "F:\\jk\\天津滨海\\cursor\\map_test\\tiles"`
- **Linux 示例**：`"tiles_dir": "/home/zxw/cursor/earth-3d-platform_v1.1/tiles"`  
  Linux 下可复制 `config.example.linux.json` 为 `config.json` 再按本机路径修改。

### 3. 启动服务

**方式一：带界面的启动工具（推荐）**
- 双击运行 **`launcher.py`** 或 **`启动工具.bat`**（Windows），会打开一个小窗口：
  - 点击「启动服务」→ 自动启动地图服务(9001)与 API 服务(9000)
  - 点击「打开浏览器」→ 打开前端页面
  - 点击「停止服务」→ 关闭两个服务
- Linux / Mac 在项目根目录执行：`python3 launcher.py`

**方式二：命令行**

**Windows:**
```bash
start.bat
```

**Linux / macOS（同一套代码即可运行，无需单独打包）：**
```bash
chmod +x start.sh
./start.sh
```
> - 脚本名是 **start.sh**（不是 sart.sh）。前端访问地址是 **http://127.0.0.1:9000**（不是 5000）。
> - 若报错「Address already in use」，说明 9000/9001 已被占用，先执行：`pkill -f 'python3.*server.py'` 再重新运行 `./start.sh`。
> - Linux 下请先配置 `config.json` 的 `tiles_dir` 为本机瓦片路径（可参考 `config.example.linux.json`）。

或手动启动（需已安装 Python 3）：
```bash
# 终端 1: 地图服务 (端口 9001)
python3 map/server.py

# 终端 2: API + 前端 (端口 9000)
python3 backend/server.py

# 浏览器访问 http://127.0.0.1:9000
```

### 4. 使用流程

1. **启动后**，Agent 会自动询问是否导入网格
2. **点击"确认导入"**或回复"是"，网格会显示在地球上
3. **鼠标操作**：
   - 左键拖拽：旋转地球
   - 滚轮：缩放
   - 右键点击网格：打开菜单
4. **网格操作**：
   - 左侧面板选择任务类型
   - 调整透明度滑块
   - 开关编辑模式

## 配置说明

### 前端配置 `frontend/js/core/Config.js`

```javascript
SERVER: {
    TILE_SERVER: 'http://127.0.0.1:9001',  // 瓦片服务
    API_SERVER: 'http://127.0.0.1:9000',   // API 服务
}

LOCAL_TILES_PATH: 'F:\\jk\\天津滨海\\cursor\\map_test\\tiles'
```

### 网格数据格式 `grid/*.json`

初始网格（initGrid）**不单独成文件**，来自 `Test_grid_task1.json` 内的 `initGrid` 键；任务 1/2/3 与分组分别对应同目录下各 JSON 文件。

```json
{
  "initGrid": [
    { "gridIndex": 10, "latitude": 34.46, "longitude": 108.02, "length": 3.0, "width": 3.0, "altitude": 2420.0 }
  ]
}
```

## 端口占用

| 服务 | 端口 | 用途 |
|-----|------|------|
| API 服务 | 9000 | 网格数据、静态页面 |
| 地图服务 | 9001 | 瓦片图片 |

## 故障排查

### 页面空白
- 检查浏览器控制台报错
- 确认已按「部署 Cesium 到本地」完成，且存在 `frontend/lib/Cesium/Cesium.js`

### 瓦片不显示
- 确认 `map/server.py` 中的路径正确
- 检查瓦片文件是否存在 `tiles/1/0/0.jpg`

### 网格不显示
- 确认后端服务已启动
- 检查浏览器 Network 面板 API 请求

## 开发计划

- [x] 3D 地球基础框架
- [x] 本地瓦片加载
- [x] 网格系统
- [x] Agent 聊天
- [ ] 2D/3D 视图切换完善
- [ ] 网格数据实时更新
- [ ] 更多交互功能

## 许可证

MIT
