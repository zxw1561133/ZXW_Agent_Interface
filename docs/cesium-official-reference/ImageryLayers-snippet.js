/**
 * Cesium 官方 Sandcastle - Imagery Layers 示例（影像层用法）
 * 来源: https://github.com/CesiumGS/cesium/blob/main/Apps/Sandcastle/gallery/Imagery%20Layers.html
 *
 * 要点：
 * - baseLayer 用 ImageryLayer.fromProviderAsync(IonImageryProvider.fromAssetId(...))
 * - 额外图层用 viewer.scene.imageryLayers.add()
 * - 可设置 layer.alpha、layer.brightness
 * - SingleTileImageryProvider 可指定 rectangle 做叠加
 */
window.startup = async function (Cesium) {
  "use strict";
  const viewer = new Cesium.Viewer("cesiumContainer", {
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.IonImageryProvider.fromAssetId(3830183),
    ),
    baseLayerPicker: false,
  });
  const layers = viewer.scene.imageryLayers;

  const blackMarble = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.IonImageryProvider.fromAssetId(3812),
  );
  blackMarble.alpha = 0.5;
  blackMarble.brightness = 2.0;
  layers.add(blackMarble);

  const cesiumLogo = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.SingleTileImageryProvider.fromUrl("../images/Cesium_Logo_overlay.png", {
      rectangle: Cesium.Rectangle.fromDegrees(-75.0, 28.0, -67.0, 29.75),
    }),
  );
  layers.add(cesiumLogo);
};
