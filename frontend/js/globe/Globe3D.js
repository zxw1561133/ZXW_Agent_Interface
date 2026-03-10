/**
 * 3D 地球渲染器 - 使用 CesiumJS（纯本地，无在线依赖）
 * 严格使用地址栏/Config 的瓦片地址，不成功则不显示底图（无静默回退）
 */
class Globe3D {
    constructor(containerId) {
        this.containerId = containerId;
        this.viewer = null;
        this.init();
    }
    
    /** 无底图时使用的单色图（与场景背景一致），表示「未连接瓦片服务」 */
    static _getNoImageryProvider() {
        const dark = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKMIQQAAAABJRU5ErkJggg==';
        return new Cesium.SingleTileImageryProvider({
            url: dark,
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
        });
    }
    
    /**
     * 返回 Promise<ImageryProvider>：仅使用 Config.SERVER.TILE_SERVER，成功则用该瓦片，失败则无底图（单色）
     */
    static _getDefaultImageryProviderPromise() {
        const tileBase = (Config.SERVER.TILE_SERVER || '').replace(/\/$/, '');
        const ext = (Config.TILES && Config.TILES.TILE_EXT) || 'jpg';
        const testPaths = ['1/0/0', '1/0/1', '0/0/0'];
        if (!tileBase) {
            console.warn('⚠️ 未配置瓦片地址，底图为空；请在地址栏填入瓦片服务地址并点击「加载」');
            return Promise.resolve(Globe3D._getNoImageryProvider());
        }
        const tryStrict = async () => {
            for (const p of testPaths) {
                try {
                    const res = await fetch(`${tileBase}/${p}.${ext}`, { method: 'HEAD', mode: 'cors' });
                    if (res.ok) {
                        const useReverseY = Config.TILES && Config.TILES.USE_REVERSE_Y;
                        const yToken = useReverseY ? '{reverseY}' : '{y}';
                        const urlTemplate = `${tileBase}/{z}/{x}/${yToken}.${ext}`;
                        const minLevel = Config.TILES?.MIN_ZOOM ?? 1;
                        const maxLevel = Config.TILES?.MAX_ZOOM ?? 10;
                        const provider = new Cesium.UrlTemplateImageryProvider({
                            url: urlTemplate,
                            tilingScheme: new Cesium.WebMercatorTilingScheme(),
                            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
                            minimumLevel: minLevel,
                            maximumLevel: maxLevel
                        });
                        provider.errorEvent.addEventListener((err) => {
                            console.warn('瓦片加载失败:', err.message || err, err.target?.url);
                        });
                        console.log('✅ 使用瓦片地址:', tileBase);
                        return provider;
                    }
                } catch (e) { /* 继续尝试下一路径 */ }
            }
            console.warn('⚠️ 瓦片地址不可用:', tileBase, '；底图为空，请启动 map/server.py 或填写正确地址后点击「加载」');
            return Globe3D._getNoImageryProvider();
        };
        return tryStrict();
    }
    
