# API 接口文档

后端服务默认地址：`http://127.0.0.1:9000`（可由 `config.json` 或环境配置修改）。

---

## 一、系统与配置

### 1. GET /api/health

**说明**：健康检查。

**请求**：无参数。

**响应**（200）：
```json
{
  "status": "ok",
  "message": "Service is running",
  "version": "1.0.0"
}
```

**前端用法**：`ApiService.healthCheck()`，用于检测后端是否可用。

---

### 2. GET /config.json

**说明**：返回项目根目录下 `config.json` 的完整内容（过滤掉以 `_` 开头的键），供前端读取瓦片地址等配置。

**请求**：无参数。

**响应**（200）：JSON 对象，常见键包括 `tile_server_public`、`tiles_dir`、`api_server` 等。若文件不存在返回 404。

**前端用法**：应用初始化时优先请求该文件以设置 `Config.SERVER.TILE_SERVER` 等；若失败则回退到 `/api/config`。

---

### 3. GET /api/config

**说明**：返回地图/瓦片相关配置（与 config.json 内容对应）。

**请求**：无参数。

**响应**（200）：
```json
{
  "tileServer": "http://127.0.0.1:9001",
  "localTilesPath": "",
  "apiServer": "http://127.0.0.1:9000"
}
```

**前端用法**：当 `/config.json` 不可用时，用此接口补全 `Config.SERVER`（见 `app.js` init）。

---

### 4. GET /api/tile-proxy-test

**说明**：测试瓦片代理是否可用。

**请求**：无参数。

**响应**（200）：
```json
{ "ok": true, "tileProxy": true }
```

---

## 二、网格数据

### 5. GET /api/grid/list

**说明**：获取可用的网格任务类型列表。

**请求**：无参数。

**响应**（200）：
```json
["initGrid", "task1", "task2", "task3", "group"]
```

**前端用法**：`ApiService.getGridList()`，用于展示或校验可选任务类型。

---

### 6. GET /api/grid/data

**说明**：按任务类型获取网格数据。数据来源为 `grid/` 目录下固定文件名，无额外文件。

**请求**：Query 参数

| 参数   | 必填 | 说明 |
|--------|------|------|
| `task` | 是   | 任务类型：`initGrid`、`task1`、`task2`、`task3`、`group` |

**数据文件对应**：

| task     | 读取文件                 | 返回键说明 |
|----------|--------------------------|------------|
| initGrid | Test_grid_task1.json     | 仅返回 `initGrid` |
| task1    | Test_grid_task1.json     | 原样返回文件内容 |
| task2    | Test_grid_task2.json     | 原样返回 |
| task3    | Test_grid_task3.json     | 原样返回（含 task3Grid、preferences） |
| group    | Test_group.json          | 原样返回（含 groups） |

**响应**（200）：JSON 对象，结构依 task 不同。若文件不存在则返回模拟数据；错误时返回 `{ "error": "..." }` 及 400/500。

**前端用法**：`ApiService.getGridData(task)`；左侧「加载选中网格」与 Agent 导入均通过 `getGridDataLikeDA()` 间接使用（其中 task3 与 group 已改用独立接口，见下）。

---

### 7. GET /api/grid/preference

**说明**：偏好网格独立接口，仅读取 `grid/Test_grid_task3.json`，不增加新文件。

**请求**：无参数。

**响应**（200）：
```json
{
  "task3Grid": [ { "gridIndex", "latitude", "longitude", "length", "width", ... } ],
  "preferences": [ [ 网格索引... ], ... ]
}
```

**前端用法**：`ApiService.getPreferenceGridData()`。在 `getGridDataLikeDA()` 中用于组装 task3 与 task3Preferences；即「加载选中网格」、Agent 聊天确认「导入网格」时会调用此接口。

---

### 8. GET /api/grid/group-members

**说明**：分组信息（members）独立接口，仅读取 `grid/Test_group.json`，不增加新文件。

**请求**：无参数。

**响应**（200）：
```json
{
  "groups": [
    {
      "members": { "0": ["101"], "1": ["102"], "2": ["201","209","217"], ... },
      "platformGridMaps": [ ... ]
    }
  ]
}
```

