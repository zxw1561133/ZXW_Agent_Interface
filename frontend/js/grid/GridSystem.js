/**
 * 网格系统 - 在 Cesium 3D 地球上显示网格数据（任务名、网格索引、颜色、选中编辑）
 */
class GridSystem {
    constructor(globe3d) {
        this.viewer = globe3d.getViewer();
        this.entities = [];  // { entity, labelEntity, gridIndex, taskType, grid, preferenceIndex? }
        this.selectedGrids = new Set();
        this.visibleGrids = new Set();
        /** 按任务类型控制是否显示；未设置时视为 true */
        this._typeVisibility = new Map();
        this._globalVisible = true;
        this.opacity = Config.GRID_DEFAULTS.OPACITY;
        this.editMode = false;
        /** 当前高亮的偏好组索引（0-based），null 表示全部正常显示 */
        this.highlightPreferenceIndex = null;
        /** 偏好显示开关：true 时按偏好上色并显示偏好标签，false 时 task3 统一颜色、不显示偏好信息 */
        this.preferenceDisplayEnabled = true;
        /** 通道立方体实体列表，与 entities 分开管理 */
        this.channelEntities = [];
        /** 任务区域矩形实体列表 */
        this.taskAreaEntities = [];
        /** 通道、任务区域在地图上的显示开关（与网格显示独立） */
        this.channelDisplayEnabled = true;
        this.taskAreaDisplayEnabled = true;
        /** 未在 Config.TASK_AREA_COLORS 中配置时，按 areaKey 分配的可区分色板（与偏好色错开） */
        this._taskAreaFallbackPalette = [
            { name: null, fill: 'rgba(100, 200, 255, 0.2)', stroke: 'rgba(100, 200, 255, 0.9)', text: '#64c8ff' },
            { name: null, fill: 'rgba(255, 160, 80, 0.2)', stroke: 'rgba(255, 160, 80, 0.9)', text: '#ffa050' },
            { name: null, fill: 'rgba(120, 220, 120, 0.2)', stroke: 'rgba(120, 220, 120, 0.9)', text: '#78dc78' },
            { name: null, fill: 'rgba(220, 100, 255, 0.2)', stroke: 'rgba(220, 100, 255, 0.9)', text: '#dc64ff' },
            { name: null, fill: 'rgba(255, 220, 100, 0.2)', stroke: 'rgba(255, 220, 100, 0.9)', text: '#ffdc64' },
            { name: null, fill: 'rgba(80, 255, 200, 0.2)', stroke: 'rgba(80, 255, 200, 0.9)', text: '#50ffc8' },
            { name: null, fill: 'rgba(255, 120, 180, 0.2)', stroke: 'rgba(255, 120, 180, 0.9)', text: '#ff78b4' },
            { name: null, fill: 'rgba(150, 150, 255, 0.2)', stroke: 'rgba(150, 150, 255, 0.9)', text: '#9696ff' }
        ];
    }

    /**
     * 根据 areaKey 取任务区域颜色：优先 Config.TASK_AREA_COLORS，否则按 key 从 fallback 色板取（支持新增区域无需改 Config）。
     */
    _getTaskAreaColor(areaKey) {
        const configured = Config.TASK_AREA_COLORS && Config.TASK_AREA_COLORS[areaKey];
        if (configured) return configured;
        let hash = 0;
        const str = String(areaKey);
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
        const palette = this._taskAreaFallbackPalette;
        const entry = palette[Math.abs(hash) % palette.length];
        return { name: areaKey, fill: entry.fill, stroke: entry.stroke, text: entry.text };
    }
    
    /** 设置偏好显示开关状态，并刷新地图上 task3 网格的显示 */
    setPreferenceDisplayEnabled(enabled) {
        this.preferenceDisplayEnabled = !!enabled;
        if (this.entities.some(e => e.taskType === 'task3Grid')) {
            this._applyTask3PreferenceAndOpacity();
        }
    }
    
    /** 网格索引 1000–1999 使用 platform10xx 颜色 */
    isPlatform10xx(gridIndex) {
        const n = typeof gridIndex === 'number' ? gridIndex : parseInt(gridIndex, 10);
        return n >= 1000 && n < 2000;
    }
    
    /** 按任务类型、gridIndex 及可选 task3 偏好索引取颜色（含 platform10xx、偏好色带） */
    getColorForTaskType(taskType, gridIndex, preferenceIndex) {
        if (gridIndex != null && this.isPlatform10xx(gridIndex)) {
            return Config.GRID_COLORS.platform10xx || Config.GRID_COLORS.initGrid;
        }
        if (taskType === 'task3Grid' && preferenceIndex != null && this.preferenceDisplayEnabled && Config.TASK3_PREFERENCE_COLORS && Config.TASK3_PREFERENCE_COLORS.length) {
            const colors = Config.TASK3_PREFERENCE_COLORS;
            return colors[preferenceIndex % colors.length];
        }
        return Config.GRID_COLORS[taskType] || Config.GRID_COLORS.initGrid;
    }
    
