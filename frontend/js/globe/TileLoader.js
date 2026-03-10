/**
 * 瓦片加载器
 * 根据相机视角动态加载地图瓦片
 */
class TileLoader {
    constructor(globe3d) {
        this.globe3d = globe3d;
        this.tileCache = new Map();
        this.maxCacheSize = 100;
        this.currentZoom = 1;
        
        // 瓦片配置
        this.minZoom = 1;
        this.maxZoom = 10;
        this.tileSize = 256;
        
        // 启动瓦片更新循环
        this.startTileUpdateLoop();
    }
    
    /**
     * 启动瓦片更新循环
     */
    startTileUpdateLoop() {
        // 监听相机变化，延迟更新瓦片
        let updateTimeout = null;
        
        const updateTiles = () => {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
                this.updateVisibleTiles();
            }, 500); // 500ms 延迟，避免频繁更新
        };
        
        // 如果 globe3d 有 controls，监听变化
        if (this.globe3d.controls) {
            this.globe3d.controls.addEventListener('change', updateTiles);
        }
        
        // 初始加载
        setTimeout(() => this.updateVisibleTiles(), 1000);
    }
    
    /**
     * 更新可见瓦片
     */
    async updateVisibleTiles() {
        const zoom = this.getCurrentZoomLevel();
        if (zoom < this.minZoom || zoom > this.maxZoom) return;
        
        // 简化方案：加载一个基准瓦片作为地球纹理
        // 实际应该根据相机视角计算需要加载的瓦片
        await this.loadBaseTile(zoom);
    }
    
    /**
     * 获取当前缩放级别
     */
    getCurrentZoomLevel() {
        const distance = this.globe3d.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
        const zoom = Math.floor(Config.GLOBE.MAX_DISTANCE / distance);
        this.currentZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        return this.currentZoom;
    }
    
    /**
     * 加载基准瓦片（简化方案）
     * 实际应用中应该加载多个瓦片并拼接
     */
    async loadBaseTile(zoom) {
        try {
            // 尝试加载中心区域的瓦片
            const tileUrl = apiService.buildTileUrl(zoom, 0, 0);
            
            const img = await apiService.loadImage(tileUrl);
            
            // 创建 canvas 并绘制瓦片
            const canvas = document.createElement('canvas');
            canvas.width = this.tileSize * 2;
            canvas.height = this.tileSize;
            const ctx = canvas.getContext('2d');
            
            // 绘制瓦片（这里简化处理，实际应该加载多个瓦片）
            ctx.drawImage(img, 0, 0, this.tileSize, this.tileSize);
            
            // 填充剩余区域（临时方案）
            ctx.fillStyle = '#001133';
            ctx.fillRect(this.tileSize, 0, this.tileSize, this.tileSize);
            
            // 应用纹理到地球
            this.globe3d.setTexture(canvas);
            
            console.log(`✅ Loaded tile: zoom=${zoom}`);
            
        } catch (error) {
            console.warn('Failed to load tile:', error);
            // 失败时不更新纹理，保持当前显示
        }
    }
    
    /**
     * 预加载瓦片（用于提升体验）
     */
    preloadTile(z, x, y) {
        const key = `${z}/${x}/${y}`;
        if (this.tileCache.has(key)) return;
        
        const url = apiService.buildTileUrl(z, x, y);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            this.tileCache.set(key, img);
            // 清理缓存
            if (this.tileCache.size > this.maxCacheSize) {
                const firstKey = this.tileCache.keys().next().value;
                this.tileCache.delete(firstKey);
            }
        };
        img.src = url;
    }
    
    /**
     * 清除缓存
     */
    clearCache() {
        this.tileCache.clear();
    }
}
