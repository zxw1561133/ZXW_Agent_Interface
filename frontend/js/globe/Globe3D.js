/**
 * 3D 地球渲染器 - 使用 CesiumJS（纯本地，无在线依赖）
 * 严格使用地址栏/Config 的瓦片地址，不成功则不显示底图（无静默回退）
 */
class Globe3D {
    constructor(containerId) {
        this.containerId = containerId;
        this.viewer = null;
        /** 视角模式：'top' 俯视（垂直向下），'oblique' 斜视（可见高度层次） */
        this._viewMode = 'top';
        this.init();
    }
    
    /** 无底图时使用的单色图（与场景背景一致），表示未连接瓦片服务 */
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
                } catch (e) { /* 尝试下一瓦片路径 */ }
            }
            console.warn('⚠️ 瓦片地址不可用:', tileBase, '；底图为空，请启动 map/server.py 或填写正确地址后点击「加载」');
            return Globe3D._getNoImageryProvider();
        };
        return tryStrict();
    }
    
    init() {
        console.log('🌍 Initializing Cesium Globe (local only)...');
        
        try {
            // 使用上述瓦片源，不可用时无底图
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
                selectionIndicator: false,  // 关闭默认选中框，网格操作通过右键菜单
                creditContainer: document.createElement('div')
            });
            
            // 禁用双击跟踪/飞到，避免视角被锁定
            if (this.viewer.screenSpaceEventHandler) {
                this.viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
            }
            
            // 场景样式：深空背景、大气与星空
            this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050814');
            this.viewer.scene.globe.enableLighting = true;
            this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#001133');
            this.viewer.scene.skyAtmosphere.show = true;
            this._createStarfield();
            
            // 开放 Cesium 相机全部能力：缩放 1 ~ Infinity，旋转/倾斜/平移均启用
            const controller = this.viewer.scene.screenSpaceCameraController;
            controller.minimumZoomDistance = 1.0;
            controller.maximumZoomDistance = Number.POSITIVE_INFINITY;
            if (typeof controller.enableRotate !== 'undefined') controller.enableRotate = true;
            if (typeof controller.enableTilt !== 'undefined') controller.enableTilt = true;
            if (typeof controller.enableZoom !== 'undefined') controller.enableZoom = true;
            if (typeof controller.enableTranslate !== 'undefined') controller.enableTranslate = true;
            if (typeof controller.enableCollisionDetection !== 'undefined') controller.enableCollisionDetection = false;

            const globeCfg = Config.GLOBE || {};
            this._minCameraHeight = globeCfg.MIN_CAMERA_HEIGHT ?? 1;
            this._maxCameraHeight = globeCfg.MAX_CAMERA_HEIGHT ?? 1.2e8;

            // 初始视角（在配置范围内，仅用于 resetView / 缩放级别显示）
            this.viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(117.0, 39.0, Math.min(20000000, this._maxCameraHeight))
            });
            
            // 缩放级别按实际计算值通过事件发出
            this.viewer.camera.changed.addEventListener(() => {
                const height = this.viewer.camera.positionCartographic.height;
                const zoom = Math.log2(this._maxCameraHeight / height);
                eventBus.emit('globe:zoom', { 
                    zoom: zoom, 
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
            
            // 鼠标移动时在右下角显示经纬度
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
            
            // 右键菜单由 App 在 mapContainer 的 contextmenu 中统一处理
            
            console.log('✅ Cesium Globe initialized');
            
        } catch (error) {
            console.error('❌ Cesium init failed:', error);
            alert('地球初始化失败: ' + error.message);
        }
    }
    
    /**
     * 创建星空：程序化星点，不依赖外部星图
     */
    _createStarfield() {
        if (!this.viewer || !this.viewer.scene) return;
        const scene = this.viewer.scene;
        // 星空球半径大于最大视距，保证拉远时仍可见
        const STAR_RADIUS = 1.5e8;
        const STAR_COUNT = 6000;
        const MIN_ZOOM = 5e5;
        const MAX_ZOOM = 1.2e8;
        const seed = 12345;
        const rnd = (() => {
            let s = seed;
            return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        })();
        const starColors = [
            [1.0, 1.0, 1.0, 1.0],
            [0.9, 0.95, 1.0, 1.0],
            [1.0, 0.98, 0.9, 1.0],
            [0.85, 0.9, 1.0, 1.0],
            [1.0, 1.0, 0.95, 1.0]
        ];
        const collection = scene.primitives.add(new Cesium.PointPrimitiveCollection());
        for (let i = 0; i < STAR_COUNT; i++) {
            const lat = Math.asin(2 * rnd() - 1);
            const lon = 2 * Math.PI * rnd();
            const x = STAR_RADIUS * Math.cos(lat) * Math.cos(lon);
            const y = STAR_RADIUS * Math.cos(lat) * Math.sin(lon);
            const z = STAR_RADIUS * Math.sin(lat);
            const colorIdx = Math.floor(rnd() * starColors.length);
            const [r, g, b, a] = starColors[colorIdx];
            const brightness = 0.65 + 0.35 * rnd();
            collection.add({
                position: new Cesium.Cartesian3(x, y, z),
                color: new Cesium.Color(r * brightness, g * brightness, b * brightness, a),
                pixelSize: 2.0 + 2.5 * rnd(),
                outlineColor: new Cesium.Color(0, 0, 0, 0),
                scaleByDistance: new Cesium.NearFarScalar(MIN_ZOOM, 1.2, MAX_ZOOM * 1.8, 0.35)
            });
        }
        this._starfieldCollection = collection;
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
        // 仅当连接类错误连续出现时判定为未连通，避免 404 或启动延迟导致误判
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
     * 清除底图，切换为无瓦片服务状态（与当前地址栏一致，不保留旧图）
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
    
    /**
     * 按“级”缩放：delta 为级别变化量，+1 放大一级，-1 缩小一级。
     * 级别与高度关系：height = maxH * 2^(-level)，与右下角 Zoom 显示一致。
     */
    zoom(delta) {
        if (!this.viewer) return;
        const camera = this.viewer.camera;
        const height = camera.positionCartographic.height;
        const globeCfg = typeof Config !== 'undefined' && Config.GLOBE ? Config.GLOBE : {};
        const minH = this._minCameraHeight ?? globeCfg.MIN_CAMERA_HEIGHT ?? 5e5;
        const maxH = this._maxCameraHeight ?? globeCfg.MAX_CAMERA_HEIGHT ?? 1.2e8;
        const maxLevel = Math.max(0, Math.floor(Math.log2(maxH / minH)));
        const currentLevel = Math.round(Math.log2(maxH / height));
        const newLevel = Math.max(0, Math.min(maxLevel, currentLevel + delta));
        const newHeight = Math.max(minH, Math.min(maxH, maxH / Math.pow(2, newLevel)));
        const cartographic = camera.positionCartographic;
        camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                Cesium.Math.toDegrees(cartographic.longitude),
                Cesium.Math.toDegrees(cartographic.latitude),
                newHeight
            ),
            duration: 0.35
        });
    }
    
    resetView() {
        if (!this.viewer) return;
        const maxH = this._maxCameraHeight ?? (typeof Config !== 'undefined' && Config.GLOBE ? Config.GLOBE.MAX_CAMERA_HEIGHT : undefined) ?? 1.2e8;
        const height = Math.min(20000000, maxH);
        this.viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(117.0, 39.0, height)
        });
    }

    /** 当前视角模式：'top' | 'oblique' */
    getViewMode() {
        return this._viewMode;
    }

    /**
     * 获取当前视线中心点（屏幕中心与椭球交点），用于在任意缩放级别下围绕该点切换视角。与 Cesium 行为一致。
     */
    _getScreenCenterTarget() {
        const scene = this.viewer.scene;
        const canvas = scene.canvas;
        const center = new Cesium.Cartesian2(canvas.clientWidth * 0.5, canvas.clientHeight * 0.5);
        const ellipsoid = scene.globe.ellipsoid;
        const target = scene.camera.pickEllipsoid(center, ellipsoid);
        if (target != null) return target;
        const carto = scene.camera.positionCartographic;
        return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
    }

    /**
     * 切换视角模式：以当前视线中心为目标、保持当前缩放距离，只改变俯仰角。使用 Cesium Camera.lookAt + setView 立即生效，任意缩放级别均可切换。
     * @param {'top'|'oblique'} mode - 'top' 俯视（垂直向下）；'oblique' 斜视（有倾角，可看出网格高度）
     * @param {Object} [options] - pitch（斜视俯仰角度数）, fly（true 时用 flyTo 动画，默认 false 立即 setView）
     */
    setViewMode(mode, options = {}) {
        if (!this.viewer) return;
        const camera = this.viewer.camera;
        const controller = this.viewer.scene.screenSpaceCameraController;
        const minDist = controller.minimumZoomDistance;
        const maxDist = controller.maximumZoomDistance;

        const target = this._getScreenCenterTarget();
        let distance = Cesium.Cartesian3.distance(camera.position, target);
        distance = Math.max(minDist, Math.min(maxDist, distance));

        const fromPos = camera.position.clone();
        const fromOrient = camera.orientation.clone();

        if (mode === 'oblique') {
            this._viewMode = 'oblique';
            const pitchDeg = options.pitch != null ? options.pitch : -32;
            const pitchRad = Cesium.Math.toRadians(pitchDeg);
            camera.lookAt(target, new Cesium.HeadingPitchRange(0, pitchRad, distance));
        } else {
            this._viewMode = 'top';
            camera.lookAt(target, new Cesium.HeadingPitchRange(0, -Math.PI / 2, distance));
        }

        const toPos = camera.position.clone();
        const toOrient = camera.orientation.clone();
        camera.position = fromPos;
        camera.orientation = fromOrient;

        if (options.fly) {
            const duration = options.duration != null ? options.duration : 1.0;
            camera.flyTo({ destination: toPos, orientation: toOrient, duration });
        } else {
            camera.setView({ destination: toPos, orientation: toOrient });
        }
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