    /** 从 preferences 二维数组构建 gridIndex -> preferenceIndex(0-based) 映射 */
    _buildPreferenceMap(preferences) {
        const map = new Map();
        if (!Array.isArray(preferences)) return map;
        preferences.forEach((group, idx) => {
            if (!Array.isArray(group)) return;
            group.forEach(gridIndex => map.set(Number(gridIndex), idx));
        });
        return map;
    }
    
    /**
     * 加载网格数据。task3Grid 若存在 task3Preferences 则按偏好组上色。
     * 每次加载会先清除该任务类型已有网格再绘制，避免重复点击「加载选中网格」导致叠加。
     */
    loadGridData(data, taskType) {
        if (!data || !this.viewer) return;
        // 先清除该任务类型已有网格，再重新绘制，避免叠加
        this.clearGridsByTaskTypes([taskType]);
        const grids = data[taskType] || [];
        const preferenceMap = (taskType === 'task3Grid' && data.task3Preferences && data.task3Preferences.length)
            ? this._buildPreferenceMap(data.task3Preferences)
            : null;
        
        grids.forEach(grid => {
            const preferenceIndex = preferenceMap != null ? preferenceMap.get(Number(grid.gridIndex)) : undefined;
            this.createGridEntity(grid, taskType, preferenceIndex);
        });
        
        this.visibleGrids.add(taskType);
        this._typeVisibility.set(taskType, true);
        if (taskType === 'task3Grid' && preferenceMap != null) {
            this._applyTask3PreferenceAndOpacity();
        }
        this.updateStats();
        
        console.log(`✅ Loaded ${grids.length} grids from ${taskType}`);
    }

    /**
     * 加载通道数据并绘制立方体。中心为 center_jd/center_wd/center_gc，长宽单位 km，高度单位 m。
     * 接口被调用后前端显示立方体；先清除已有通道再绘制。
     */
    loadChannelData(data) {
        if (!data || !this.viewer) return;
        this.clearChannel();
        const cubeList = (data.channel && data.channel.cubeList) || [];
        const color = Config.GRID_COLORS.channel || Config.GRID_COLORS.initGrid;
        cubeList.forEach((cube, index) => {
            this._createChannelCube(cube, color, index + 1);
        });
        if (cubeList.length > 0) {
            console.log(`✅ Loaded ${cubeList.length} channel cube(s)`);
        }
    }

    /** 清除所有通道立方体 */
    clearChannel() {
        this.channelEntities.forEach(item => {
            this.viewer.entities.remove(item.entity);
            if (item.labelEntity) this.viewer.entities.remove(item.labelEntity);
        });
        this.channelEntities = [];
    }

