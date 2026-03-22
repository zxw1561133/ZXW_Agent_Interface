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
        // Agent 保存轮询：检测后端网格文件变更后自动刷新并提示
        this._gridLastUpdate = null;
        this._gridSavePollingId = null;
        // 任务区域拖动：左键按住高亮任务区域拖动，松开后确认浮层
        this._taskAreaDrag = null;
        this._taskAreaConfirmOverlay = null;
        /** 前端刚发送任务区域保存聊天消息的时间戳，SSE 刷新时若在 5 秒内则不再发重复消息，保证每条消息独立且不重复 */
        this._lastTaskAreaChatSentAt = 0;
        /** 任务区域确认流程：请求端下发后等待用户 接收/不接受或需要修改；若需要修改则等待 已修改完毕。{ choice: boolean, modificationDone: boolean } */
        this._pendingTaskAreaConfirm = null;
        
        this.init();
    }
    
    /**
     * 初始化应用
     */
    async init() {
        console.log('🚀 Initializing DA智能体系统...');
        
        try {
            // 瓦片源：优先 config.json 的 tile_server_public，其次 /api/config，否则使用代码默认值
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
                } catch (e) { /* 静默忽略配置读取异常 */ }
                if (!tileFromConfig) {
                    try {
                        const res = await fetch(`${apiBase}/api/config`, { mode: 'cors' });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.tileServer != null) Config.SERVER.TILE_SERVER = data.tileServer;
                            if (data.localTilesPath != null) Config.LOCAL_TILES_PATH = data.localTilesPath;
                            if (data.apiServer != null) Config.SERVER.API_SERVER = data.apiServer;
                        }
                    } catch (e) { /* 离线或后端未响应时保留默认配置 */ }
                }
            }
            const tileInput = document.getElementById('tileServerUrl');
            if (tileInput) tileInput.value = Config.SERVER.TILE_SERVER;
            
            // 初始化 3D 地球（使用上述瓦片源，不可用时无底图）
            this.globe3d = new Globe3D('globe3d');
            window.globe3d = this.globe3d; // 供全局引用
            
            this.gridSystem = new GridSystem(this.globe3d);
            this.chatAgent = new ChatAgent(this);
            this.panelManager = new PanelManager();
            this.contextMenu = new ContextMenu(this.gridSystem);
            // 绑定 UI 事件
            this.bindUIEvents();
            // 绑定菜单栏
            this.bindMenuEvents();
            // 监听系统事件
            this.setupEventListeners();
            // 订阅 SSE：仅在 POST 保存后推送一次，前端据此刷新，调用一次修改一次
            this.startGridSaveSSE();
            
            // 地图未加载前禁用网格控制，加载成功后再启用
            this.setGridControlsEnabled(false);
            // 配置齐全时自动加载地图；失败仅更新状态，不弹窗
            const tileBase = (Config.SERVER.TILE_SERVER || '').trim();
            if (!tileBase) {
                this.setTileSourceStatus('no-config', '未读取到瓦片地址，请检查 config.json 或后端');
            } else {
                this.setTileSourceStatus('checking');
                await this.loadServerMap(true);
            }
            
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
        // 地图控制
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
        document.getElementById('loadRoadMapBtn')?.addEventListener('click', () => {
            this.loadRoadTileSource();
        });
        document.getElementById('loadElevationBtn')?.addEventListener('click', () => {
            this.loadElevationSource();
        });

        // 网格控制
        document.getElementById('loadGridBtn')?.addEventListener('click', () => {
            this.loadSelectedGrids();
        });
        
        document.getElementById('clearGridBtn')?.addEventListener('click', () => {
            this.gridSystem.setPreferenceHighlight(null);
            this.gridSystem.clearGrids();
            this.updateTask3PreferenceLegend(null);
            this.chatAgent.sendSystemMessage('已清除所有网格数据。');
        });

        const taskSelectList = document.getElementById('taskSelectList');
        if (taskSelectList) {
            taskSelectList.addEventListener('click', (e) => {
                const row = e.target.closest('.task-select-row');
                if (!row || e.target.classList.contains('task-select-show')) return;
                const selected = !row.classList.contains('selected');
                row.classList.toggle('selected', selected);
                row.setAttribute('aria-selected', selected);
            });
            taskSelectList.addEventListener('change', (e) => {
                if (!e.target.classList.contains('task-select-show')) return;
                const row = e.target.closest('.task-select-row');
                if (!row || !this.gridSystem) return;
                const taskType = row.getAttribute('data-task-type');
                this.gridSystem.setVisibleByTaskType(taskType, e.target.checked);
            });
        }
        
        document.getElementById('gridVisibility')?.addEventListener('change', (e) => {
            this.gridSystem.setVisible(e.target.checked);
        });
        
        document.getElementById('preferenceDisplay')?.addEventListener('change', (e) => {
            const checked = e.target.checked;
            this.gridSystem.setPreferenceDisplayEnabled(checked);
            const wrap = document.getElementById('task3PreferenceLegendWrap');
            const container = document.getElementById('task3PreferenceLegend');
            if (wrap && container) {
                wrap.style.display = (checked && container.children.length > 0) ? 'flex' : 'none';
            }
        });

        document.getElementById('channelDisplay')?.addEventListener('change', (e) => {
            this.gridSystem.setChannelDisplayEnabled(e.target.checked);
        });
        document.getElementById('taskAreaDisplay')?.addEventListener('change', (e) => {
            this.gridSystem.setTaskAreaDisplayEnabled(e.target.checked);
        });
        
        document.getElementById('gridOpacity')?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            // 透明度 0 = 不透明(可见)，100 = 完全透明(不可见)，传入的 opacity 为不透明度
            const opacity = 1 - val / 100;
            this.gridSystem.setOpacity(opacity);
            const valueEl = document.getElementById('opacityValue');
            if (valueEl) valueEl.textContent = val + '%';
            e.target.setAttribute('aria-valuenow', val);
            e.target.setAttribute('aria-valuetext', val + '%');
        });

        document.getElementById('groupMembersDisplay')?.addEventListener('change', (e) => {
            if (e.target.checked) this.showGroupMembersModal();
        });
        const groupMembersModal = document.getElementById('groupMembersModal');
        if (groupMembersModal) {
            const uncheckGroupMembers = () => {
                groupMembersModal.hidden = true;
                const cb = document.getElementById('groupMembersDisplay');
                if (cb) cb.checked = false;
            };
            groupMembersModal.querySelector('.group-members-modal-close')?.addEventListener('click', uncheckGroupMembers);
            groupMembersModal.querySelector('.group-members-modal-backdrop')?.addEventListener('click', uncheckGroupMembers);
        }

        // 网格右键菜单开关：关闭后右击网格不弹出菜单
        document.getElementById('editMode')?.addEventListener('change', () => {});
        
        // 缩放控制：一级一级放大/缩小
        document.getElementById('zoomInBtn')?.addEventListener('click', () => {
            this.globe3d.zoom(1);
        });
        
        document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
            this.globe3d.zoom(-1);
        });
        
        document.getElementById('resetViewBtn')?.addEventListener('click', () => {
            this.globe3d.resetView();
        });

        // 小工具：搜索（显示/隐藏搜索框）
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
        
        // 小工具：测量距离
        document.getElementById('measureDistanceBtn')?.addEventListener('click', () => this.toggleMeasureMode());
        document.getElementById('clearMeasureBtn')?.addEventListener('click', () => this.clearMeasure());

        // 小工具：绘制（折线 / 矩形 / 圆）
        document.getElementById('drawPolylineBtn')?.addEventListener('click', () => this.toggleDrawPolylineMode());
        document.getElementById('drawRectBtn')?.addEventListener('click', () => this.toggleDrawRectMode());
        document.getElementById('drawCircleBtn')?.addEventListener('click', () => this.toggleDrawCircleMode());
        document.getElementById('finishPolylineBtn')?.addEventListener('click', () => this.finishCurrentPolyline());
        document.getElementById('clearPolylineBtn')?.addEventListener('click', () => this.clearDrawPolyline());
        document.getElementById('clearRectBtn')?.addEventListener('click', () => this.clearDrawRect());
        document.getElementById('clearCircleBtn')?.addEventListener('click', () => this.clearDrawCircle());

        this.bindTaskAreaDrag();
    }

    /**
     * 绑定任务区域拖动：编辑模式下选中任务区域后，左键按住可拖动；松开后显示是否移入新区域确认浮层
     */
    bindTaskAreaDrag() {
        const viewer = this.globe3d && this.globe3d.getViewer();
        if (!viewer) return;
        const self = this;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((movement) => {
            if (!document.getElementById('editMode') || !document.getElementById('editMode').checked) return;
            const areaKey = this.gridSystem.selectedTaskAreaKey;
            if (!areaKey) return;
            const drilled = viewer.scene.drillPick(movement.position);
            let taskArea = null;
            for (let i = 0; i < drilled.length; i++) {
                const entity = drilled[i] && drilled[i].id;
                if (!entity) continue;
                const ta = this.gridSystem.getTaskAreaByEntity(entity);
                if (ta && ta.areaKey === areaKey) {
                    taskArea = ta;
                    break;
                }
            }
            if (!taskArea) return;
            this._taskAreaDrag = { areaKey, startLon: taskArea.area.longitude, startLat: taskArea.area.latitude };
            viewer.scene.screenSpaceCameraController.enableRotate = false;
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        handler.setInputAction((movement) => {
            if (!this._taskAreaDrag) return;
            const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
            if (!cartesian) return;
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            this.gridSystem.updateTaskAreaPosition(this._taskAreaDrag.areaKey, lon, lat);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        handler.setInputAction((movement) => {
            if (!this._taskAreaDrag) return;
            viewer.scene.screenSpaceCameraController.enableRotate = true;
            const dragState = this._taskAreaDrag;
            this._taskAreaDrag = null;
            const item = this.gridSystem.taskAreaEntities.find(t => t.areaKey === dragState.areaKey);
            if (!item) return;
            const newLon = item.area.longitude;
            const newLat = item.area.latitude;
            const cartesian = Cesium.Cartesian3.fromDegrees(newLon, newLat, item.area.altitude || 0);
            this.showTaskAreaMoveConfirm(viewer.scene, cartesian, newLon, newLat, () => {
                this.saveTaskAreaAndCloseConfirm();
            }, () => {
                this.gridSystem.updateTaskAreaPosition(dragState.areaKey, dragState.startLon, dragState.startLat);
            });
        }, Cesium.ScreenSpaceEventType.LEFT_UP);

        // 延迟清理拖动状态，避免与 Cesium 画布上的 LEFT_UP 竞态（document 先于 canvas 收到 mouseup 会误清 _taskAreaDrag）
        document.addEventListener('mouseup', () => {
            setTimeout(() => {
                if (this._taskAreaDrag && viewer && viewer.scene && viewer.scene.screenSpaceCameraController) {
                    viewer.scene.screenSpaceCameraController.enableRotate = true;
                    this._taskAreaDrag = null;
                }
            }, 0);
        });
    }

    /**
     * 在任务区域新位置旁显示确认浮层：是否移入到新区域 + 新区域经纬度 + 确认/取消
     */
    showTaskAreaMoveConfirm(scene, cartesian, newLon, newLat, onConfirm, onCancel) {
        this.hideTaskAreaMoveConfirm();
        const canvas = scene.canvas;
        const coord = scene.cartesianToCanvasCoordinates(cartesian);
        if (!coord) return;
        const rect = canvas.getBoundingClientRect();
        const left = rect.left + coord.x - 120;
        const top = rect.top + coord.y - 80;
        const div = document.createElement('div');
        div.className = 'task-area-move-confirm';
        div.setAttribute('role', 'dialog');
        div.setAttribute('aria-label', '确认移入新区域');
        div.innerHTML = `
            <p class="task-area-move-confirm-title">是否移入到这个新区域？</p>
            <p class="task-area-move-confirm-coords">经度 ${newLon.toFixed(6)}°<br>纬度 ${newLat.toFixed(6)}°</p>
            <div class="task-area-move-confirm-actions">
                <button type="button" class="btn-primary task-area-move-confirm-ok">确认移入</button>
                <button type="button" class="btn-secondary task-area-move-confirm-cancel">取消</button>
            </div>
        `;
        div.style.left = `${Math.max(4, left)}px`;
        div.style.top = `${Math.max(4, top)}px`;
        const onOk = div.querySelector('.task-area-move-confirm-ok');
        const onCancelBtn = div.querySelector('.task-area-move-confirm-cancel');
        onOk.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hideTaskAreaMoveConfirm();
            onConfirm();
        });
        onCancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hideTaskAreaMoveConfirm();
            onCancel();
        });
        document.body.appendChild(div);
        this._taskAreaConfirmOverlay = div;
    }

    hideTaskAreaMoveConfirm() {
        document.querySelectorAll('.task-area-move-confirm').forEach((el) => {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        this._taskAreaConfirmOverlay = null;
    }

    /** 任务区域：用户点击「接收」或由聊天输入触发 */
    onTaskAreaConfirmAccept() {
        if (!this._pendingTaskAreaConfirm || !this._pendingTaskAreaConfirm.choice || !this.chatAgent) return;
        this._pendingTaskAreaConfirm = null;
        apiService.confirmTaskArea().then((res) => {
            if (res && res.error) {
                this.chatAgent.sendSystemMessage('确认失败: ' + res.error);
            } else {
                this.chatAgent.sendSystemMessage('已确认接收，数据已返回给请求端。');
            }
        });
    }

    /** 任务区域：用户点击「不接受/需要修改」或由聊天输入触发 */
    onTaskAreaConfirmRejectModify() {
        if (!this._pendingTaskAreaConfirm || !this._pendingTaskAreaConfirm.choice || !this.chatAgent) return;
        this.chatAgent.sendSystemMessage('请在地图上修改任务区域（可右键选中区域后拖动调整）。保存后会出现「修改后确认」卡片，可在其中选择「已修改完毕」或「继续修改」。');
        this._pendingTaskAreaConfirm.choice = false;
        this._pendingTaskAreaConfirm.modificationDone = true;
    }

    /** 任务区域：用户点击「已修改完毕」或由聊天输入触发 */
    onTaskAreaModifyDone() {
        if (!this._pendingTaskAreaConfirm || !this._pendingTaskAreaConfirm.modificationDone || !this.chatAgent) return;
        this._pendingTaskAreaConfirm = null;
        apiService.confirmTaskArea().then((res) => {
            if (res && res.error) {
                this.chatAgent.sendSystemMessage('确认失败: ' + res.error);
            } else {
                this.chatAgent.sendSystemMessage('已确认，已将最新数据返回给请求端。');
            }
        });
    }

    /** 任务区域：用户点击「继续修改」—— 再发一张修改确认卡片，便于再次保存后继续点 */
    onTaskAreaContinueModify() {
        if (!this._pendingTaskAreaConfirm || !this._pendingTaskAreaConfirm.modificationDone || !this.chatAgent) return;
        this.chatAgent.sendSystemMessage('可继续在地图上调整任务区域；保存后会再次弹出确认。');
    }

    /**
     * 处理用户在任务区域确认流程中的回复。由 ChatAgent 在 sendMessage 时调用。
     * @param {string} content - 用户输入
     * @returns {boolean} 是否已消费（true 则 ChatAgent 不再走通用回复）
     */
    handleTaskAreaConfirmationReply(content) {
        if (!this._pendingTaskAreaConfirm || !this.chatAgent) return false;
        const raw = (content || '').trim();
        const lower = raw.toLowerCase();
        if (this._pendingTaskAreaConfirm.choice) {
            if (raw === '接收' || lower.includes('接收')) {
                this.onTaskAreaConfirmAccept();
                return true;
            }
            if (raw === '不接受' || raw === '需要修改' || lower.includes('不接受') || lower.includes('需要修改')) {
                this.onTaskAreaConfirmRejectModify();
                return true;
            }
            this.chatAgent.sendSystemMessage('请使用上方面板中的「接收」或「不接受 / 需要修改」按钮，或在输入框输入相应关键词。');
            return true;
        }
        if (this._pendingTaskAreaConfirm.modificationDone) {
            if (raw === '已修改完毕' || lower.includes('已修改完毕')) {
                this.onTaskAreaModifyDone();
                return true;
            }
            if (raw === '继续修改' || lower.includes('继续修改')) {
                this.onTaskAreaContinueModify();
                return true;
            }
            this.chatAgent.sendSystemMessage('请使用上方面板中的「已修改完毕」或「继续修改」按钮，或在输入框输入对应关键词。');
            return true;
        }
        return false;
    }

    async saveTaskAreaAndCloseConfirm() {
        this.hideTaskAreaMoveConfirm();
        try {
            const data = this.gridSystem.getTaskAreaDataForSave();
            // 必须用 save-ui：save 会与 Agent 共用阻塞式接口，await 会卡死直到 confirm，无法弹出「修改后确认」卡片
            const res = await apiService.saveTaskAreaUi(data);
            if (res && res.error) {
                if (this.chatAgent) this.chatAgent.sendSystemMessage('任务区域保存失败: ' + res.error);
            } else {
                this._lastTaskAreaChatSentAt = Date.now();
                this.gridSystem.clearSelectedTaskArea();
                if (this.chatAgent) {
                    if (this._pendingTaskAreaConfirm && this._pendingTaskAreaConfirm.modificationDone) {
                        const dataText = this._formatTaskAreaForChat(JSON.parse(JSON.stringify(data)));
                        this.chatAgent.addTaskAreaModifyDoneCard(dataText);
                    } else {
                        const dataCopy = JSON.parse(JSON.stringify(data));
                        const dataText = this._formatTaskAreaForChat(dataCopy);
                        this.chatAgent.sendSystemMessage('已生成任务区域数据，已保存数据并已绘制显示。\n\n本次数据：\n' + dataText);
                    }
                }
            }
        } catch (err) {
            console.error('saveTaskAreaAndCloseConfirm', err);
            if (this.chatAgent) this.chatAgent.sendSystemMessage('任务区域保存失败: ' + (err.message || String(err)));
        }
    }

    /**
     * 绑定菜单栏：下拉开关 + 菜单项动作
     */
    bindMenuEvents() {
        const menu = document.getElementById('appMenu');
        if (!menu) return;

        const wraps = menu.querySelectorAll('.menu-item-wrap');
        const triggers = menu.querySelectorAll('.menu-trigger');
        const dropdownItems = menu.querySelectorAll('.menu-dropdown-item[data-action]');

        // 点击菜单项时关闭所有下拉
        const closeAllMenus = () => wraps.forEach(w => w.classList.remove('open'));

        triggers.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrap = btn.closest('.menu-item-wrap');
                const wasOpen = wrap.classList.contains('open');
                closeAllMenus();
                if (!wasOpen) wrap.classList.add('open');
                btn.setAttribute('aria-expanded', wrap.classList.contains('open'));
            });
        });

        dropdownItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.getAttribute('data-action');
                this.onMenuAction(action);
                closeAllMenus();
                menu.querySelectorAll('.menu-trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));
            });
        });

        document.addEventListener('click', () => closeAllMenus());
    }

    /**
     * 菜单项动作分发
     */
    onMenuAction(action) {
        switch (action) {
            case 'reload-map':
                this.loadServerMap();
                break;
            case 'export-config':
                this.chatAgent?.sendSystemMessage?.('导出配置功能可在后续版本中实现。');
                break;
            case 'exit':
                if (typeof window.close === 'function') window.close(); else this.chatAgent?.sendSystemMessage?.('请关闭浏览器标签页退出。');
                break;
            case 'clear-grids':
                this.gridSystem?.clearGrids?.();
                this.chatAgent?.sendSystemMessage?.('已清除所有网格数据。');
                break;
            case 'deselect-all':
                this.gridSystem?.deselectGrids?.();
                break;
            case 'view-left-panel':
                this.panelManager?.toggleLeftPanel?.();
                break;
            case 'view-right-panel':
                this.panelManager?.toggleRightPanel?.();
                break;
            case 'view-reset':
                this.globe3d?.resetView?.();
                break;
            case 'map-load':
                document.getElementById('loadServerMapBtn')?.click();
                break;
            case 'map-zoom-in':
                this.globe3d?.zoom?.(1);
                break;
            case 'map-zoom-out':
                this.globe3d?.zoom?.(-1);
                break;
            case 'tool-search':
                this.searchPanelOpen = true;
                this.updateToolPanelsDisplay?.();
                document.getElementById('placeSearchInput')?.focus?.();
                break;
            case 'tool-measure':
                this.toggleMeasureMode?.();
                break;
            case 'tool-polyline':
                this.toggleDrawPolylineMode?.();
                break;
            case 'tool-rect':
                this.toggleDrawRectMode?.();
                break;
            case 'tool-circle':
                this.toggleDrawCircleMode?.();
                break;
            case 'help-about':
                alert('DA智能体系统\n版本 2.0\n基于 Cesium 的离线三维地球与网格管理平台。');
                break;
            case 'help-docs':
                this.chatAgent?.sendSystemMessage?.('使用说明：左侧加载地图与网格，右侧与 Agent 对话，地图上可测量、搜索、绘制。');
                break;
            default:
                break;
        }
    }
    
    /**
     * 设置系统事件监听
     */
    setupEventListeners() {
        // 网格加载事件
        eventBus.on('grid:load', ({ data, taskType }) => {
            this.gridSystem.loadGridData(data, taskType);
        });
        
        // 任务3 偏好高亮（图例点击）
        eventBus.on('grid:preferenceHighlight', ({ preferenceIndex }) => {
            this.gridSystem.setPreferenceHighlight(preferenceIndex ?? null);
        });
        
        // 网格导入完成
        eventBus.on('grid:importComplete', ({ tasks, task3Preferences }) => {
            const list = document.getElementById('taskSelectList');
            if (list) {
                list.querySelectorAll('.task-select-row').forEach(row => {
                    const type = row.getAttribute('data-task-type');
                    const selected = tasks.includes(type);
                    row.classList.toggle('selected', selected);
                    row.setAttribute('aria-selected', selected);
                });
            }
            if (task3Preferences && tasks.includes('task3Grid')) {
                this.updateTask3PreferenceLegend(task3Preferences);
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
        
        // 网格选中与取消仅通过右键菜单；左键点击不改变选中状态
        // 使用 document 捕获 contextmenu：先判断是否为搜索标记，否则拾取网格
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
            const drilled = viewer.scene.drillPick(pos);
            let taskArea = null;
            for (let i = 0; i < drilled.length; i++) {
                const entity = drilled[i] && drilled[i].id;
                if (entity) {
                    const ta = self.gridSystem.getTaskAreaByEntity(entity);
                    if (ta) {
                        taskArea = ta;
                        break;
                    }
                }
            }
            if (taskArea) {
                self.contextMenu.showAtTaskArea(taskArea, e.clientX, e.clientY);
                return;
            }
            const grids = [];
            const pick = viewer.scene.pick(pos);
            for (let i = 0; i < drilled.length; i++) {
                const obj = drilled[i];
                const entity = obj && obj.id;
                if (entity) {
                    const g = self.gridSystem.getGridByEntity(entity);
                    if (g && !grids.some(gg => gg.gridIndex === g.gridIndex && gg.taskType === g.taskType)) grids.push(g);
                }
            }
            if (grids.length === 0 && pick && pick.id) {
                const g = self.gridSystem.getGridByEntity(pick.id);
                if (g) grids.push(g);
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
     * @param {boolean} silent - 为 true 时失败不弹窗（用于初始化自动加载）
     */
    async loadServerMap(silent = false) {
        let raw = document.getElementById('tileServerUrl').value.trim();
        raw = raw.replace(/\/Tiles\//gi, '/tiles/').replace(/\/Tiles$/gi, '/tiles').replace(/\/$/, '');
        // 将输入补全为完整 URL：纯端口则用 127.0.0.1；IP:端口或域名:端口自动添加 http 前缀
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
                    // 禁用缓存，防止旧地址响应导致误判当前地址连通
                    const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
                    lastStatus = res.status;
                    if (res.ok) {
                        // 重定向时 res.url 为最终 URL，可与请求 base 对比以排查端口不一致
                        const actualUrl = (res.url || testUrl).replace(/\/[^/]+$/, '');
                        if (actualUrl !== base.replace(/\/$/, '')) {
                            console.warn('⚠️ 瓦片请求被重定向：请求', base, '→ 实际', actualUrl);
                            this.chatAgent.sendSystemMessage('⚠️ 注意：请求的地址被重定向到 ' + actualUrl + '，请确认端口是否正确。');
                        }
                        // 请求实际图片以验证可用性；先带时间戳防缓存，失败则重试无查询参数
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
     * 路网图瓦片源：检查地址连通性并更新状态（后续可接入实际路网图层逻辑）
     */
    async loadRoadTileSource() {
        const input = document.getElementById('roadTileServerUrl');
        const base = (input?.value || '').trim().replace(/\/+$/, '');
        if (!base) {
            this.setRoadTileSourceStatus('no-config');
            return;
        }
        this.setRoadTileSourceStatus('checking');
        try {
            const testUrl = base + '/0/0/0.png';
            const res = await fetch(testUrl, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
            if (res.ok) {
                this.setRoadTileSourceStatus('connected');
                this.chatAgent.sendSystemMessage('✅ 路网图瓦片源已连通：' + base);
            } else {
                this.setRoadTileSourceStatus('disconnected', '服务返回 ' + res.status);
            }
        } catch (e) {
            this.setRoadTileSourceStatus('disconnected', e.message || '请求异常');
            this.chatAgent.sendSystemMessage('❌ 路网图瓦片源连接失败：' + base + ' — ' + (e.message || '请求异常'));
        }
    }

    /**
     * 高程数据源：检查地址连通性并更新状态（后续可接入实际高程逻辑）
     */
    async loadElevationSource() {
        const input = document.getElementById('elevationSourceUrl');
        const base = (input?.value || '').trim().replace(/\/+$/, '');
        if (!base) {
            this.setElevationSourceStatus('no-config');
            return;
        }
        this.setElevationSourceStatus('checking');
        try {
            const res = await fetch(base, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
            if (res.ok) {
                this.setElevationSourceStatus('connected');
                this.chatAgent.sendSystemMessage('✅ 高程数据源已连通：' + base);
            } else {
                this.setElevationSourceStatus('disconnected', '服务返回 ' + res.status);
            }
        } catch (e) {
            this.setElevationSourceStatus('disconnected', e.message || '请求异常');
            this.chatAgent.sendSystemMessage('❌ 高程数据源连接失败：' + base + ' — ' + (e.message || '请求异常'));
        }
    }
    
    
    /**
     * 加载选中的网格（initGrid 与 task1/task2/task3/group 各请求独立接口，再按键解析）
     */
    async loadSelectedGrids() {
        const list = document.getElementById('taskSelectList');
        const selectedOptions = list ? Array.from(list.querySelectorAll('.task-select-row.selected')).map(row => row.getAttribute('data-task-type')) : [];
        
        if (selectedOptions.length === 0) {
            alert('请至少选择一个任务类型');
            return;
        }
        
        this.showLoading(true);
        
        try {
            const allGridData = await apiService.getGridDataLikeDA();
            const loadedTypes = [];

            selectedOptions.forEach((taskType) => {
                if (taskType === 'groups') return; // 分组使用 platformGridMaps 结构，不按单点绘制
                const arr = allGridData[taskType];
                if (arr && arr.length > 0) {
                    eventBus.emit('grid:load', { data: allGridData, taskType });
                    loadedTypes.push(taskType);
                }
            });
            if (selectedOptions.includes('task3Grid') && allGridData.task3Preferences && allGridData.task3Preferences.length) {
                this.updateTask3PreferenceLegend(allGridData.task3Preferences);
            }

            const list = document.getElementById('taskSelectList');
            if (list) {
                loadedTypes.forEach(taskType => {
                    const row = list.querySelector(`.task-select-row[data-task-type="${taskType}"]`);
                    const cb = row?.querySelector('.task-select-show');
                    if (cb) cb.checked = true;
                });
            }
            const names = loadedTypes.map(t => (Config.GRID_COLORS[t] && Config.GRID_COLORS[t].name) || t);
            const msg = names.length > 0
                ? `✅ 已加载 ${names.length} 类网格数据：${names.join('、')}`
                : '✅ 已请求数据，但当前选中项均无网格数据。';
            this.chatAgent.sendSystemMessage(msg);
            
        } catch (error) {
            console.error('Load grids failed:', error);
            alert('加载网格失败: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 订阅 SSE：仅在 POST /api/grid/save 或 /api/grid/preference/save 被调用后，后端推送一次，前端刷新一次；其他时间不请求、不修改。
     */
    startGridSaveSSE() {
        const base = (Config.SERVER.API_SERVER || '').replace(/\/$/, '');
        const url = base ? `${base}/api/grid/events` : '/api/grid/events';
        try {
            const es = new EventSource(url);
            const self = this;
            es.onmessage = function (ev) {
                try {
                    const payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                    if (payload && (payload.changedKeys || payload.task3PreferenceOnly)) {
                        self.refreshGridDataFromServer(payload);
                    }
                } catch (e) {
                    console.warn('Grid SSE message parse error:', e);
                }
            };
            es.onerror = function () {
                // EventSource 会自动重连，仅记录
                console.warn('Grid SSE connection error or closed, will retry.');
            };
            this._gridSaveEventSource = es;
        } catch (e) {
            console.warn('Grid SSE not supported or failed:', e);
        }
    }

    /**
     * 将任务区域数据格式化为聊天框可读文案（经度、纬度、高程、长宽等）。
     * @param {{ [areaKey: string]: { longitude?, latitude?, altitude?, length?, width?, name? } }} task_area
     */
    _formatTaskAreaForChat(task_area) {
        if (!task_area || typeof task_area !== 'object') return '';
        const lines = [];
        Object.keys(task_area).forEach((key) => {
            const a = task_area[key];
            if (!a || typeof a.longitude !== 'number' || typeof a.latitude !== 'number') return;
            const name = (a.name && String(a.name).trim()) || key;
            const parts = [`${name}(${key})：经度 ${Number(a.longitude).toFixed(6)}° 纬度 ${Number(a.latitude).toFixed(6)}°`];
            if (a.altitude != null) parts.push(`高程 ${a.altitude} m`);
            if (a.length != null) parts.push(`长 ${a.length} km`);
            if (a.width != null) parts.push(`宽 ${a.width} km`);
            lines.push('• ' + parts.join('，'));
        });
        return lines.length ? lines.join('\n') : '（无区域）';
    }

    /**
     * 将通道数据格式化为聊天框可读文案。
     * @param {{ channel?: { cubeList?: Array } }} channelData
     */
    _formatChannelForChat(channelData) {
        const list = channelData && channelData.channel && channelData.channel.cubeList;
        if (!Array.isArray(list) || list.length === 0) return '（无通道）';
        const lines = list.slice(0, 5).map((cube, i) => {
            const jd = cube.center_jd != null ? Number(cube.center_jd).toFixed(5) : '-';
            const wd = cube.center_wd != null ? Number(cube.center_wd).toFixed(5) : '-';
            const len = cube.length != null ? cube.length : '-';
            const wid = cube.width != null ? cube.width : '-';
            return `• 通道${i + 1}：中心经度 ${jd}° 纬度 ${wd}°，长 ${len} km 宽 ${wid} km`;
        });
        if (list.length > 5) lines.push(`• … 共 ${list.length} 个通道`);
        return lines.join('\n');
    }

    /**
     * 根据变更的文件键得到「调用了什么接口、保存了什么数据」的文案，用于聊天框。
     * @param {string[]} changedKeys - 来自 last-update 的键：task1 / task2 / task3 / group
     */
    _getSavedDataSummary(changedKeys) {
        const labels = {
            task1: { name: '任务1网格', api: 'POST /api/grid/save (task=task1)' },
            task2: { name: '任务2网格', api: 'POST /api/grid/save (task=task2)' },
            task3: { name: '任务3网格与偏好', api: 'POST /api/grid/save (task=task3) 或 POST /api/grid/preference/save' },
            group: { name: '分组数据', api: 'POST /api/grid/save (task=group)' }
        };
        return changedKeys.map(k => labels[k]).filter(Boolean);
    }

    /**
     * 将后端变更的文件键映射为前端要刷新的网格任务类型（只更新 Agent 改动的数据，不重载全部）。
     * task1 文件 -> initGrid + task1Grid；task2 -> task2Grid；task3 -> task3Grid；group 无网格层。
     */
    _changedKeysToTaskTypes(changedKeys) {
        const taskTypes = [];
        if (changedKeys.includes('task1')) taskTypes.push('initGrid', 'task1Grid');
        if (changedKeys.includes('task2')) taskTypes.push('task2Grid');
        if (changedKeys.includes('task3')) taskTypes.push('task3Grid');
        if (changedKeys.includes('group')) { /* 分组无网格层，不加入 */ }
        return [...new Set(taskTypes)];
    }

    /**
     * 仅根据 Agent 更新的数据刷新界面：只刷新变更对应的部分；task3 区分「仅网格」与「仅偏好」。
     * @param {Object} opts
     * @param {string[]} [opts.changedKeys] - 本次发生变更的文件键（task1/task2/task3/group）
     * @param {boolean} [opts.task3GridOnly] - 仅 task3 网格保存，不更新偏好图例
     * @param {boolean} [opts.task3PreferenceOnly] - 仅偏好保存，只更新偏好图例与着色，不重载 task3 网格
     */
    async refreshGridDataFromServer(opts = {}) {
        let { changedKeys = [], task3GridOnly = false, task3PreferenceOnly = false } = typeof opts === 'object' ? opts : { changedKeys: opts };
        try {
            if (changedKeys.includes('channel')) {
                const base = (Config.SERVER.API_SERVER || '').replace(/\/$/, '');
                const channelRes = await fetch(base ? `${base}/api/grid/channel` : '/api/grid/channel');
                const channelData = channelRes.ok ? await channelRes.json() : { channel: { cubeList: [] } };
                this.gridSystem.loadChannelData(channelData);
                if (this.chatAgent) {
                    const dataCopy = JSON.parse(JSON.stringify(channelData));
                    const dataText = this._formatChannelForChat(dataCopy);
                    const msg = '已生成通道数据，已保存数据并已绘制显示。\n\n本次数据：\n' + dataText;
                    this.chatAgent.sendSystemMessage(msg);
                }
                changedKeys = changedKeys.filter(k => k !== 'channel');
                if (changedKeys.length === 0) return;
            }
            if (changedKeys.includes('task_area')) {
                const base = (Config.SERVER.API_SERVER || '').replace(/\/$/, '');
                const taskAreaRes = await fetch(base ? `${base}/api/grid/task-area` : '/api/grid/task-area');
                const taskAreaData = taskAreaRes.ok ? await taskAreaRes.json() : { task_area: {} };
                this.gridSystem.loadTaskAreaData(taskAreaData);
                const justSentByFrontend = (Date.now() - this._lastTaskAreaChatSentAt) < 5000;
                if (this.chatAgent && !justSentByFrontend) {
                    const dataCopy = JSON.parse(JSON.stringify(taskAreaData.task_area || {}));
                    const dataText = this._formatTaskAreaForChat(dataCopy);
                    if (this._pendingTaskAreaConfirm && this._pendingTaskAreaConfirm.modificationDone) {
                        // 用户已选「需要修改」：仅同步地图，不重复弹出 Agent 首次确认卡
                    } else {
                        const hadChoicePending = !!(this._pendingTaskAreaConfirm && this._pendingTaskAreaConfirm.choice);
                        if (!this._pendingTaskAreaConfirm) {
                            this._pendingTaskAreaConfirm = { choice: true, modificationDone: false };
                        }
                        const variant = hadChoicePending ? 'updated' : 'initial';
                        this.chatAgent.addTaskAreaConfirmCard(dataText, { variant });
                    }
                }
                changedKeys = changedKeys.filter(k => k !== 'task_area');
                if (changedKeys.length === 0) return;
            }
            if (task3PreferenceOnly) {
                const raw = await apiService.getPreferenceGridData();
                const preferences = raw.preferences || [];
                this.gridSystem.setPreferenceHighlight(null);
                this.gridSystem.updateTask3PreferenceOnly(preferences);
                this.updateTask3PreferenceLegend(preferences);
                if (this.chatAgent) {
                    const prefSummary = preferences.length
                        ? `本次数据：共 ${preferences.length} 个偏好组` + (preferences.length <= 10
                            ? '（' + preferences.map((p, i) => `偏好${i + 1}: ${(p.grids || p).length || 0} 个网格`).join('；') + '）'
                            : '')
                        : '本次数据：无偏好组';
                    this.chatAgent.sendSystemMessage(
                        '已生成任务3偏好数据，已保存数据并已绘制显示。\n\n本次数据：' + (prefSummary ? '\n' + prefSummary : '（无偏好组）')
                    );
                }
                return;
            }
            const taskTypesToUpdate = this._changedKeysToTaskTypes(changedKeys);
            if (taskTypesToUpdate.length === 0) {
                if (this.chatAgent && changedKeys.length > 0) {
                    const items = this._getSavedDataSummary(changedKeys);
                    const dataNames = items.map(i => i.name).join('、');
                    this.chatAgent.sendSystemMessage(`已生成${dataNames}数据，已保存数据并已绘制显示。（分组数据无网格层，界面无需刷新。）`);
                }
                return;
            }
            const allGridData = await apiService.getGridDataLikeDA();
            if (taskTypesToUpdate.includes('task3Grid')) {
                this.gridSystem.setPreferenceHighlight(null);
            }
            this.gridSystem.clearGridsByTaskTypes(taskTypesToUpdate);
            const loaded = [];
            taskTypesToUpdate.forEach((taskType) => {
                const arr = allGridData[taskType];
                if (arr && arr.length > 0) {
                    eventBus.emit('grid:load', { data: allGridData, taskType });
                    loaded.push(taskType);
                }
            });
            const currentVisible = Array.from(this.gridSystem.visibleGrids);
            const updateTask3Legend = taskTypesToUpdate.includes('task3Grid') && !task3GridOnly;
            eventBus.emit('grid:importComplete', {
                tasks: currentVisible,
                task3Preferences: updateTask3Legend ? (allGridData.task3Preferences || []) : null
            });
            if (this.chatAgent && changedKeys.length > 0) {
                let items = this._getSavedDataSummary(changedKeys);
                if (task3GridOnly) {
                    items = items.map(i => i.name === '任务3网格与偏好'
                        ? { name: '任务3网格', api: 'POST /api/grid/save (task=task3)' }
                        : i);
                }
                const dataNames = items.map(i => i.name).join('、');
                const typeLabels = { initGrid: '初始网格', task1Grid: '任务1网格', task2Grid: '任务2网格', task3Grid: '任务3网格' };
                const dataLines = loaded.map((taskType) => {
                    const arr = allGridData[taskType];
                    const n = Array.isArray(arr) ? arr.length : 0;
                    return `${typeLabels[taskType] || taskType} ${n} 个`;
                });
                const dataSummary = dataLines.length ? '本次数据：' + dataLines.join('，') : '';
                this.chatAgent.sendSystemMessage(
                    `已生成${dataNames}数据，已保存数据并已绘制显示。${dataSummary ? '\n\n' + dataSummary : ''}`
                );
            } else if (this.chatAgent) {
                this.chatAgent.sendSystemMessage('已生成数据，已保存数据并已绘制显示。');
            }
        } catch (error) {
            console.error('Refresh grid data failed:', error);
            if (this.chatAgent) {
                this.chatAgent.sendSystemMessage('检测到数据更新，但拉取失败：' + (error.message || '请稍后重试。'));
            }
        }
    }
    
    /**
     * 更新任务3 偏好图例：有 preferences 时显示并填充可点击项，点击高亮对应偏好网格；null 时隐藏。
     */
    updateTask3PreferenceLegend(task3Preferences) {
        const wrap = document.getElementById('task3PreferenceLegendWrap');
        const container = document.getElementById('task3PreferenceLegend');
        if (!wrap || !container) return;
        if (!task3Preferences || !Array.isArray(task3Preferences) || task3Preferences.length === 0) {
            wrap.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        const preferenceDisplayEl = document.getElementById('preferenceDisplay');
        const showLegend = !preferenceDisplayEl || preferenceDisplayEl.checked;
        const colors = Config.TASK3_PREFERENCE_COLORS || [];
        container.innerHTML = '';
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'preference-legend-item active';
        allBtn.setAttribute('data-preference-index', '-1');
        allBtn.innerHTML = '<span class="preference-swatch" style="background:var(--text-muted);"></span>全部';
        allBtn.title = '显示全部偏好';
        allBtn.addEventListener('click', () => {
            container.querySelectorAll('.preference-legend-item').forEach(el => el.classList.remove('active'));
            allBtn.classList.add('active');
            eventBus.emit('grid:preferenceHighlight', { preferenceIndex: null });
        });
        container.appendChild(allBtn);
        task3Preferences.forEach((_, idx) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'preference-legend-item';
            item.setAttribute('data-preference-index', String(idx));
            const color = colors[idx % colors.length];
            const stroke = (color && color.stroke) ? color.stroke : '#888';
            item.innerHTML = `<span class="preference-swatch" style="background:${stroke};"></span>偏好${idx + 1}`;
            item.title = `高亮偏好${idx + 1}`;
            item.addEventListener('click', () => {
                container.querySelectorAll('.preference-legend-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                eventBus.emit('grid:preferenceHighlight', { preferenceIndex: idx });
            });
            container.appendChild(item);
        });
        wrap.style.display = showLegend ? 'flex' : 'none';
        this.gridSystem.setPreferenceDisplayEnabled(showLegend);
    }

    /**
     * 显示分组情况弹窗：请求 group 数据，将 members（各组包含的平台/编号）列出来
     */
    async showGroupMembersModal() {
        const modal = document.getElementById('groupMembersModal');
        const body = document.getElementById('groupMembersModalBody');
        if (!modal || !body) return;
        body.textContent = '加载中...';
        modal.hidden = false;
        try {
            const data = await apiService.getGroupMembers();
            const groups = data && data.groups ? data.groups : [];
            if (groups.length === 0 || !groups[0].members) {
                body.innerHTML = '<p class="group-row">暂无分组数据，请先加载分组网格或确认后端返回 group 数据。</p>';
                return;
            }
            const frag = document.createDocumentFragment();
            const members = groups[0].members;
            const keys = Object.keys(members).sort((a, b) => Number(a) - Number(b));
            keys.forEach((key) => {
                const arr = members[key];
                const list = Array.isArray(arr) ? arr.join(', ') : String(arr);
                const row = document.createElement('div');
                row.className = 'group-row';
                row.innerHTML = `<span class="group-name">组 ${key}</span>${list || '—'}`;
                frag.appendChild(row);
            });
            body.innerHTML = '';
            body.appendChild(frag);
        } catch (err) {
            console.error('Fetch group data failed:', err);
            body.textContent = '加载分组数据失败: ' + (err.message || err);
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
        this._setSourceStatus('tileSourceStatus', 'tileSourceStatusText', status, message, '未读取到瓦片地址，请检查 config.json 或后端');
    }

    setRoadTileSourceStatus(status, message = '') {
        this._setSourceStatus('roadTileSourceStatus', 'roadTileSourceStatusText', status, message, '请配置路网图瓦片服务地址');
    }

    setElevationSourceStatus(status, message = '') {
        this._setSourceStatus('elevationSourceStatus', 'elevationSourceStatusText', status, message, '请配置高程数据源地址');
    }

    _setSourceStatus(containerId, textId, status, message, noConfigDefault) {
        const el = document.getElementById(containerId);
        const textEl = document.getElementById(textId);
        if (!el || !textEl) return;
        el.className = 'tile-source-status ' + status;
        const dot = '<span class="status-dot"></span>';
        const messages = {
            checking: dot + ' 检查中...',
            connected: dot + ' 已连通',
            disconnected: dot + ' 未连通',
            'no-config': dot + ' ' + (message || noConfigDefault),
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
        // 未使用区段的线段与标签保持隐藏
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

    /** 更新工具面板显示与按钮激活状态，按激活顺序自左下角排布 */
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

    /** 测量与绘制互斥：同一时刻仅允许一种模式激活 */
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
        const ids = ['loadGridBtn', 'clearGridBtn', 'gridVisibility', 'editMode', 'preferenceDisplay', 'groupMembersDisplay', 'channelDisplay', 'taskAreaDisplay', 'gridOpacity'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });
        const list = document.getElementById('taskSelectList');
        if (list) {
            list.setAttribute('aria-disabled', !enabled);
            list.querySelectorAll('.task-select-show').forEach(cb => { cb.disabled = !enabled; });
            list.querySelectorAll('.task-select-row').forEach(row => { row.style.pointerEvents = enabled ? '' : 'none'; });
        }
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

// 应用入口：DOM 就绪后实例化 App
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