**前端用法**：`ApiService.getGroupMembers()`。用于：① `getGridDataLikeDA()` 组装 groups；② 点击「显示分组情况」开关时弹窗展示各组成员（`app.js` → `showGroupMembersModal()`）。

---

### 9. POST /api/grid/save

**说明**：保存网格数据到本地 JSON 文件，供 Agent 等调用。

**请求**：Body 为 JSON

| 字段   | 类型   | 必填 | 说明 |
|--------|--------|------|------|
| `task` | string | 否   | 任务类型，默认 `task1`。可选：task1、task2、task3、group |
| `data` | object | 是   | 要保存的网格数据（结构需与对应 task 的 JSON 一致） |

**数据文件对应**：task1 → Test_grid_task1.json；task2 → Test_grid_task2.json；task3 → Test_grid_task3.json；group → Test_group.json。

**响应**（200）：
```json
{
  "status": "success",
  "message": "网格数据已保存到 ...",
  "task": "task1",
  "dataCount": 123
}
```

**错误**：缺少 `data` 返回 400；未知 task 返回 400；服务器错误返回 500。

**前端用法**：由 Agent 或其它保存流程通过 POST 调用，前端 ApiService 可封装为 `saveGridData(task, data)`。

---

### 10. POST /api/grid/preference/save

**说明**：仅保存网格偏好到 `grid/Test_grid_task3.json`，与网格保存接口独立。会保留文件中已有的 `task3Grid`，只更新 `preferences` 字段（格式与现有 task3 文件一致：`preferences` 为二维数组，每组为 gridIndex 列表）。

**请求**：Body 为 JSON

| 字段          | 类型  | 必填 | 说明 |
|---------------|-------|------|------|
| `preferences` | array | 是*  | 偏好数据，二维数组，如 `[[338,339,340,...],[328,...],...]`。也可用 `data` 传同结构 |
| `data`        | array | 是*  | 与 `preferences` 同义，二选一即可 |

**响应**（200）：
```json
{
  "status": "success",
  "message": "偏好已保存到 ...（task3Grid 已保留，preferences 已更新）",
  "preferenceGroupCount": 4
}
```

**错误**：缺少 `preferences`/`data` 返回 400；`preferences` 非数组返回 400；服务器错误返回 500。

**前端用法**：供 Agent 调用，与 `POST /api/grid/save` 分开使用；写偏好时只改 task3 的 preferences，不覆盖 task3Grid。

---

### 11. GET /api/grid/last-update

**说明**：返回各网格 JSON 文件的最后修改时间（Unix 时间戳），以及 task3 的「仅网格保存」与「仅偏好保存」分别的时间戳，供前端轮询并区分只刷新网格或只刷新偏好。

**请求**：无参数。

**响应**（200）：
```json
{
  "task1": 1710123456.789,
  "task2": 1710123456.789,
  "task3": 1710123460.123,
  "group": 0,
  "task3_grid_save_at": 1710123460.12,
  "task3_preference_save_at": 1710123465.45
}
```
- 文件不存在时对应键为 `0`。
- `task3_grid_save_at`：最近一次 `POST /api/grid/save`（task=task3）成功时的时间戳。
- `task3_preference_save_at`：最近一次 `POST /api/grid/preference/save` 成功时的时间戳。  
前端据此实现：只更新 task3 网格时仅刷新网格不更新偏好图例；只更新偏好时仅更新偏好图例与着色，不重载网格。

**前端用法**：`ApiService.getGridLastUpdate()`。可选，兼容旧前端或非 SSE 场景；当前推荐使用 **GET /api/grid/events** 实现「调用一次修改一次」。

---

### 11.1 GET /api/grid/events（SSE，推荐）

**说明**：Server-Sent Events 长连接。前端订阅后，**仅在** `POST /api/grid/save` 或 `POST /api/grid/preference/save` 被调用成功后，后端向该连接推送**一次**事件；其他时间无请求、无轮询。实现「调用一次修改一次」。

**请求**：无参数。GET 后保持连接，`Content-Type: text/event-stream`。

