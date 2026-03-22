# Cesium 官方代码参考

本目录保存从 **Cesium 官方仓库** 下载/整理的代码片段，便于对照「人家是怎么写的」。

- 官方仓库: https://github.com/CesiumGS/cesium  
- 原始 HelloWorld: `Apps/HelloWorld.html`  
- 影像示例: `Apps/Sandcastle/gallery/Imagery Layers.html`

---

## 1. HelloWorld（官方最小示例）

**官方写法：**

```javascript
const viewer = new Cesium.Viewer("cesiumContainer");
```

- 仅一行：不传 `imageryProvider` 时使用**默认影像**（通常依赖 Ion/Bing，需联网或 Token）。
- 样式：用 `@import url(../Build/CesiumUnminified/Widgets/widgets.css)`，容器 `#cesiumContainer` 占满宽高。

**本项目的做法：**

- 在 `index.html` 里设置 `window.CESIUM_BASE_URL = 'lib/Cesium/'`，并引用 `lib/Cesium/Widgets/widgets.css`、`lib/Cesium/Cesium.js`，与官方结构一致。
- 在 `Globe3D.js` 里**不**用默认影像，而是显式传入 `imageryProvider`：先用 **NaturalEarthII**（`TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))`），保证离线也有贴图；再支持运行时切换为本地瓦片（`setImageryFromTileServer`）。

---

## 2. Imagery Layers（影像层）

**官方写法：**

- `baseLayer` 用 `Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(3830183))`。
- 增加图层：`viewer.scene.imageryLayers.add(imageryLayer)`，并可设置 `layer.alpha`、`layer.brightness`。
- 单张图叠加：`SingleTileImageryProvider.fromUrl(url, { rectangle })`。

**本项目的做法：**

- 底图用 `TileMapServiceImageryProvider.fromUrl(NaturalEarthII)`（离线），不用 Ion。
- 切换底图时：`viewer.imageryLayers.removeAll()` 再 `addImageryProvider(provider)`，与官方「操作 imageryLayers」的方式一致。

---

## 3. NaturalEarthII / 离线影像

- 官方文档与示例中，NaturalEarthII 可用两种方式：
  - **TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))**（推荐，读 tilemapresource.xml）。
  - 或 **UrlTemplateImageryProvider**：`buildModuleUrl('Assets/Textures/NaturalEarthII') + '/{z}/{x}/{reverseY}.jpg'`，且用 **GeographicTilingScheme**、**maximumLevel: 5**。
- 本项目采用第一种（`TileMapServiceImageryProvider.fromUrl`），与官方推荐一致。

---

## 4. 本工程已采用的修改（对齐官方）

- **底图传入方式**：与 Sandcastle「Imagery Layers」一致，使用 `baseLayer: Cesium.ImageryLayer.fromProviderAsync(Cesium.TileMapServiceImageryProvider.fromUrl(...))`，不再在业务里 `await` Provider 再传 `imageryProvider`。Viewer 同步创建，底图由 Cesium 内部异步加载。
- **App 初始化**：不再 `await globe3d.initPromise`，因 Viewer 在 `Globe3D` 构造函数内已同步创建完成。

## 5. 小结

| 项目         | 官方 HelloWorld / Sandcastle     | 本工程 (earth-3d-platform)				|
|--------------|-----------------------------------|----------------------------------------|
| 引入 Cesium | 相对路径 Build/Widgets           | `CESIUM_BASE_URL` + lib/Cesium/         |
| 底图         | baseLayer: ImageryLayer.fromProviderAsync(Promise) | 同左，NaturalEarthII + 可切本地瓦片 |
| 影像层操作   | imageryLayers.add / fromProviderAsync | removeAll + addImageryProvider     |

如需更多示例，可查看官方 Sandcastle：  
https://github.com/CesiumGS/cesium/tree/main/Apps/Sandcastle/gallery
