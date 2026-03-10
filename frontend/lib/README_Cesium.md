# Cesium 本地部署说明（纯离线）

本工程已改为**纯本地方案**，不依赖任何在线图源或 Cesium Ion。Cesium 库需放在本目录下，由前端从本地加载。

## 目录结构要求

将 Cesium 构建产物放到 `Cesium` 子目录下，最终结构为：

```
frontend/lib/
├── Cesium/
│   ├── Cesium.js
│   ├── Widgets/
│   │   └── widgets.css
│   ├── Workers/
│   ├── Assets/
│   └── ThirdParty/
├── README_Cesium.md   （本文件）
└── ...
```

即：**所有 Cesium 相关文件都在 `frontend/lib/Cesium/` 下**。

## 方式一：手动下载（推荐）

1. 打开 Cesium 官方发布页：
   - https://cesium.com/downloads/cesiumjs/releases/1.110/
   - 或 GitHub: https://github.com/CesiumGS/cesium/releases/tag/1.110

2. 下载 **Build** 包（例如 `Cesium-1.110.zip` 或 Build 目录压缩包）。

3. 解压后，将 **Build/Cesium** 目录下的全部内容（`Cesium.js`、`Widgets/`、`Workers/`、`Assets/`、`ThirdParty/` 等）复制到本项目的 **`frontend/lib/Cesium/`** 目录下（若没有 `Cesium` 文件夹请先创建）。

4. 确认存在文件：`frontend/lib/Cesium/Cesium.js`、`frontend/lib/Cesium/Widgets/widgets.css`。

## 方式二：使用下载脚本（Windows）

在项目根目录执行：

```bat
frontend\lib\download_cesium.bat
```

脚本会下载 Cesium 1.110 的 Build 并解压到 `frontend/lib/Cesium/`。

## 验证

1. 启动前端服务（例如 `start_project.bat` 或 `python -m http.server 9000` 在 frontend 目录）。
2. 浏览器访问 `http://localhost:9000`。
3. 打开开发者工具 Network：不应出现对 `cesium.com` 的请求；所有 Cesium 资源应来自 `lib/Cesium/`。

若控制台报错 “Unable to determine Cesium base URL” 或 404，请检查 `CESIUM_BASE_URL` 是否为 `lib/Cesium/` 且上述文件是否齐全。