    init() {
        console.log('🌍 Initializing Cesium Globe (local only)...');
        
        try {
            // 默认优先用自己的瓦片，不可用时回退 NaturalEarthII
            const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
                Globe3D._getDefaultImageryProviderPromise()
            );
            
            this.viewer = new Cesium.Viewer(this.containerId, {
                baseLayer: baseLayer,
                baseLayerPicker: false,
                timeline: false,
                animation: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                fullscreenButton: false,
                vrButton: false,
                skyBox: false,
                infoBox: false,
                selectionIndicator: false,  // 关闭绿色选中框，网格操作通过右键菜单
                creditContainer: document.createElement('div')
            });
            
            // 取消双击「跟踪/飞到」行为，避免视角锁定感
            if (this.viewer.screenSpaceEventHandler) {
                this.viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
            }
            
            // 设置样式
            this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0e27');
            this.viewer.scene.globe.enableLighting = true;
            this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#001133');
            this.viewer.scene.skyAtmosphere.show = true;
            
            // 初始视角
            this.viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(117.0, 39.0, 20000000)
            });
            
            // 事件监听
            this.viewer.camera.changed.addEventListener(() => {
                const height = this.viewer.camera.positionCartographic.height;
                const zoom = Math.log2(20000000 / height);
                eventBus.emit('globe:zoom', { 
                    zoom: Math.max(1, Math.min(10, zoom)), 
                    distance: height 
                });
            });
            
            const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
            handler.setInputAction((click) => {
                const cartesian = this.viewer.camera.pickEllipsoid(click.position, this.viewer.scene.globe.ellipsoid);
                if (cartesian) {
                    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                    eventBus.emit('globe:click', { 
                        lat: Cesium.Math.toDegrees(cartographic.latitude), 
                        lon: Cesium.Math.toDegrees(cartographic.longitude), 
                        point: cartesian,
                        originalEvent: click 
                    });
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
            
            // 鼠标移动：右下角显示经纬度
            const coordsEl = document.getElementById('mouseCoords');
            handler.setInputAction((movement) => {
                if (!coordsEl) return;
                const cartesian = this.viewer.camera.pickEllipsoid(movement.endPosition, this.viewer.scene.globe.ellipsoid);
                if (cartesian) {
                    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                    const lat = Cesium.Math.toDegrees(cartographic.latitude);
                    const lon = Cesium.Math.toDegrees(cartographic.longitude);
                    coordsEl.textContent = `经度 ${lon.toFixed(5)}°  纬度 ${lat.toFixed(5)}°`;
                    coordsEl.classList.add('visible');
                } else {
                    coordsEl.textContent = '';
                    coordsEl.classList.remove('visible');
                }
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
            
            // 右键菜单由 App 在 mapContainer 的 contextmenu 中统一处理（scene.pick + ContextMenu.showAt）
            
            console.log('✅ Cesium Globe initialized');
            
        } catch (error) {
            console.error('❌ Cesium init failed:', error);
            alert('地球初始化失败: ' + error.message);
        }
    }
    
    /**
     * 切换底图为本地瓦片（同源代理 9000/tiles）
     * 瓦片格式: {z}/{x}/{y}.ext，从一级瓦片（level 1）起
     * @param {string} tileBase - 瓦片服务 base URL
     * @param {{ onRepeatedErrors?: (baseUrl: string) => void }} options - 连续多次瓦片失败时回调（用于自动改为未连通并清除底图）
     */
    setImageryFromTileServer(tileBase, options = {}) {
        if (!this.viewer) return Promise.reject(new Error('地球未就绪'));
        const base = (tileBase || Config.SERVER.TILE_SERVER || '').replace(/\/$/, '');
        const ext = (Config.TILES && Config.TILES.TILE_EXT) || 'jpg';
        const useReverseY = Config.TILES && Config.TILES.USE_REVERSE_Y;
        const yToken = useReverseY ? '{reverseY}' : '{y}';
        const urlTemplate = `${base}/{z}/{x}/${yToken}.${ext}`;
        const minLevel = Config.TILES?.MIN_ZOOM ?? 1;
        const maxLevel = Config.TILES?.MAX_ZOOM ?? 10;
        const provider = new Cesium.UrlTemplateImageryProvider({
            url: urlTemplate,
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
            minimumLevel: minLevel,
            maximumLevel: maxLevel
        });
        // 仅当「连接被拒」等网络错误连续出现时才判为未连通，避免 404/缺瓦片或启动稍慢时误判
        const FAIL_THRESHOLD = 10;
        const GRACE_MS = 2500;
        let failCount = 0;
        const startTime = Date.now();
        provider.errorEvent.addEventListener((err) => {
            const msg = (err && (err.message || String(err))) || '';
            console.warn('瓦片加载失败:', msg, err && err.target && err.target.url);
            const isConnectionError = /REFUSED|ECONNREFUSED|Failed to fetch|Load failed|NetworkError|net::ERR/i.test(msg);
            if (!isConnectionError) return;
            if (Date.now() - startTime < GRACE_MS) return;
            failCount += 1;
            if (failCount >= FAIL_THRESHOLD && typeof options.onRepeatedErrors === 'function') {
                options.onRepeatedErrors(base);
            }
        });
        this.viewer.imageryLayers.removeAll();
        this.viewer.imageryLayers.addImageryProvider(provider);
        console.log('✅ 已切换为本地瓦片:', base, `(level ${minLevel}-${maxLevel})`);
        return Promise.resolve();
    }
    
    /**
     * 清除底图，改为「无瓦片服务」状态（严格与地址栏一致：该地址不可用时不再显示旧图）
     */
    setImageryToNoService() {
        if (!this.viewer) return;
        this.viewer.imageryLayers.removeAll();
        this.viewer.imageryLayers.addImageryProvider(Globe3D._getNoImageryProvider());
        console.log('⚠️ 已清除底图：当前地址不可用');
    }
    
    latLonToPoint(lat, lon, height = 0) {
        return Cesium.Cartesian3.fromDegrees(lon, lat, height);
    }
    
    flyTo(lat, lon, duration = 1) {
        if (!this.viewer) return;
        this.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1000000),
            duration: duration
        });
    }
    
    zoom(delta) {
        if (!this.viewer) return;
        const camera = this.viewer.camera;
        const distance = camera.positionCartographic.height;
        const newDistance = Math.max(100000, Math.min(50000000, distance - delta * 1000000));
        const cartographic = camera.positionCartographic;
        camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                Cesium.Math.toDegrees(cartographic.longitude),
                Cesium.Math.toDegrees(cartographic.latitude),
                newDistance
            ),
            duration: 0.5
        });
    }
    
    resetView() {
        if (!this.viewer) return;
        this.viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(117.0, 39.0, 20000000)
        });
    }
    
    getCameraPosition() {
        if (!this.viewer) return { lat: 0, lon: 0, height: 0 };
        const cartographic = this.viewer.camera.positionCartographic;
        return {
            lat: Cesium.Math.toDegrees(cartographic.latitude),
            lon: Cesium.Math.toDegrees(cartographic.longitude),
            height: cartographic.height
        };
    }
    
    getViewer() {
        return this.viewer;
    }
    
    addEntity(entity) {
        if (!this.viewer) return null;
        return this.viewer.entities.add(entity);
    }
    
    removeEntity(entity) {
        if (!this.viewer) return;
        this.viewer.entities.remove(entity);
    }
    
    clearEntities() {
        if (!this.viewer) return;
        this.viewer.entities.removeAll();
    }
    
    destroy() {
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
    }
}
