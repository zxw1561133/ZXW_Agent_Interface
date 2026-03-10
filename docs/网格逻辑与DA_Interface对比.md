# 网格逻辑与 DA_Interface 对比说明

本文档基于对 **DA_Interface** 全部网格相关代码的逐项阅读，与 **earth-3d-platform** 的对比结论及已做修正。

## 网格交互设计（产品逻辑）

- **多任务阶段**：每个任务阶段的网格选中状态**相互独立**（例如任务1选中一批、任务2选中另一批可同时存在）。
- **同一阶段内**：支持**单选**（选中该网格）、**全选**（选中该阶段全部网格）。
- **回退/取消**：支持**取消选中该网格**（单格回退）、**取消该阶段选中**（仅清空当前阶段）、**取消所有选中**（清空全部阶段）。
- **左键点击**：任意时刻都可点击网格切换选中/取消，贯穿整个任务线操作。

---

## 一、DA_Interface 中网格相关逻辑（已完整阅读）

### 1. 涉及文件

| 文件 | 作用 |
|------|------|
| `frontend/js/app.js` | `GridVisualizer` 类：loadGridData、drawGrids、selectGrids、deselectGrids、getGridAtPosition、getGridsByStage、stageColors、platform10xx、选中/未选中绘制样式 |
| `frontend/js/grid-handlers.js` | 加载所有阶段网格、透明度滑块、显示网格复选框、右键菜单（4 项）、菜单项显隐、选中/取消选中/该阶段全部/取消所有、redrawGrids、gridScreenBounds、鼠标在选中网格上为 move 光标 |
| `frontend/js/map-handlers.js` | 地图缩放/拖拽后调用 redrawGrids 重绘网格 |
| `frontend/js/main.js` | 创建 GridVisualizer，传入 ctx/mapDisplay/mapManager，initGridHandlers(elements, managers) |
| `frontend/index.html` | 网格控制 UI：gridTaskSelect、loadGridBtn、gridStatus、showGrid、gridOpacity2 |
| `frontend/css/style.css` | .grid-context-menu、.context-menu-item 样式 |

### 2. 数据与阶段

- **加载方式**：一次加载所有阶段（task1/task2/task3/group 四个 API），拼成 `initGrid, task1Grid, task2Grid, task3Grid, groups`。
- **阶段名 stage**：`init` | `task1` | `task2` | `task3` | `group`。
- **groups 结构**：`groupData.groups` 为数组，每项为 `{ members, platformGridMaps }`；`platformGridMaps` 项为 `{ platformID, initGridIndex, task1GridIndex, ... }`，**无 latitude/longitude/length/width**，DA 中仍被 push 进 `this.grids`，绘制时若缺几何会自然跳过。
- **platform10xx**：`gridIndex in [1000, 1999]` 时用 platform10xx 的 stroke/text 颜色，但 **stageName 保留原阶段**（Init / Task1 / Task2 / Task3 / Group），见注释“保留阶段名称”。

### 3. 颜色与绘制（app.js GridVisualizer）

- **stageColors**：init/task1/task2/task3/group/platform10xx，含 name、stroke、text、textBg。
- **选中**：边框 `rgba(255,255,0,1)`、线宽 **4**、先填充 **rgba(255,255,0,0.2)** 再描边，文字不透明。
- **未选中**：边框/文字应用透明度滑块；线宽：**opacity >= 1 时为 4，否则 2**。
- **标签**：两行，第一行 stageName（英文），第二行 gridIndex。

### 4. 选中/取消选中（app.js）

- **selectGrids(gridIndices)**：支持 number 或 Array，全部 `selectedGrids.add`。
- **deselectGrids(gridIndices)**：不传或 `null` 则 `selectedGrids.clear()`；否则按 number 或 Array `delete`。

### 5. 右键菜单（grid-handlers.js）