**推送事件**：每条为 SSE 格式 `data: <JSON>\n\n`，JSON 示例：
```json
{
  "changedKeys": ["task1"],
  "task3GridOnly": false,
  "task3PreferenceOnly": false
}
```
- `POST /api/grid/save`（task=task1/2/3/group）后：`changedKeys` 为对应任务，`task3GridOnly` 仅 task3 时为 true。
- `POST /api/grid/preference/save` 后：`changedKeys` 为空数组，`task3PreferenceOnly` 为 true。

**前端用法**：`new EventSource(apiBase + '/api/grid/events')`，`onmessage` 中解析 `ev.data` 为 JSON 后调用 `refreshGridDataFromServer(payload)`，实现保存后自动刷新一次。

---

### 11.2 任务区域（需用户确认后再返回 Agent）

**流程**：Agent 调用 **POST /api/grid/task-area/save** 后，HTTP 连接**阻塞等待**（最长 10 分钟）。前端收到 SSE 后在聊天框弹出确认卡片。用户点 **接收** 或 **已修改完毕** 时，前端调用 **POST /api/grid/task-area/confirm**，服务端向等待中的 Agent 连接返回 `{ "task_area": { ... } }`（读自当前 `task_area.json`），解除阻塞。若用户选择 **需要修改**，在地图上改完后须由前端调用 **POST /api/grid/task-area/save-ui** 保存（**非阻塞**，不得使用 `save`，否则会与 Agent 的阻塞请求死锁）。保存成功后聊天框弹出「修改后确认」卡片；仅当用户在该卡片中点 **已修改完毕**（或首屏直接 **接收**）并触发 **confirm** 后，Agent 才收到数据。

| 接口 | 说明 |
|------|------|
| **GET /api/grid/task-area** | 读取 task_area.json，供前端绘制。 |
| **POST /api/grid/task-area/save** | Body: `{ "task_area": { ... } }`。**仅 Agent 调用**。保存并推送 SSE 后 **HTTP 阻塞**直至 **confirm**，再向本连接返回 `{ "task_area": { ... } }`。超时 408。 |
| **POST /api/grid/task-area/save-ui** | Body: 同上。**仅前端**在地图编辑后保存。写 `task_area.json` 并推送 SSE，**立即**返回 `{ "status": "success", ... }`，不加入阻塞等待队列。 |
| **POST /api/grid/task-area/confirm** | 无 Body。前端在用户 **接收** 或 **已修改完毕** 时调用。向所有等待中的 **save** 连接返回当前 `task_area.json` 内容并解除阻塞。 |

---

## 三、瓦片代理

### 12. GET /tiles 或 /tiles/

**说明**：返回瓦片代理说明页（HTML），避免 404。

---

### 13. GET /tiles/{z}/{x}/{y}.{ext}

**说明**：将瓦片请求代理到瓦片服务（默认 9001），使前端与瓦片同源，避免 Cesium 贴图跨域问题。

**请求**：路径即瓦片路径，如 ` /tiles/5/12/8.jpg`。

**响应**：转发 9001 的响应（图片或 502 错误）。

---

## 四、前端调用汇总

| 接口 | 前端方法 / 调用位置 |
|------|---------------------|
| GET /api/health | `ApiService.healthCheck()` |
| GET /config.json | 应用 init：读取瓦片/API 配置 |
| GET /api/config | 应用 init：config.json 不可用时回退 |
| GET /api/grid/list | `ApiService.getGridList()` |
| GET /api/grid/data?task=* | `ApiService.getGridData(task)`（initGrid/task1/task2） |
| GET /api/grid/preference | `ApiService.getPreferenceGridData()` → getGridDataLikeDA、加载网格、Agent 导入 |
| GET /api/grid/group-members | `ApiService.getGroupMembers()` → getGridDataLikeDA、显示分组情况弹窗 |
| POST /api/grid/save | Agent 或保存流程（可选封装） |
| POST /api/grid/preference/save | Agent 写 task3 偏好（仅更新 preferences） |
| GET /api/grid/last-update | 可选，轮询用；当前前端改用 SSE 不再轮询 |
| GET /api/grid/events | SSE 订阅，POST 保存后推送一次，前端刷新一次（调用一次修改一次） |

---

*文档与后端 `server.py` 保持一致，如有新增接口请同步更新本文档与启动时的端点列表。*
