/**
 * 主应用入口
 * 初始化所有模块并协调工作
 */
class App {
    constructor() {
        this.globe3d = null;
        this.gridSystem = null;
        this.chatAgent = null;
        this.panelManager = null;
        this.contextMenu = null;
        
        // 状态
        this.isLoading = false;
        // 搜索面板是否打开（与测量/绘制一样纳入左侧菜单容器）
        this.searchPanelOpen = false;
        // 左侧面板激活顺序：用于从左下角排布，新激活的在最下、前一个向上顶
        this.panelOrder = [];
        // 测量距离（预创建线段/标签数量，测量时只更新不新增，避免闪烁）
        this.measureMode = false;
        this.measurePoints = [];
        this.measureEntities = [];
        this.MAX_MEASURE_SEGMENTS = 20;
        // 绘制图形（三个独立模式：折线 / 矩形 / 圆）
        this.drawPolylineMode = false;
        this.drawRectMode = false;
        this.drawCircleMode = false;
        this.drawPolylineEntities = [];
        this.drawRectEntities = [];
        this.drawCircleEntities = [];
        this.drawState = { currentPolyline: [], rectFirst: null, circleCenter: null };
        this._drawPolylinePreviewEntity = null;
        
        this.init();
    }
    
    /**
     * 初始化应用
     */
    async init() {
        console.log('🚀 Initializing 3D Earth Platform...');
        
        try {
            // 瓦片源地址栏：优先从配置文件 config.json 读取 tile_server_public，否则走 /api/config，最后才用代码默认值
            const apiBase = Config.SERVER.API_SERVER || '';
            let tileFromConfig = false;
            if (apiBase) {
                try {
                    const configRes = await fetch(`${apiBase}/config.json`, { mode: 'cors' });
                    if (configRes.ok) {
                        const fileConfig = await configRes.json();
                        if (fileConfig.tile_server_public != null && fileConfig.tile_server_public !== '') {
                            Config.SERVER.TILE_SERVER = String(fileConfig.tile_server_public).trim();
                            if (fileConfig.tiles_dir != null) Config.LOCAL_TILES_PATH = fileConfig.tiles_dir;
                            if (fileConfig.api_server != null) Config.SERVER.API_SERVER = fileConfig.api_server;
                            tileFromConfig = true;
                        }
                    }
                } catch (e) { /* 忽略 */ }
                if (!tileFromConfig) {
                    try {
                        const res = await fetch(`${apiBase}/api/config`, { mode: 'cors' });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.tileServer != null) Config.SERVER.TILE_SERVER = data.tileServer;
                            if (data.localTilesPath != null) Config.LOCAL_TILES_PATH = data.localTilesPath;
                            if (data.apiServer != null) Config.SERVER.API_SERVER = data.apiServer;
                        }
                    } catch (e) { /* 离线或后端未启动时保留 Config.js 默认值 */ }
                }
            }
            const tileInput = document.getElementById('tileServerUrl');
            if (tileInput) tileInput.value = Config.SERVER.TILE_SERVER;
            
            // 1. 初始化 3D 地球（严格使用上述瓦片源地址，不可用时无底图）
            this.globe3d = new Globe3D('globe3d');
            window.globe3d = this.globe3d; // 全局访问
            
            // 2. 初始化网格系统
            this.gridSystem = new GridSystem(this.globe3d);
            
            // 3. 初始化 Agent 聊天
            this.chatAgent = new ChatAgent();
            
            // 4. 初始化面板管理
            this.panelManager = new PanelManager();
            
            // 5. 初始化右键菜单
            this.contextMenu = new ContextMenu(this.gridSystem);
            
            // 6. 绑定 UI 事件
            this.bindUIEvents();
            
            // 7. 监听系统事件
            this.setupEventListeners();
            
            // 8. 网格控制先禁用，等地图加载成功后再启用
            this.setGridControlsEnabled(false);
            
            // 9. 瓦片源连通状态 + 配置齐全时自动加载地图（失败不弹窗，仅显示状态）
            const tileBase = (Config.SERVER.TILE_SERVER || '').trim();
            if (!tileBase) {
                this.setTileSourceStatus('no-config', '未读取到瓦片地址，请检查 config.json 或后端');
            } else {
                this.setTileSourceStatus('checking');
                await this.loadServerMap(true);
            }
            
            // 10. 健康检查
            await this.healthCheck();
            