- 四项：**选中该网格**、**选中该阶段全部网格**、**取消选中该网格**、**取消所有选中**（无“查看详情”）。
- **显隐**：当前网格已选中时只显示“取消选中该网格”+“取消所有选中”（若有任意选中）；未选中时显示“选中该网格”+“选中该阶段全部网格”+“取消所有选中”（若有任意选中）。
- **选中单个**：若 `!selectedGrids.has(clickedGrid.gridIndex)` 才 `selectGrids(clickedGrid.gridIndex)`，再 `redrawGrids()`。
- **选中该阶段全部**：`clickedGrid.stage` + `getGridsByStage(stage)` 得到该阶段所有 gridIndex，再 `selectGrids(allGridIndices)`。
- **取消选中单个/全部**：`deselectGrids(clickedGrid.gridIndex)` 或 `deselectGrids()`，然后重绘。

### 6. 其他

- **getGridAtPosition**：屏幕坐标 + 点在多边形（射线法）判断落在哪个网格。
- **getGridsByStage(stage)**：`this.grids.filter(g => g.stage === stage).map(g => g.gridIndex)`。
- **左键**：DA 没有“左键点击网格切换选中”的逻辑，仅右键菜单操作。

---

## 二、earth-3d-platform 与 DA_Interface 的差异与修正

### 已修正项

1. **platform10xx 标签第一行**
   - **DA**：10xx 网格仍显示阶段名（Init / Task1 等），仅颜色用 platform10xx。
   - **原 3D**：用 `platform10xx.labelName`（如 "10xx"）作为第一行。
   - **修正**：在 `GridSystem.createGridEntity` 中，对 platform10xx 使用**当前 taskType 的 labelName**（Init/Task1/…），与 DA 一致。

2. **选中态视觉效果**
   - **DA**：选中时半透明黄底 `rgba(255,255,0,0.2)`，边框线宽 **4**。
   - **原 3D**：选中时 polygon 填充为 0，线宽 3。
   - **修正**：选中时 polygon material 使用 `selectedColor.fill.withAlpha(0.2)`；`Config.GRID_DEFAULTS.LINE_WIDTH_SELECTED` 改为 **4**；`setOpacity` 中已选中网格同样保留 0.2 填充。

### 3D 平台在 DA 基础上的增强

- **取消该阶段选中**：DA 仅有“取消所有选中”；3D 增加 **“取消该阶段选中”**，只清空当前任务阶段的选中，各阶段更独立。
- **右键菜单**：5 项（选中该网格、选中该阶段全部、取消选中该网格、**取消该阶段选中**、取消所有选中）+ “查看详情”；显隐逻辑按当前网格是否选中、该阶段是否有选中、全局是否有选中。

### 已对齐、无需改动的部分

- **右键菜单**：显隐逻辑与 DA 一致（按当前网格是否选中、是否有任意选中）；3D 在此基础上增加“取消该阶段选中”和“查看详情”。
- **selectGrids / deselectGrids**：语义一致；3D 用 Set 自然去重，无需像 DA 那样在菜单里再判一次。
- **选中该阶段全部**：3D 用 `taskType`（initGrid/task1Grid/…）对应 DA 的 `stage`（init/task1/…），`selectAllByType(taskType)` 与 `getGridsByStage(stage)` 等价。
- **透明度**：未选中应用滑块，选中不受影响；3D 的 `setOpacity` 已按此处理。
- **groups**：DA 的 groups 为 platformGridMaps 结构，无几何；3D 当前不加载/不绘制 groups，与 DA 实际可绘制内容一致。

### 3D 独有、保留的功能

- **左键点击网格切换选中**：DA 无此交互；3D 保留，便于“已选中的网格再点一下取消”。
- **查看详情**：在 DA 四项基础上增加的菜单项，保留。

---

## 三、修改过的文件一览

| 文件 | 修改内容 |
|------|----------|
| `frontend/js/grid/GridSystem.js` | platform10xx 标签用阶段名；选中填充 0.2；setOpacity 中选中保留 0.2 |
| `frontend/js/core/Config.js` | `LINE_WIDTH_SELECTED: 4` |

---

## 四、小结

- DA_Interface 中所有与网格相关的逻辑（数据阶段、颜色、platform10xx、选中样式、右键菜单四项及显隐、select/deselect、getGridsByStage）均已阅读并用于对比。
- 已修正的差异只有两点：**platform10xx 显示阶段名**、**选中时半透明黄底 + 线宽 4**；其余在 3D 中已与 DA 对齐或为合理扩展（左键切换选中、查看详情）。