    /**
     * 创建一个通道立方体实体。cube: { center_jd, center_wd, center_gc, length, width, height }
     * 长宽单位 km，高度单位 m；中心为立方体几何中心。
     */
    _createChannelCube(cube, color, labelIndex) {
        const lon = Number(cube.center_jd);
        const lat = Number(cube.center_wd);
        const alt = Number(cube.center_gc) || 0;
        const lengthKm = Number(cube.length) || 10;
        const widthKm = Number(cube.width) || 10;
        const heightM = Number(cube.height) || 500;
        const halfLengthDeg = this.kmToDegrees(lengthKm / 2, lat, false);
        const halfWidthDeg = this.kmToDegrees(widthKm / 2, lat, true);
        const bottomAlt = alt - heightM / 2;
        const topAlt = alt + heightM / 2;
        const leftLon = lon - halfWidthDeg;
        const rightLon = lon + halfWidthDeg;
        const bottomLat = lat - halfLengthDeg;
        const topLat = lat + halfLengthDeg;
        const hierarchy = new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([
            leftLon, bottomLat, bottomAlt,
            rightLon, bottomLat, bottomAlt,
            rightLon, topLat, bottomAlt,
            leftLon, topLat, bottomAlt
        ]));
        const fillColor = Cesium.Color.fromCssColorString(color.fill || 'rgba(0,200,255,0.15)');
        const strokeColor = Cesium.Color.fromCssColorString(color.stroke || 'rgba(0,180,255,0.9)');
        const entity = this.viewer.entities.add({
            name: `Channel ${labelIndex}`,
            polygon: {
                hierarchy: hierarchy,
                extrudedHeight: topAlt,
                height: bottomAlt,
                material: fillColor,
                outline: true,
                outlineColor: strokeColor,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.NONE
            }
        });
        // 通道不参与拾取，便于点击穿透后选中其内部的任务区域块
        entity.isPickable = false;
        const labelEntity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, topAlt + 50),
            label: {
                text: `通道${labelIndex}`,
                font: Config.GRID_DEFAULTS.LABEL_FONT || 'bold 14px sans-serif',
                fillColor: Cesium.Color.fromCssColorString(color.text || color.stroke || '#00b4ff'),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                heightReference: Cesium.HeightReference.NONE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        labelEntity.isPickable = false;
        entity.show = this.channelDisplayEnabled;
        labelEntity.show = this.channelDisplayEnabled;
        this.channelEntities.push({ entity, labelEntity });
    }

    /** 设置通道立方体是否显示 */
    setChannelDisplayEnabled(enabled) {
        this.channelDisplayEnabled = !!enabled;
        this.channelEntities.forEach(({ entity, labelEntity }) => {
            if (entity) entity.show = this.channelDisplayEnabled;
            if (labelEntity) labelEntity.show = this.channelDisplayEnabled;
        });
    }

    /** 设置任务区域矩形与标签是否显示 */
    setTaskAreaDisplayEnabled(enabled) {
        this.taskAreaDisplayEnabled = !!enabled;
        this.taskAreaEntities.forEach(({ entity, labelEntity }) => {
            if (entity) entity.show = this.taskAreaDisplayEnabled;
            if (labelEntity) labelEntity.show = this.taskAreaDisplayEnabled;
        });
    }

    /**
     * 加载任务区域数据并绘制矩形。中心经纬度、长宽单位 km，各区域用不同颜色。
     */
    loadTaskAreaData(data) {
        if (!data || !this.viewer) return;
        this.clearTaskArea();
        const taskArea = data.task_area || {};
        Object.keys(taskArea).forEach((areaKey) => {
            const area = taskArea[areaKey];
            if (area && typeof area.longitude === 'number' && typeof area.latitude === 'number') {
                const color = this._getTaskAreaColor(areaKey);
                this._createTaskAreaRect(areaKey, area, color);
            }
        });
        if (Object.keys(taskArea).length > 0) {
            console.log(`✅ Loaded ${Object.keys(taskArea).length} task area(s)`);
        }
        this._applyTaskAreaHighlight();
    }

    /** 清除所有任务区域矩形 */
    clearTaskArea() {
        this.taskAreaEntities.forEach(item => {
            this.viewer.entities.remove(item.entity);
            if (item.labelEntity) this.viewer.entities.remove(item.labelEntity);
        });
        this.taskAreaEntities = [];
    }

    /**
     * 创建一个任务区域矩形。area: { longitude, latitude, altitude, length, width }，长宽单位 km。
     */
    _createTaskAreaRect(areaKey, area, color) {
        const lon = Number(area.longitude);
        const lat = Number(area.latitude);
        const alt = Number(area.altitude) || 0;
        const lengthKm = Number(area.length) || 6;
        const widthKm = Number(area.width) || 6;
        const halfLengthDeg = this.kmToDegrees(lengthKm / 2, lat, false);
        const halfWidthDeg = this.kmToDegrees(widthKm / 2, lat, true);
        const leftLon = lon - halfWidthDeg;
        const rightLon = lon + halfWidthDeg;
        const bottomLat = lat - halfLengthDeg;
        const topLat = lat + halfLengthDeg;
        const hierarchy = new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([
            leftLon, bottomLat, alt,
            rightLon, bottomLat, alt,
            rightLon, topLat, alt,
            leftLon, topLat, alt
        ]));
        const fillColor = Cesium.Color.fromCssColorString(color.fill || 'rgba(150,150,255,0.18)');
        const strokeColor = Cesium.Color.fromCssColorString(color.stroke || 'rgba(150,150,255,0.85)');
        const entity = this.viewer.entities.add({
            name: `TaskArea ${areaKey}`,
            polygon: {
                hierarchy: hierarchy,
                height: alt,
                extrudedHeight: alt,
                material: fillColor,
                outline: true,
                outlineColor: strokeColor,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.NONE
            }
        });
        // 显示名：优先用数据里的 name，否则 Config 配置的 name，否则用 areaKey（支持新增区域与 data 中自定义名称）
        const labelName = (area.name && typeof area.name === 'string' && area.name.trim())
            ? area.name.trim()
            : ((color.name && color.name !== areaKey) ? color.name : areaKey);
        const labelEntity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt + 80),
            label: {
                text: labelName,
                font: Config.GRID_DEFAULTS.LABEL_FONT || 'bold 14px sans-serif',
                fillColor: Cesium.Color.fromCssColorString(color.text || color.stroke || '#9696ff'),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                heightReference: Cesium.HeightReference.NONE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        labelEntity.isPickable = false;
        entity.show = this.taskAreaDisplayEnabled;
        labelEntity.show = this.taskAreaDisplayEnabled;
        const areaData = { longitude: lon, latitude: lat, altitude: alt, length: lengthKm, width: widthKm };
        if (area.name != null) areaData.name = area.name;
        this.taskAreaEntities.push({ entity, labelEntity, areaKey, area: areaData });
    }

    /**
     * 根据拾取的 Cesium 实体返回对应任务区域信息（用于右键菜单、详情、拖动）
     */
    getTaskAreaByEntity(cesiumEntity) {
        if (!cesiumEntity) return null;
        const item = this.taskAreaEntities.find(t => t.entity === cesiumEntity);
        if (!item) return null;
        return { areaKey: item.areaKey, entity: item.entity, labelEntity: item.labelEntity, area: { ...item.area } };
    }

    /** 当前选中的任务区域 key（用于高亮与拖动），仅支持单选 */
    get selectedTaskAreaKey() {
        return this._selectedTaskAreaKey || null;
    }

    setSelectedTaskArea(areaKey) {
        this._selectedTaskAreaKey = areaKey || null;
        this._applyTaskAreaHighlight();
    }

    clearSelectedTaskArea() {
        this.setSelectedTaskArea(null);
    }

    _applyTaskAreaHighlight() {
        const key = this._selectedTaskAreaKey;
        const highlightWidth = 4;
        const highlightColor = Cesium.Color.YELLOW;
        const highlightFill = Cesium.Color.YELLOW.withAlpha(0.35);
        this.taskAreaEntities.forEach(({ entity, areaKey }) => {
            if (!entity.polygon) return;
            const color = this._getTaskAreaColor(areaKey);
            if (areaKey === key) {
                entity.polygon.outlineWidth = highlightWidth;
                entity.polygon.outlineColor = highlightColor;
                entity.polygon.material = highlightFill;
            } else {
                entity.polygon.outlineWidth = 2;
                entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color.stroke || 'rgba(150,150,255,0.85)');
                entity.polygon.material = Cesium.Color.fromCssColorString(color.fill || 'rgba(150,150,255,0.18)');
            }
        });
    }

    /**
     * 更新任务区域实体位置（拖动时调用）；会同步 polygon、label 与内部缓存的 area。
     * @param {string} areaKey
     * @param {number} longitude
     * @param {number} latitude
     */
    updateTaskAreaPosition(areaKey, longitude, latitude) {
        const item = this.taskAreaEntities.find(t => t.areaKey === areaKey);
        if (!item || !item.entity.polygon || !item.labelEntity.position) return;
        const lon = Number(longitude);
        const lat = Number(latitude);
        const alt = Number(item.area.altitude) || 0;
        const lengthKm = Number(item.area.length) || 6;
        const widthKm = Number(item.area.width) || 6;
        const halfLengthDeg = this.kmToDegrees(lengthKm / 2, lat, false);
        const halfWidthDeg = this.kmToDegrees(widthKm / 2, lat, true);
        const leftLon = lon - halfWidthDeg;
        const rightLon = lon + halfWidthDeg;
        const bottomLat = lat - halfLengthDeg;
        const topLat = lat + halfLengthDeg;
        item.entity.polygon.hierarchy = new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([
            leftLon, bottomLat, alt, rightLon, bottomLat, alt, rightLon, topLat, alt, leftLon, topLat, alt
        ]));
        item.entity.polygon.height = alt;
        item.entity.polygon.extrudedHeight = alt;
        item.labelEntity.position = Cesium.Cartesian3.fromDegrees(lon, lat, alt + 80);
        item.area.longitude = lon;
        item.area.latitude = lat;
    }

    /**
     * 获取当前所有任务区域数据（用于保存）；返回与 task_area.json 一致的 { areaKey: { longitude, latitude, ... } }。
     */
    getTaskAreaDataForSave() {
        const task_area = {};
        this.taskAreaEntities.forEach(({ areaKey, area }) => {
            task_area[areaKey] = { ...area };
        });
        return task_area;
    }
    
    /**
     * 创建网格实体（带任务名 + 网格索引标签，颜色；task3 可选按偏好上色）
     */
    createGridEntity(grid, taskType, preferenceIndex) {
        const { latitude, longitude, length, width, gridIndex } = grid;
        // 支持 altitude / height（米），无则贴地 0
        const altitude = (grid.altitude != null ? grid.altitude : (grid.height != null ? grid.height : 0));
        const useHeight = altitude !== 0;

        const color = this.getColorForTaskType(taskType, gridIndex, preferenceIndex);
        const baseTaskColor = Config.GRID_COLORS[taskType] || Config.GRID_COLORS.initGrid;
        const labelName = (this.isPlatform10xx(gridIndex) ? baseTaskColor.labelName : color.labelName) || color.name || taskType;
        const preferenceLabel = (taskType === 'task3Grid' && preferenceIndex != null && Config.TASK3_PREFERENCE_COLORS && Config.TASK3_PREFERENCE_COLORS[preferenceIndex % Config.TASK3_PREFERENCE_COLORS.length])
            ? `偏好${preferenceIndex + 1}`
            : '';
        
        const lengthDeg = this.kmToDegrees(length, latitude, false);
        const widthDeg = this.kmToDegrees(width, latitude, true);
        const topLat = latitude + lengthDeg / 2;
        const bottomLat = latitude - lengthDeg / 2;
        const leftLon = longitude - widthDeg / 2;
        const rightLon = longitude + widthDeg / 2;
        
        const usePreferenceFill = (taskType === 'task3Grid' && preferenceIndex != null && this.preferenceDisplayEnabled && color.fill);
        const fillAlpha = usePreferenceFill ? 0.38 : 0.01;
        const rectPositions = Cesium.Cartesian3.fromDegreesArrayHeights([
            leftLon, topLat, altitude,
            rightLon, topLat, altitude,
            rightLon, bottomLat, altitude,
            leftLon, bottomLat, altitude,
            leftLon, topLat, altitude
        ]);
        const lineWidth = Config.GRID_DEFAULTS.LINE_WIDTH ?? 2;
        const polygonHierarchy = useHeight
            ? new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([leftLon, topLat, altitude, rightLon, topLat, altitude, rightLon, bottomLat, altitude, leftLon, bottomLat, altitude]))
            : new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray([leftLon, topLat, rightLon, topLat, rightLon, bottomLat, leftLon, bottomLat]));
        const entity = this.viewer.entities.add({
            name: `Grid ${gridIndex}`,
            polygon: {
                hierarchy: polygonHierarchy,
                material: Cesium.Color.fromCssColorString(color.fill).withAlpha(fillAlpha),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(color.stroke),
                outlineWidth: 1,
                height: altitude,
                extrudedHeight: altitude,
                heightReference: useHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND
            },
            properties: {
                gridIndex: gridIndex,
                taskType: taskType
            }
        });
        const borderEntity = this.viewer.entities.add({
            name: `Grid ${gridIndex} border`,
            polyline: {
                positions: rectPositions,
                width: lineWidth,
                material: Cesium.Color.fromCssColorString(color.stroke),
                heightReference: useHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                clampToGround: !useHeight
            }
        });
        borderEntity.isPickable = false;

        const labelText = preferenceLabel ? `${labelName}\n${gridIndex} (${preferenceLabel})` : `${labelName}\n${gridIndex}`;
        const labelFont = Config.GRID_DEFAULTS.LABEL_FONT || 'bold 15px sans-serif';
        const labelOutlineWidth = Config.GRID_DEFAULTS.LABEL_OUTLINE_WIDTH ?? 3;
        const labelOutlineColor = Config.GRID_DEFAULTS.LABEL_OUTLINE_COLOR
            ? Cesium.Color.fromCssColorString(Config.GRID_DEFAULTS.LABEL_OUTLINE_COLOR)
            : Cesium.Color.BLACK;
        const labelEntity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude),
            label: {
                text: labelText,
                font: labelFont,
                fillColor: Cesium.Color.fromCssColorString(color.text || color.stroke).withAlpha(this.opacity),
                outlineColor: labelOutlineColor,
                outlineWidth: labelOutlineWidth,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, 0),
                heightReference: useHeight ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(2e4, 1.0, 1.2e8, 0.85),
                translucencyByDistance: new Cesium.NearFarScalar(8e4, 1.0, 1.5e7, 0.7),
                show: true
            }
        });
        labelEntity.isPickable = false;
        
        this.entities.push({
            entity: entity,
            borderEntity: borderEntity,
            labelEntity: labelEntity,
            gridIndex: gridIndex,
            taskType: taskType,
            preferenceIndex: preferenceIndex,
            grid: { ...grid, taskType: taskType }
        });
    }
    
    /**
     * 设置偏好高亮：传入 0-based 索引则高亮该组、其余变暗；传入 null 则全部恢复。
     */
    setPreferenceHighlight(preferenceIndex) {
        this.highlightPreferenceIndex = preferenceIndex;
        this._applyTask3PreferenceAndOpacity();
    }
    
    /**
     * 仅更新 task3 的偏好（不重载网格）：更新已有 task3 实体的 preferenceIndex 并重刷颜色/图例。
     * 用于 Agent 只调用了偏好保存接口时，只刷新偏好显示，不触动网格位置。
     */
    updateTask3PreferenceOnly(preferences) {
        if (!Array.isArray(preferences)) return;
        const preferenceMap = this._buildPreferenceMap(preferences);
        this.entities.forEach(item => {
            if (item.taskType !== 'task3Grid') return;
            const idx = preferenceMap.get(Number(item.gridIndex));
            item.preferenceIndex = idx !== undefined ? idx : undefined;
        });
        this._applyTask3PreferenceAndOpacity();
        this.updateStats();
    }

    /** 应用 task3 偏好高亮与全局透明度（仅影响 task3 实体） */
    _applyTask3PreferenceAndOpacity() {
        const lineWidth = Config.GRID_DEFAULTS.LINE_WIDTH ?? 2;
        const lineWidthSelected = Config.GRID_DEFAULTS.LINE_WIDTH_SELECTED ?? 3;
        const highlightIdx = this.highlightPreferenceIndex;
        const baseTaskColor = Config.GRID_COLORS.task3Grid || Config.GRID_COLORS.initGrid;
        this.entities.forEach(item => {
            if (item.taskType !== 'task3Grid') return;
            const isSelected = this.selectedGrids.has(item.gridIndex);
            if (item.labelEntity && item.labelEntity.label) {
                const labelName = baseTaskColor.labelName || baseTaskColor.name || 'Task3';
                const prefSuffix = (this.preferenceDisplayEnabled && item.preferenceIndex != null) ? ` (偏好${item.preferenceIndex + 1})` : '';
                item.labelEntity.label.text = `${labelName}\n${item.gridIndex}${prefSuffix}`;
            }
            if (isSelected) {
                const sc = Config.GRID_COLORS.selected;
                item.entity.polygon.material = Cesium.Color.fromCssColorString(sc.fill).withAlpha(0.2);
                item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(sc.stroke);
                item.entity.polygon.outlineWidth = lineWidthSelected;
                if (item.borderEntity && item.borderEntity.polyline) {
                    item.borderEntity.polyline.width = lineWidthSelected;
                    item.borderEntity.polyline.material = Cesium.Color.fromCssColorString(sc.stroke);
                }
                if (item.labelEntity && item.labelEntity.label) {
                    item.labelEntity.label.fillColor = Cesium.Color.fromCssColorString(sc.text || sc.stroke);
                }
                return;
            }
            const color = this.getColorForTaskType(item.taskType, item.gridIndex, item.preferenceIndex);
            const isMatch = highlightIdx == null || item.preferenceIndex === highlightIdx;
            const strokeAlpha = isMatch ? this.opacity : 0.2;
            const usePreferenceFill = this.preferenceDisplayEnabled && item.preferenceIndex != null;
            const fillAlpha = usePreferenceFill && isMatch ? 0.38 : (usePreferenceFill && !isMatch ? 0.12 : 0.01);
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(fillAlpha);
            item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color.stroke).withAlpha(strokeAlpha);
            item.entity.polygon.outlineWidth = lineWidth;
            if (item.borderEntity && item.borderEntity.polyline) {
                item.borderEntity.polyline.width = lineWidth;
                item.borderEntity.polyline.material = Cesium.Color.fromCssColorString(color.stroke).withAlpha(strokeAlpha);
            }
            const typeShow = this._typeVisibility.get(item.taskType) !== false;
            const baseShow = this._globalVisible && typeShow;
            const showStrokeAndLabel = baseShow && (isSelected || this.opacity > 0);
            if (item.borderEntity) item.borderEntity.show = showStrokeAndLabel;
            if (item.labelEntity) {
                item.labelEntity.show = showStrokeAndLabel;
                if (item.labelEntity.label) {
                    const labelAlpha = (isMatch ? 1 : 0.5) * this.opacity;
                    item.labelEntity.label.fillColor = Cesium.Color.fromCssColorString(color.text || color.stroke).withAlpha(labelAlpha);
                }
            }
        });
    }
    
    /**
     * 根据拾取的 Cesium 实体返回对应网格数据（用于右键菜单、详情、飞向）
     */
    getGridByEntity(cesiumEntity) {
        if (!cesiumEntity) return null;
        const item = this.entities.find(e => e.entity === cesiumEntity);
        if (!item) return null;
        return { ...item.grid, taskType: item.taskType };
    }
    
    /**
     * 选中该阶段全部网格
     */
    selectAllByType(taskType) {
        const indices = this.entities
            .filter(e => e.taskType === taskType)
            .map(e => e.gridIndex);
        if (indices.length > 0) {
            this.selectGrids(indices);
        }
    }
    
    /**
     * 公里转度数
     */
    kmToDegrees(km, lat, isWidth) {
        if (isWidth) {
            return km / (111.32 * Math.cos(lat * Math.PI / 180));
        }
        return km / 111.32;
    }
    
    /**
     * 清除网格（含通道立方体）
     */
    clearGrids() {
        this.entities.forEach(item => {
            this.viewer.entities.remove(item.entity);
            if (item.borderEntity) this.viewer.entities.remove(item.borderEntity);
            if (item.labelEntity) this.viewer.entities.remove(item.labelEntity);
        });
        this.entities = [];
        this.selectedGrids.clear();
        this.visibleGrids.clear();
        this._typeVisibility.clear();
        this.clearChannel();
        this.clearTaskArea();
        this.updateStats();
    }

    /**
     * 仅清除指定任务类型的网格，用于 Agent 只更新部分数据时局部刷新。
     * @param {string[]} taskTypes - 要清除的类型，如 ['task3Grid']
     */
    clearGridsByTaskTypes(taskTypes) {
        if (!taskTypes || taskTypes.length === 0) return;
        const set = new Set(taskTypes);
        const toRemove = this.entities.filter(item => set.has(item.taskType));
        toRemove.forEach(item => {
            this.viewer.entities.remove(item.entity);
            if (item.borderEntity) this.viewer.entities.remove(item.borderEntity);
            if (item.labelEntity) this.viewer.entities.remove(item.labelEntity);
            this.selectedGrids.delete(item.gridIndex);
        });
        this.entities = this.entities.filter(item => !set.has(item.taskType));
        taskTypes.forEach(t => {
            this.visibleGrids.delete(t);
            this._typeVisibility.delete(t);
        });
        this.updateStats();
    }
    
    /**
     * 设置网格可见性（全局）；与按类型的显示状态共同生效
     */
    setVisible(visible) {
        this._globalVisible = !!visible;
        this._updateAllVisibility();
    }

    /**
     * 按任务类型设置是否显示该类型网格
     */
    setVisibleByTaskType(taskType, visible) {
        this._typeVisibility.set(taskType, !!visible);
        this.entities.forEach(item => {
            if (item.taskType !== taskType) return;
            const show = this._globalVisible && !!visible;
            item.entity.show = show;
            if (item.borderEntity) item.borderEntity.show = show;
            if (item.labelEntity) item.labelEntity.show = show;
        });
    }

    /** 根据全局、按类型状态与透明度刷新所有实体显示（透明度为 0 时边框与标签不显示） */
    _updateAllVisibility() {
        this.entities.forEach(item => {
            const typeShow = this._typeVisibility.get(item.taskType) !== false;
            const show = this._globalVisible && typeShow;
            const isSelected = this.selectedGrids.has(item.gridIndex);
            const showStrokeAndLabel = show && (isSelected || this.opacity > 0);
            item.entity.show = show;
            if (item.borderEntity) item.borderEntity.show = showStrokeAndLabel;
            if (item.labelEntity) item.labelEntity.show = showStrokeAndLabel;
        });
    }
    
    /**
     * 设置透明度（网格为空心只显边框；标签未选中用白字黑边便于看清）
     */
    setOpacity(opacity) {
        this.opacity = opacity;
        const selectedColor = Config.GRID_COLORS.selected;
        const lineWidth = Config.GRID_DEFAULTS.LINE_WIDTH ?? 2;
        const lineWidthSelected = Config.GRID_DEFAULTS.LINE_WIDTH_SELECTED ?? 3;
        this.entities.forEach(item => {
            if (item.taskType === 'task3Grid') return;
            const isSelected = this.selectedGrids.has(item.gridIndex);
            const typeShow = this._typeVisibility.get(item.taskType) !== false;
            const baseShow = this._globalVisible && typeShow;
            const showStrokeAndLabel = baseShow && (isSelected || opacity > 0);
            const color = isSelected ? selectedColor : this.getColorForTaskType(item.taskType, item.gridIndex);
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(isSelected ? 0.2 : 0.01);
            item.entity.polygon.outlineColor = isSelected
                ? Cesium.Color.fromCssColorString(selectedColor.stroke)
                : Cesium.Color.fromCssColorString(color.stroke).withAlpha(opacity);
            item.entity.polygon.outlineWidth = isSelected ? lineWidthSelected : lineWidth;
            if (item.borderEntity && item.borderEntity.polyline) {
                item.borderEntity.polyline.width = isSelected ? lineWidthSelected : lineWidth;
                item.borderEntity.polyline.material = isSelected
                    ? Cesium.Color.fromCssColorString(selectedColor.stroke)
                    : Cesium.Color.fromCssColorString(color.stroke).withAlpha(opacity);
            }
            if (item.borderEntity) item.borderEntity.show = showStrokeAndLabel;
            if (item.labelEntity) {
                item.labelEntity.show = showStrokeAndLabel;
                if (item.labelEntity.label) {
                    item.labelEntity.label.fillColor = isSelected
                        ? Cesium.Color.fromCssColorString(selectedColor.text || selectedColor.stroke)
                        : Cesium.Color.WHITE.withAlpha(opacity);
                }
            }
        });
        if (this.entities.some(e => e.taskType === 'task3Grid')) {
            this._applyTask3PreferenceAndOpacity();
        }
    }
    
    /**
     * 设置编辑模式
     */
    setEditMode(enabled) {
        this.editMode = enabled;
    }
    
    /**
     * 选中网格（高亮）
     */
    selectGrids(gridIndices) {
        if (!Array.isArray(gridIndices)) {
            gridIndices = [gridIndices];
        }
        
        const selectedColor = Config.GRID_COLORS.selected;
        const lineWidthSelected = Config.GRID_DEFAULTS.LINE_WIDTH_SELECTED ?? 3;
        gridIndices.forEach(index => {
            this.selectedGrids.add(index);
            const item = this.entities.find(e => e.gridIndex === index);
            if (item) {
                item.entity.polygon.material = Cesium.Color.fromCssColorString(selectedColor.fill).withAlpha(0.2);
                item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(selectedColor.stroke);
                item.entity.polygon.outlineWidth = lineWidthSelected;
                if (item.borderEntity && item.borderEntity.polyline) {
                    item.borderEntity.polyline.width = lineWidthSelected;
                    item.borderEntity.polyline.material = Cesium.Color.fromCssColorString(selectedColor.stroke);
                }
                if (item.labelEntity && item.labelEntity.label) {
                    item.labelEntity.label.fillColor = Cesium.Color.fromCssColorString(selectedColor.text || selectedColor.stroke);
                }
            }
        });
        
        this.updateStats();
        eventBus.emit('grid:selectionChange', { selected: Array.from(this.selectedGrids) });
    }
    
    /**
     * 取消选中（恢复任务色与偏好色；偏好显示开启时 task3 保留偏好填充与标签）
     */
    deselectGrids(gridIndices) {
        const lineWidth = Config.GRID_DEFAULTS.LINE_WIDTH ?? 2;
        const applyColor = (item) => {
            const color = this.getColorForTaskType(item.taskType, item.gridIndex, item.preferenceIndex);
            const usePreferenceFill = item.taskType === 'task3Grid' && item.preferenceIndex != null && this.preferenceDisplayEnabled && color.fill;
            const fillAlpha = usePreferenceFill ? 0.38 : 0.01;
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(fillAlpha);
            item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color.stroke);
            item.entity.polygon.outlineWidth = lineWidth;
            if (item.borderEntity && item.borderEntity.polyline) {
                item.borderEntity.polyline.width = lineWidth;
                item.borderEntity.polyline.material = Cesium.Color.fromCssColorString(color.stroke);
            }
            if (item.labelEntity && item.labelEntity.label) {
                item.labelEntity.label.fillColor = Cesium.Color.fromCssColorString(color.text || color.stroke || '#ffffff').withAlpha(this.opacity);
                const baseTaskColor = Config.GRID_COLORS[item.taskType] || Config.GRID_COLORS.initGrid;
                const prefSuffix = usePreferenceFill ? ` (偏好${item.preferenceIndex + 1})` : '';
                item.labelEntity.label.text = `${baseTaskColor.labelName || baseTaskColor.name || item.taskType}\n${item.gridIndex}${prefSuffix}`;
            }
        };

        if (gridIndices === null || gridIndices === undefined) {
            this.entities.forEach(applyColor);
            this.selectedGrids.clear();
        } else {
            if (!Array.isArray(gridIndices)) {
                gridIndices = [gridIndices];
            }
            gridIndices.forEach(index => {
                this.selectedGrids.delete(index);
                const item = this.entities.find(e => e.gridIndex === index);
                if (item) applyColor(item);
            });
        }
        
        this.updateStats();
        eventBus.emit('grid:selectionChange', { selected: Array.from(this.selectedGrids) });
    }
    
    /**
     * 仅取消指定任务阶段的选中（该阶段独立；与「取消所有选中」区分）
     */
    deselectGridsByType(taskType) {
        const lineWidth = Config.GRID_DEFAULTS.LINE_WIDTH ?? 2;
        const applyColor = (item) => {
            const color = this.getColorForTaskType(item.taskType, item.gridIndex, item.preferenceIndex);
            const usePreferenceFill = item.taskType === 'task3Grid' && item.preferenceIndex != null && this.preferenceDisplayEnabled && color.fill;
            const fillAlpha = usePreferenceFill ? 0.38 : 0.01;
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(fillAlpha);
            item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color.stroke);
            item.entity.polygon.outlineWidth = lineWidth;
            if (item.borderEntity && item.borderEntity.polyline) {
                item.borderEntity.polyline.width = lineWidth;
                item.borderEntity.polyline.material = Cesium.Color.fromCssColorString(color.stroke);
            }
            if (item.labelEntity && item.labelEntity.label) {
                item.labelEntity.label.fillColor = Cesium.Color.fromCssColorString(color.text || color.stroke || '#ffffff').withAlpha(this.opacity);
                const baseTaskColor = Config.GRID_COLORS[item.taskType] || Config.GRID_COLORS.initGrid;
                const prefSuffix = usePreferenceFill ? ` (偏好${item.preferenceIndex + 1})` : '';
                item.labelEntity.label.text = `${baseTaskColor.labelName || baseTaskColor.name || item.taskType}\n${item.gridIndex}${prefSuffix}`;
            }
        };
        this.entities
            .filter(e => e.taskType === taskType && this.selectedGrids.has(e.gridIndex))
            .forEach(item => {
                this.selectedGrids.delete(item.gridIndex);
                applyColor(item);
            });
        this.updateStats();
        eventBus.emit('grid:selectionChange', { selected: Array.from(this.selectedGrids) });
    }
    
    /** 获取当前 task3 偏好组数量（用于图例）；无 task3 或未按偏好划分则返回 0 */
    getTask3PreferenceCount() {
        const indices = new Set();
        this.entities.forEach(e => {
            if (e.taskType === 'task3Grid' && e.preferenceIndex != null) indices.add(e.preferenceIndex);
        });
        return indices.size === 0 ? 0 : Math.max(...indices) + 1;
    }
    
    /**
     * 更新统计
     */
    updateStats() {
        const total = this.entities.length;
        document.getElementById('totalGrids').textContent = total;
        document.getElementById('selectedGrids').textContent = this.selectedGrids.size;
        document.getElementById('gridCount').textContent = `Grids: ${total}`;
    }
}