            console.log('✅ App initialized successfully');
            
        } catch (error) {
            console.error('❌ App initialization failed:', error);
            alert('应用初始化失败: ' + error.message);
        }
    }
    
    /**
     * 绑定 UI 事件
     */
    bindUIEvents() {
        // ===== 地图控制 =====
        document.getElementById('loadServerMapBtn')?.addEventListener('click', () => {
            this.loadServerMap();
        });
        this.lastConnectedTileUrl = '';
        document.getElementById('tileServerUrl')?.addEventListener('input', () => {
            this.onTileSourceInputChange();
        });
        document.getElementById('tileServerUrl')?.addEventListener('change', () => {
            this.onTileSourceInputChange();
        });
        
        // ===== 网格控制 =====
        document.getElementById('loadGridBtn')?.addEventListener('click', () => {
            this.loadSelectedGrids();
        });
        
        document.getElementById('clearGridBtn')?.addEventListener('click', () => {
            this.gridSystem.clearGrids();
            this.chatAgent.sendSystemMessage('已清除所有网格数据。');
        });
        
        document.getElementById('gridVisibility')?.addEventListener('change', (e) => {
            this.gridSystem.setVisible(e.target.checked);
        });
        
        document.getElementById('gridOpacity')?.addEventListener('input', (e) => {
            const val = e.target.value;
            const opacity = val / 100;
            this.gridSystem.setOpacity(opacity);
            const valueEl = document.getElementById('opacityValue');
            if (valueEl) valueEl.textContent = val + '%';
            e.target.setAttribute('aria-valuenow', val);
            e.target.setAttribute('aria-valuetext', val + '%');
        });
        
        // 网格右键菜单开关：关闭后右击网格不弹出菜单（未使用原编辑模式，改为控制右键功能）
        document.getElementById('editMode')?.addEventListener('change', () => {});
        
        // ===== 缩放控制 =====
        document.getElementById('zoomInBtn')?.addEventListener('click', () => {
            this.globe3d.zoom(10);
        });
        
        document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
            this.globe3d.zoom(-10);
        });
        
        document.getElementById('resetViewBtn')?.addEventListener('click', () => {
            this.globe3d.resetView();
        });
        
        // ===== 小工具（右侧按钮）：放大镜 = 显示/隐藏搜索框 =====
        document.getElementById('placeSearchBtn')?.addEventListener('click', () => {
            this.searchPanelOpen = !this.searchPanelOpen;
            this.updateToolPanelsDisplay();
            if (this.searchPanelOpen) {
                const input = document.getElementById('placeSearchInput');
                if (input) { input.value = ''; input.focus(); }
            }
        });
        document.getElementById('placeSearchDoBtn')?.addEventListener('click', () => this.searchPlace());
        document.getElementById('clearSearchMarkerBtn')?.addEventListener('click', () => this.clearSearchMarker());
        document.getElementById('placeSearchInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.searchPlace();
        });
        
        // ===== 小工具（右侧按钮）：尺子 = 测量距离 =====
        document.getElementById('measureDistanceBtn')?.addEventListener('click', () => this.toggleMeasureMode());
        document.getElementById('clearMeasureBtn')?.addEventListener('click', () => this.clearMeasure());

        // ===== 小工具：绘制（折线 / 矩形 / 圆）三个独立图标 =====
        document.getElementById('drawPolylineBtn')?.addEventListener('click', () => this.toggleDrawPolylineMode());
        document.getElementById('drawRectBtn')?.addEventListener('click', () => this.toggleDrawRectMode());
        document.getElementById('drawCircleBtn')?.addEventListener('click', () => this.toggleDrawCircleMode());
        document.getElementById('finishPolylineBtn')?.addEventListener('click', () => this.finishCurrentPolyline());
        document.getElementById('clearPolylineBtn')?.addEventListener('click', () => this.clearDrawPolyline());
        document.getElementById('clearRectBtn')?.addEventListener('click', () => this.clearDrawRect());
        document.getElementById('clearCircleBtn')?.addEventListener('click', () => this.clearDrawCircle());
    }
    
    /**
     * 设置系统事件监听
     */
    setupEventListeners() {
        // 网格加载事件
        eventBus.on('grid:load', ({ data, taskType }) => {
            this.gridSystem.loadGridData(data, taskType);
        });
        
        // 网格导入完成
        eventBus.on('grid:importComplete', ({ tasks }) => {
            // 自动选中任务选择框
            const select = document.getElementById('taskSelect');
            if (select) {
                Array.from(select.options).forEach(option => {
                    option.selected = tasks.includes(option.value);
                });
            }
        });
        
        // 地球缩放更新
        eventBus.on('globe:zoom', ({ zoom }) => {
            document.getElementById('zoomLevel').textContent = `Zoom: ${zoom.toFixed(1)}x`;
            document.getElementById('currentLevel').textContent = Math.floor(zoom);
        });
        
        // 测量距离 / 绘制图形：在地图上点击添加点或完成图形
        eventBus.on('globe:click', (e) => {
            if (this.measureMode && e && e.lat != null && e.lon != null) this.addMeasurePoint(e);
            if ((this.drawPolylineMode || this.drawRectMode || this.drawCircleMode) && e && e.lat != null && e.lon != null) this.onDrawClick(e);
        });
        
        // 网格选中/取消仅通过右键菜单操作，左键点击不改变选中状态
        // 右键菜单：用 document 捕获 contextmenu，先判断是否点到搜索标记，否则拾取网格
        const self = this;
        this._markerMenuEntity = null;
        document.addEventListener('contextmenu', function onContextMenu(e) {
            const mapContainer = document.getElementById('mapContainer');
            if (!mapContainer || !mapContainer.contains(e.target)) return;
            const viewer = self.globe3d && self.globe3d.getViewer();
            if (!viewer) return;
            const canvas = viewer.scene.canvas;
            const rect = canvas.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
            const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
            const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
            const pos = new Cesium.Cartesian2(x, y);
            const picked = viewer.scene.pick(pos);
            if (picked && picked.id && picked.id.id && String(picked.id.id).startsWith('search-marker-')) {
                e.preventDefault();
                e.stopPropagation();
                self._markerMenuEntity = picked.id;
                self.showMarkerContextMenu(e.clientX, e.clientY);
                return;
            }
            const rightClickEnabled = document.getElementById('editMode') && document.getElementById('editMode').checked;
            if (!rightClickEnabled) return;
            e.preventDefault();
            e.stopPropagation();
            if (!self.contextMenu) return;
            const grids = [];
            const drilled = viewer.scene.drillPick(pos);
            for (let i = 0; i < drilled.length; i++) {
                const obj = drilled[i];
                const entity = obj && obj.id;
                if (entity) {
                    const g = self.gridSystem.getGridByEntity(entity);
                    if (g && !grids.some(gg => gg.gridIndex === g.gridIndex && gg.taskType === g.taskType)) grids.push(g);
                }
            }
            if (grids.length === 0) {
                const pick = viewer.scene.pick(pos);
                if (pick && pick.id) {
                    const g = self.gridSystem.getGridByEntity(pick.id);
                    if (g) grids.push(g);
                }
            }
            if (grids.length > 1) {
                self.contextMenu.showGridPicker(grids, e.clientX, e.clientY);
            } else if (grids.length === 1) {
                self.contextMenu.showAt(grids[0], e.clientX, e.clientY);
            } else {
                self.contextMenu.hide();
            }
        }, true);
        document.addEventListener('click', (e) => {
            if (this.contextMenu && this.contextMenu.menu && !this.contextMenu.menu.contains(e.target)) {
                this.contextMenu.hide();
            }
            const markerMenu = document.getElementById('markerContextMenu');
            if (markerMenu && markerMenu.contains(e.target)) {
                const item = e.target.closest('.context-item[data-action="remove-marker"]');
                if (item && this._markerMenuEntity) {
                    const viewer = this.globe3d && this.globe3d.getViewer();
                    if (viewer) viewer.entities.remove(this._markerMenuEntity);
                    this._markerMenuEntity = null;
                    markerMenu.style.display = 'none';
                }
            } else if (markerMenu && !markerMenu.contains(e.target)) {
                markerMenu.style.display = 'none';
                this._markerMenuEntity = null;
            }
        });
    }
    
    /**
     * 健康检查
     */
    async healthCheck() {
        const status = await apiService.healthCheck();
        const statusEl = document.getElementById('connectionStatus');
        
        const textEl = document.getElementById('connectionStatusText');
        if (status.status === 'ok') {
            if (textEl) textEl.textContent = 'Online';
            statusEl.className = 'status-online';
            console.log('✅ Backend connected');
        } else {
            if (textEl) textEl.textContent = 'Offline';
            statusEl.className = 'status-offline';
            console.warn('⚠️ Backend disconnected');
        }
    }
    
    /**
     * 加载服务器地图
     * 依次尝试多个常见瓦片路径，并区分「服务未启动」与「瓦片文件不存在」
     * @param {boolean} silent - true 时失败不弹 alert（用于初始化自动加载）
     */
    async loadServerMap(silent = false) {
        let raw = document.getElementById('tileServerUrl').value.trim();
        raw = raw.replace(/\/Tiles\//gi, '/tiles/').replace(/\/Tiles$/gi, '/tiles').replace(/\/$/, '');
        // 补全为完整地址：仅端口→127.0.0.1；IP:端口 或 域名:端口→加 http（局域网请直接填 IP，如 192.168.1.100:9001）
        if (/^\d+$/.test(raw)) {
            raw = `http://127.0.0.1:${raw}`;
        } else if (/^(localhost|127\.0\.0\.1):\d+$/i.test(raw)) {
            raw = `http://${raw}`;
        } else if (/^[\w.-]+:\d+$/i.test(raw)) {
            raw = `http://${raw}`;
        } else if (!/^https?:\/\//i.test(raw) && raw) {
            raw = `http://${raw}`;
        }
        const base = raw;
        Config.SERVER.TILE_SERVER = base;
        apiService.tileBaseUrl = base;
        const tileInput = document.getElementById('tileServerUrl');
        if (tileInput) tileInput.value = base;

        this.setTileSourceStatus('checking');
        this.showLoading(true);

        const testPaths = ['1/0/0.jpg', '0/0/0.jpg', '1/0/0.png', '0/0/0.png'];

        try {
            let lastStatus = 0;
            let resolved = false;

            for (const path of testPaths) {
                const testUrl = `${base}/${path}`;
                try {
                    // 禁用缓存，避免用旧地址(如 9002)的缓存 200 误判当前地址(如 9001)连通
                    const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
                    lastStatus = res.status;
                    if (res.ok) {
                        // 若发生重定向，res.url 为最终 URL，可与 base 对比排查「填 9001 却连上 9002」等问题
                        const actualUrl = (res.url || testUrl).replace(/\/[^/]+$/, '');
                        if (actualUrl !== base.replace(/\/$/, '')) {
                            console.warn('⚠️ 瓦片请求被重定向：请求', base, '→ 实际', actualUrl);
                            this.chatAgent.sendSystemMessage('⚠️ 注意：请求的地址被重定向到 ' + actualUrl + '，请确认端口是否正确。');
                        }
                        // 真实拉一张图，避免仅 HEAD 被缓存导致误判；先带时间戳绕过缓存，失败则再试不带参数（兼容部分服务对 ? 处理异常）
                        try {
                            const imgTestUrl = testUrl + (testUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
                            await apiService.loadImage(imgTestUrl);
                        } catch (e1) {
                        await apiService.loadImage(testUrl);
                        }
                        try {
                            this.globe3d.setImageryFromTileServer(base, {
                                onRepeatedErrors: (failedBase) => {
                                    if (this.lastConnectedTileUrl !== failedBase) return;
                                    this.setTileSourceStatus('disconnected', '瓦片请求被拒绝，请检查端口与服务');
                                    this.globe3d.setImageryToNoService();
                                    this.setGridControlsEnabled(false);
                                    this.lastConnectedTileUrl = '';
                                    this.chatAgent.sendSystemMessage('❌ 检测到当前瓦片源 ' + failedBase + ' 请求被拒绝，已切换为未连通并清除底图，请检查端口或服务。');
                                }
                            });
                            this.chatAgent.sendSystemMessage('✅ 地图服务连接成功！已切换为本地瓦片。当前瓦片源：' + base);
                        } catch (e) {
                            this.chatAgent.sendSystemMessage('✅ 地图服务连接成功！若未切换底图请刷新页面。当前瓦片源：' + base);
                        }
                        console.log('✅ Tile server connected:', base, res.url ? '(实际响应 URL: ' + res.url + ')' : '');
                        resolved = true;
                        this.setGridControlsEnabled(true);
                        this.setTileSourceStatus('connected');
                        this.lastConnectedTileUrl = base;
                        break;
                    }
                } catch (e) {
                    if (e.message && e.message.includes('Failed to load')) continue;
                    lastStatus = 'network';
                    break;
                }
            }

            if (!resolved) {
                this.globe3d.setImageryToNoService();
                this.setGridControlsEnabled(false);
                this.setTileSourceStatus('disconnected', '请检查地址、端口及 map 服务是否已启动');
                const failedUrl = base;
                const connectivityTip = '【连通提示】瓦片源地址不通：' + failedUrl + '\n请检查地址、IP、端口及地图服务是否已启动，详见右侧说明。';
                if (lastStatus === 'network' || lastStatus === 0) {
                    this.chatAgent.sendSystemMessage(
                        '❌ 连接失败：地图服务未启动或无法访问。\n\n' +
                        '当前瓦片源地址：' + failedUrl + '\n\n' +
                        '请检查：\n' +
                        '1. 地图服务地址、IP、端口是否正确（config.json 中 tile_server_public / tile_service_url）\n' +
                        '2. 已运行 map 服务（如 start.bat 或 cd map 后执行 python server.py）\n' +
                        '3. 瓦片目录及 z/x/y 瓦片文件是否存在'
                    );
                    if (!silent) alert(connectivityTip);
                } else {
                    this.chatAgent.sendSystemMessage(
                        '❌ 连接失败：服务已通但瓦片文件不存在。\n\n' +
                        '当前瓦片源地址：' + failedUrl + '\n\n' +
                        '请检查：\n' +
                        '1. 地图服务地址、IP、端口是否正确\n' +
                        '2. 瓦片目录（config.json 中 tiles_dir）下是否有按 z/x/y 组织的文件，例如：\n' +
                        '   1/0/0.jpg 或 0/0/0.png'
                    );
                    if (!silent) alert(connectivityTip);
                }
            }
        } catch (error) {
            this.globe3d.setImageryToNoService();
            this.setGridControlsEnabled(false);
            this.setTileSourceStatus('disconnected', error.message || '请求异常');
            const base = Config.SERVER.TILE_SERVER || '';
            this.chatAgent.sendSystemMessage(
                '❌ 连接失败：' + error.message + '\n\n' +
                '当前瓦片源地址：' + base + '\n' +
                '请检查地图服务地址、IP、端口及瓦片文件。'
            );
            if (!silent) alert('【连通提示】瓦片源地址不通：' + base + '\n请检查地址、IP、端口及地图服务，详见右侧说明。');
            console.error('Tile server connection failed:', error);
        } finally {
            this.showLoading(false);
        }
    }
    
    
    /**
     * 加载选中的网格（与 DA_Interface 一致：先请求 task1/task2/task3/group 四类，再按键解析）
     * 初始网格来自 task1 文件的 initGrid 键，不读单独文件。
     */
    async loadSelectedGrids() {
        const select = document.getElementById('taskSelect');
        const selectedOptions = Array.from(select.selectedOptions).map(o => o.value);
        
        if (selectedOptions.length === 0) {
            alert('请至少选择一个任务类型');
            return;
        }
        
        this.showLoading(true);
        
        try {
            const allGridData = await apiService.getGridDataLikeDA();
            
            selectedOptions.forEach((taskType) => {
                if (taskType === 'groups') return; // 分组为 platformGridMaps 结构，不按网格点绘制
                const arr = allGridData[taskType];
                if (arr && arr.length > 0) {
                    eventBus.emit('grid:load', { data: allGridData, taskType });
                }
            });
            
            this.chatAgent.sendSystemMessage(
                `✅ 已加载 ${selectedOptions.length} 类网格数据`
            );
            
        } catch (error) {
            console.error('Load grids failed:', error);
            alert('加载网格失败: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    /**
     * 瓦片源地址栏变更时：若与上次连通地址不一致，清除「已连通」避免误导
     */
    onTileSourceInputChange() {
        const input = document.getElementById('tileServerUrl');
        if (!input || !this.lastConnectedTileUrl) return;
        let raw = input.value.trim().replace(/\/$/, '');
        if (/^\d+$/.test(raw)) raw = `http://127.0.0.1:${raw}`;
        else if (raw && !/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
        if (raw && raw !== this.lastConnectedTileUrl) {
            this.setTileSourceStatus('address-changed', '请点击加载以检查当前地址');
        }
    }

    /**
     * 瓦片源下方连通状态：checking | connected | disconnected | no-config | address-changed
     */
    setTileSourceStatus(status, message = '') {
        const el = document.getElementById('tileSourceStatus');
        const textEl = document.getElementById('tileSourceStatusText');
        if (!el || !textEl) return;
        el.className = 'tile-source-status ' + status;
        const dot = '<span class="status-dot"></span>';
        const messages = {
            checking: dot + ' 检查中...',
            connected: dot + ' 已连通',
            disconnected: dot + ' 未连通',
            'no-config': dot + ' ' + (message || '未读取到瓦片地址，请检查 config.json 或后端'),
            'address-changed': dot + ' ' + (message || '地址已变更，请点击加载')
        };
        textEl.innerHTML = messages[status] || '';
    }

    /**
     * 解析输入是否为经纬度（支持 "纬度,经度" 或 "39.9 116.4" 等），直接定位无需联网
     * @returns {{ lat: number, lon: number } | null}
     */
    parseCoordinates(inputStr) {
        const s = inputStr.trim().replace(/[°，、\s]+/g, ' ').trim();
        const parts = s.split(/\s+/);
        if (parts.length < 2) {
            const comma = s.split(',');
            if (comma.length >= 2) {
                const a = parseFloat(comma[0].trim());
                const b = parseFloat(comma[1].trim());
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return { lat: a, lon: b };
                    if (b >= -90 && b <= 90 && a >= -180 && a <= 180) return { lat: b, lon: a };
                }
            }
            return null;
        }
        const a = parseFloat(parts[0]);
        const b = parseFloat(parts[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return { lat: a, lon: b };
        if (b >= -90 && b <= 90 && a >= -180 && a <= 180) return { lat: b, lon: a };
        return null;
    }

    /**
     * 在指定经纬度添加一个搜索标记（可多次搜索，标记累加）
     */
    setSearchMarker(lat, lon) {
        const viewer = this.globe3d.getViewer();
        if (!viewer) return;
        const id = 'search-marker-' + Date.now();
        viewer.entities.add({
            id: id,
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: {
                pixelSize: 14,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2
            }
        });
    }

    /**
     * 显示搜索标记的右键菜单（仅「取消」一项）
     */
    showMarkerContextMenu(clientX, clientY) {
        const menu = document.getElementById('markerContextMenu');
        if (!menu) return;
        const w = 100;
        const h = 40;
        let left = clientX + 4;
        let top = clientY + 4;
        if (left + w > window.innerWidth) left = clientX - w - 4;
        if (top + h > window.innerHeight) top = clientY - h - 4;
        if (left < 4) left = 4;
        if (top < 4) top = 4;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.display = 'block';
    }

    /**
     * 一键清除全部搜索标记（搜索框内「清除标记」按钮）
     */
    clearSearchMarker() {
        const viewer = this.globe3d.getViewer();
        if (!viewer) return;
        const toRemove = [];
        viewer.entities.values.forEach((entity) => {
            if (entity.id && String(entity.id).startsWith('search-marker-')) toRemove.push(entity);
        });
        toRemove.forEach((e) => viewer.entities.remove(e));
        const hint = document.getElementById('placeSearchHint');
        if (hint) hint.textContent = toRemove.length > 0 ? `已清除 ${toRemove.length} 个标记` : '当前无标记';
    }

    /**
     * 小工具：搜索 = 仅支持经纬度，直接定位（无需联网）
     */
    searchPlace() {
        const input = document.getElementById('placeSearchInput');
        const hint = document.getElementById('placeSearchHint');
        const q = (input && input.value.trim()) || '';
        if (!q) {
            if (hint) hint.textContent = '请输入经纬度（如 39.9, 116.4）';
            return;
        }
        const coords = this.parseCoordinates(q);
        if (coords) {
            this.globe3d.flyTo(coords.lat, coords.lon, 0.8);
            this.setSearchMarker(coords.lat, coords.lon);
            if (hint) hint.textContent = `已定位并添加标记 ${coords.lat.toFixed(5)}°, ${coords.lon.toFixed(5)}°`;
        } else {
            if (hint) hint.textContent = '无法解析，请输入经纬度（如 39.9, 116.4）';
        }
    }

    /**
     * 小工具：测量距离 - 切换测量模式
     * 进入测量时预创建线段/标签实体（隐藏），后续只更新不新增，避免第一段、第二段出现闪烁
     */
    toggleMeasureMode() {
        this.measureMode = !this.measureMode;
        if (this.measureMode) {
            this._exitAllDrawModes();
            this.ensureMeasureSegmentEntities();
            this.updateMeasureResult();
        } else this.clearMeasure();
        this.updateToolPanelsDisplay();
    }

    /**
     * 预创建测量用线段与标签实体（初始隐藏），避免首次创建时闪烁
     */
    ensureMeasureSegmentEntities() {
        const viewer = this.globe3d.getViewer();
        if (!viewer) return;
        const zero = Cesium.Cartesian3.ZERO;
        const labelStyle = {
            font: 'bold 15px sans-serif',
            fillColor: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12)
        };
        for (let i = 0; i < this.MAX_MEASURE_SEGMENTS; i++) {
            if (viewer.entities.getById('measure-segment-' + i)) continue;
            viewer.entities.add({
                id: 'measure-segment-' + i,
                show: false,
                polyline: {
                    positions: [zero, zero],
                    width: 3,
                    material: Cesium.Color.CYAN,
                    arcType: Cesium.ArcType.GEODESIC
                }
            });
            viewer.entities.add({
                id: 'measure-label-' + i,
                show: false,
                position: zero,
                label: { text: '', ...labelStyle }
            });
        }
    }

    /**
     * 测量：添加一个点并更新折线与总距离
     */
    addMeasurePoint(e) {
        const viewer = this.globe3d.getViewer();
        if (!viewer || !e.point) return;
        const cartesian = e.point;
        this.measurePoints.push({ lat: e.lat, lon: e.lon, cartesian: Cesium.Cartesian3.clone(cartesian) });
        const color = Cesium.Color.CYAN;
        this.measureEntities.push(viewer.entities.add({
            position: cartesian,
            point: { pixelSize: 10, color: color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }
        }));
        this.updateMeasureResult();
    }

    /**
     * 测量：按「每两点一段」绘制线段（第三点不与第二点相连），在每段中点显示该段距离
     * 段为 (0,1)、(2,3)、(4,5)…。仅更新预创建的实体（位置/显示），不新增不删除，避免闪烁。
     */
    updateMeasureResult() {
        const viewer = this.globe3d.getViewer();
        const resultEl = document.getElementById('measureResult');
        if (!viewer || !resultEl) return;
        this.ensureMeasureSegmentEntities();
        const ellipsoid = Cesium.Ellipsoid.WGS84;
        const segmentCount = this.measurePoints.length >= 2 ? Math.floor(this.measurePoints.length / 2) : 0;

        let totalMeters = 0;
        for (let i = 0; i + 1 < this.measurePoints.length; i += 2) {
            const c1 = Cesium.Cartographic.fromCartesian(this.measurePoints[i].cartesian, ellipsoid);
            const c2 = Cesium.Cartographic.fromCartesian(this.measurePoints[i + 1].cartesian, ellipsoid);
            const geo = new Cesium.EllipsoidGeodesic();
            geo.setEndPoints(c1, c2);
            const segMeters = geo.surfaceDistance;
            totalMeters += segMeters;
            const segKm = (segMeters / 1000).toFixed(3);
            const segIndex = i / 2;
            const positions = [this.measurePoints[i].cartesian, this.measurePoints[i + 1].cartesian];
            const midCarto = geo.interpolateUsingFraction(0.5);
            const midCartesian = Cesium.Cartesian3.fromRadians(midCarto.longitude, midCarto.latitude, midCarto.height || 0);

            const lineEntity = viewer.entities.getById('measure-segment-' + segIndex);
            const labelEntity = viewer.entities.getById('measure-label-' + segIndex);
            if (lineEntity) {
                lineEntity.show = true;
                lineEntity.polyline.positions = positions;
            }
            if (labelEntity) {
                labelEntity.show = true;
                labelEntity.position = midCartesian;
                labelEntity.label.text = segKm + ' km';
            }
        }
        // 未使用的线段与标签保持隐藏
        for (let j = segmentCount; j < this.MAX_MEASURE_SEGMENTS; j++) {
            const lineEntity = viewer.entities.getById('measure-segment-' + j);
            const labelEntity = viewer.entities.getById('measure-label-' + j);
            if (lineEntity) lineEntity.show = false;
            if (labelEntity) labelEntity.show = false;
        }

        const km = (totalMeters / 1000).toFixed(3);
        resultEl.textContent = this.measurePoints.length < 2
            ? (this.measurePoints.length === 0 ? '点击地图添加点' : `已添加 1 个点，再点一个显示距离`)
            : `总距离: ${km} km`;
    }

    /**
     * 测量：清除所有点、线段及中点标签
     */
    clearMeasure() {
        const viewer = this.globe3d.getViewer();
        if (viewer) {
            this.measureEntities.forEach(e => { try { viewer.entities.remove(e); } catch (err) {} });
            const toRemove = [];
            viewer.entities.values.forEach((entity) => {
                const id = entity.id && String(entity.id);
                if (id && (id.startsWith('measure-segment-') || id.startsWith('measure-label-'))) toRemove.push(entity);
            });
            toRemove.forEach((e) => viewer.entities.remove(e));
        }
        this.measureEntities = [];
        this.measurePoints = [];
        const resultEl = document.getElementById('measureResult');
        if (resultEl) resultEl.textContent = '点击地图添加点';
    }

    /** 统一更新面板显示、按钮 active，并按激活顺序从左下角排布（新激活在最下，前面的向上顶） */
    updateToolPanelsDisplay() {
        document.getElementById('placeSearchBtn')?.classList.toggle('active', this.searchPanelOpen);
        document.getElementById('measureDistanceBtn')?.classList.toggle('active', this.measureMode);
        document.getElementById('drawPolylineBtn')?.classList.toggle('active', this.drawPolylineMode);
        document.getElementById('drawRectBtn')?.classList.toggle('active', this.drawRectMode);
        document.getElementById('drawCircleBtn')?.classList.toggle('active', this.drawCircleMode);

        const panels = [
            { key: 'search', el: document.getElementById('searchFloatBox'), on: this.searchPanelOpen },
            { key: 'measure', el: document.getElementById('measureFloatBox'), on: this.measureMode },
            { key: 'polyline', el: document.getElementById('drawPolylineFloatBox'), on: this.drawPolylineMode },
            { key: 'rect', el: document.getElementById('drawRectFloatBox'), on: this.drawRectMode },
            { key: 'circle', el: document.getElementById('drawCircleFloatBox'), on: this.drawCircleMode }
        ];
        let nextOrder = this.panelOrder.filter(k => panels.some(p => p.key === k && p.on));
        panels.forEach(({ key, el, on }) => {
            if (!el) return;
            el.style.display = on ? 'flex' : 'none';
            if (on && !nextOrder.includes(key)) nextOrder.push(key);
        });
        this.panelOrder = nextOrder;

        const container = document.querySelector('.tool-panels-container');
        if (container && this.panelOrder.length) {
            const orderMap = {};
            this.panelOrder.forEach((k, i) => { orderMap[k] = i; });
            const panelEls = panels.filter(p => p.el).map(p => ({ key: p.key, el: p.el }));
            panelEls.sort((a, b) => (orderMap[a.key] ?? 999) - (orderMap[b.key] ?? 999));
            panelEls.forEach(({ el }) => container.appendChild(el));
        }
    }

    /** 测量与绘制互斥：测量、折线、矩形、圆只能同时激活一个 */
    _exitAllDrawModes() {
        if (this.drawPolylineMode) { this.drawPolylineMode = false; this.clearDrawPolyline(); }
        if (this.drawRectMode) { this.drawRectMode = false; this.clearDrawRect(); }
        if (this.drawCircleMode) { this.drawCircleMode = false; this.clearDrawCircle(); }
        this.drawState.currentPolyline = [];
        this.drawState.rectFirst = null;
        this.drawState.circleCenter = null;
    }
    _exitMeasureAndOtherDrawModesExceptPolyline() {
        if (this.measureMode) { this.measureMode = false; this.clearMeasure(); }
        if (this.drawRectMode) { this.drawRectMode = false; this.clearDrawRect(); }
        if (this.drawCircleMode) { this.drawCircleMode = false; this.clearDrawCircle(); }
        this.drawState.rectFirst = null;
        this.drawState.circleCenter = null;
    }
    _exitMeasureAndOtherDrawModesExceptRect() {
        if (this.measureMode) { this.measureMode = false; this.clearMeasure(); }
        if (this.drawPolylineMode) { this.drawPolylineMode = false; this.clearDrawPolyline(); }
        if (this.drawCircleMode) { this.drawCircleMode = false; this.clearDrawCircle(); }
        this.drawState.currentPolyline = [];
        this.drawState.circleCenter = null;
    }
    _exitMeasureAndOtherDrawModesExceptCircle() {
        if (this.measureMode) { this.measureMode = false; this.clearMeasure(); }
        if (this.drawPolylineMode) { this.drawPolylineMode = false; this.clearDrawPolyline(); }
        if (this.drawRectMode) { this.drawRectMode = false; this.clearDrawRect(); }
        this.drawState.currentPolyline = [];
        this.drawState.rectFirst = null;
    }

    toggleDrawPolylineMode() {
        this.drawPolylineMode = !this.drawPolylineMode;
        if (this.drawPolylineMode) this._exitMeasureAndOtherDrawModesExceptPolyline();
        else this.clearDrawPolyline();
        this.updateDrawPolylineHint();
        this.updateToolPanelsDisplay();
    }

    toggleDrawRectMode() {
        this.drawRectMode = !this.drawRectMode;
        if (this.drawRectMode) this._exitMeasureAndOtherDrawModesExceptRect();
        else this.clearDrawRect();
        this.updateDrawRectHint();
        this.updateToolPanelsDisplay();
    }

    toggleDrawCircleMode() {
        this.drawCircleMode = !this.drawCircleMode;
        if (this.drawCircleMode) this._exitMeasureAndOtherDrawModesExceptCircle();
        else this.clearDrawCircle();
        this.updateDrawCircleHint();
        this.updateToolPanelsDisplay();
    }

    /**
     * 绘制：地图点击处理（折线加点并实时连线 / 矩形两点 / 圆圆心+半径）
     */
    onDrawClick(e) {
        const viewer = this.globe3d.getViewer();
        if (!viewer || !e.point) return;
        const { lat, lon, point: cartesian } = e;

        if (this.drawPolylineMode) {
            this.drawState.currentPolyline.push({ lat, lon, cartesian: Cesium.Cartesian3.clone(cartesian) });
            const color = Cesium.Color.ORANGE;
            this.drawPolylineEntities.push(viewer.entities.add({
                position: cartesian,
                point: { pixelSize: 8, color: color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 }
            }));
            this._updatePolylinePreview(viewer);
            this.updateDrawPolylineHint();
            return;
        }

        if (this.drawRectMode) {
            if (!this.drawState.rectFirst) {
                this.drawState.rectFirst = { lat, lon, cartesian: Cesium.Cartesian3.clone(cartesian) };
                this.updateDrawRectHint();
                return;
            }
            const first = this.drawState.rectFirst;
            const west = Math.min(first.lon, lon) * (Math.PI / 180);
            const south = Math.min(first.lat, lat) * (Math.PI / 180);
            const east = Math.max(first.lon, lon) * (Math.PI / 180);
            const north = Math.max(first.lat, lat) * (Math.PI / 180);
            const rect = Cesium.Rectangle.fromRadians(west, south, east, north);
            this.drawRectEntities.push(viewer.entities.add({
                rectangle: {
                    coordinates: rect,
                    fill: false,
                    outline: true,
                    outlineColor: Cesium.Color.ORANGE,
                    outlineWidth: 2
                }
            }));
            this.drawState.rectFirst = null;
            this.updateDrawRectHint();
            return;
        }

        if (this.drawCircleMode) {
            if (!this.drawState.circleCenter) {
                this.drawState.circleCenter = { lat, lon, cartesian: Cesium.Cartesian3.clone(cartesian) };
                this.updateDrawCircleHint();
                return;
            }
            const ellipsoid = Cesium.Ellipsoid.WGS84;
            const c1 = Cesium.Cartographic.fromCartesian(this.drawState.circleCenter.cartesian, ellipsoid);
            const c2 = Cesium.Cartographic.fromCartesian(cartesian, ellipsoid);
            const geo = new Cesium.EllipsoidGeodesic();
            geo.setEndPoints(c1, c2);
            const radius = geo.surfaceDistance;
            const center = this.drawState.circleCenter.cartesian;
            this.drawCircleEntities.push(viewer.entities.add({
                position: center,
                ellipse: {
                    semiMajorAxis: radius,
                    semiMinorAxis: radius,
                    fill: false,
                    outline: true,
                    outlineColor: Cesium.Color.ORANGE,
                    outlineWidth: 2
                }
            }));
            this.drawState.circleCenter = null;
            this.updateDrawCircleHint();
            return;
        }
    }

    /** 折线：实时更新“上一点与下一点连线”的预览线段 */
    _updatePolylinePreview(viewer) {
        const points = this.drawState.currentPolyline;
        if (points.length < 2) {
            if (this._drawPolylinePreviewEntity) {
                try { viewer.entities.remove(this._drawPolylinePreviewEntity); } catch (err) {}
                this._drawPolylinePreviewEntity = null;
            }
            return;
        }
        const positions = points.map(p => p.cartesian);
        if (this._drawPolylinePreviewEntity) {
            this._drawPolylinePreviewEntity.polyline.positions = positions;
        } else {
            this._drawPolylinePreviewEntity = viewer.entities.add({
                id: 'draw-polyline-preview',
                polyline: {
                    positions: positions,
                    width: 2,
                    material: Cesium.Color.ORANGE,
                    arcType: Cesium.ArcType.GEODESIC
                }
            });
        }
    }

    /**
     * 绘制：完成当前折线（保留连线），开始可画下一段
     */
    finishCurrentPolyline() {
        const viewer = this.globe3d.getViewer();
        const points = this.drawState.currentPolyline;
        if (!viewer || points.length < 2) return;
        const positions = points.map(p => p.cartesian);
        if (this._drawPolylinePreviewEntity) {
            try { viewer.entities.remove(this._drawPolylinePreviewEntity); } catch (err) {}
            this._drawPolylinePreviewEntity = null;
        }
        const n = points.length;
        const toRemove = this.drawPolylineEntities.splice(this.drawPolylineEntities.length - n, n);
        toRemove.forEach(e => { try { viewer.entities.remove(e); } catch (err) {} });
        this.drawPolylineEntities.push(viewer.entities.add({
            polyline: {
                positions: positions,
                width: 2,
                material: Cesium.Color.ORANGE,
                arcType: Cesium.ArcType.GEODESIC
            }
        }));
        this.drawState.currentPolyline = [];
        this.updateDrawPolylineHint();
    }

    /** 清除折线（含未完成点与预览线） */
    clearDrawPolyline() {
        const viewer = this.globe3d.getViewer();
        if (viewer) {
            this.drawPolylineEntities.forEach(e => { try { viewer.entities.remove(e); } catch (err) {} });
            if (this._drawPolylinePreviewEntity) {
                try { viewer.entities.remove(this._drawPolylinePreviewEntity); } catch (err) {}
                this._drawPolylinePreviewEntity = null;
            }
        }
        this.drawPolylineEntities = [];
        this.drawState.currentPolyline = [];
        this.updateDrawPolylineHint();
    }

    /** 清除矩形 */
    clearDrawRect() {
        const viewer = this.globe3d.getViewer();
        if (viewer) this.drawRectEntities.forEach(e => { try { viewer.entities.remove(e); } catch (err) {} });
        this.drawRectEntities = [];
        this.drawState.rectFirst = null;
        this.updateDrawRectHint();
    }

    /** 清除圆 */
    clearDrawCircle() {
        const viewer = this.globe3d.getViewer();
        if (viewer) this.drawCircleEntities.forEach(e => { try { viewer.entities.remove(e); } catch (err) {} });
        this.drawCircleEntities = [];
        this.drawState.circleCenter = null;
        this.updateDrawCircleHint();
    }

    updateDrawPolylineHint() {
        const el = document.getElementById('drawPolylineHint');
        if (!el) return;
        const n = this.drawState.currentPolyline.length;
        el.textContent = n === 0 ? '点击地图添加折线点（点与点自动连线），完成后点「完成当前折线」' : `当前折线 ${n} 个点，继续点击或完成当前折线`;
    }

    updateDrawRectHint() {
        const el = document.getElementById('drawRectHint');
        if (!el) return;
        el.textContent = this.drawState.rectFirst ? '再点击一个角完成矩形' : '点击地图两个对角绘制矩形';
    }

    updateDrawCircleHint() {
        const el = document.getElementById('drawCircleHint');
        if (!el) return;
        el.textContent = this.drawState.circleCenter ? '再点击一点作为圆上点（确定半径）' : '点击地图确定圆心，再点击确定半径';
    }

    /**
     * 地图未加载好时禁用网格相关控制；地图加载成功后再启用
     */
    setGridControlsEnabled(enabled) {
        const section = document.getElementById('gridControlSection');
        if (section) {
            section.classList.toggle('grid-disabled', !enabled);
        }
        const ids = ['taskSelect', 'loadGridBtn', 'clearGridBtn', 'gridVisibility', 'editMode', 'gridOpacity'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });
    }
    
    /**
     * 显示/隐藏加载指示器
     */
    showLoading(show) {
        const loader = document.getElementById('loadingIndicator');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
        this.isLoading = show;
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
