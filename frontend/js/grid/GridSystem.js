/**
 * 网格系统 - 在 Cesium 3D 地球上显示网格数据（与 DA_Interface 一致：任务名、网格索引、颜色、选中编辑）
 */
class GridSystem {
    constructor(globe3d) {
        this.viewer = globe3d.getViewer();
        this.entities = [];  // { entity, labelEntity, gridIndex, taskType, grid }
        this.selectedGrids = new Set();
        this.visibleGrids = new Set();
        this.opacity = Config.GRID_DEFAULTS.OPACITY;
        this.editMode = false;
    }
    
    /** 网格索引 1000–1999 使用 platform10xx 颜色（与 DA_Interface 一致） */
    isPlatform10xx(gridIndex) {
        const n = typeof gridIndex === 'number' ? gridIndex : parseInt(gridIndex, 10);
        return n >= 1000 && n < 2000;
    }
    
    /** 按任务类型和可选 gridIndex 取颜色（含 platform10xx） */
    getColorForTaskType(taskType, gridIndex) {
        if (gridIndex != null && this.isPlatform10xx(gridIndex)) {
            return Config.GRID_COLORS.platform10xx || Config.GRID_COLORS.initGrid;
        }
        return Config.GRID_COLORS[taskType] || Config.GRID_COLORS.initGrid;
    }
    
    /**
     * 加载网格数据
     */
    loadGridData(data, taskType) {
        if (!data || !this.viewer) return;
        
        const grids = data[taskType] || [];
        
        grids.forEach(grid => {
            this.createGridEntity(grid, taskType);
        });
        
        this.visibleGrids.add(taskType);
        this.updateStats();
        
        console.log(`✅ Loaded ${grids.length} grids from ${taskType}`);
    }
    
    /**
     * 创建网格实体（带任务名 + 网格索引标签，颜色与 DA_Interface 一致）
     */
    createGridEntity(grid, taskType) {
        const { latitude, longitude, length, width, gridIndex } = grid;
        const color = this.getColorForTaskType(taskType, gridIndex);
        // 与 DA_Interface 一致：platform10xx 保留阶段名称（Init/Task1 等），仅边框/文字用 10xx 颜色
        const baseTaskColor = Config.GRID_COLORS[taskType] || Config.GRID_COLORS.initGrid;
        const labelName = (this.isPlatform10xx(gridIndex) ? baseTaskColor.labelName : color.labelName) || color.name || taskType;
        
        // 计算边界
        const lengthDeg = this.kmToDegrees(length, latitude, false);
        const widthDeg = this.kmToDegrees(width, latitude, true);
        
        const topLat = latitude + lengthDeg / 2;
        const bottomLat = latitude - lengthDeg / 2;
        const leftLon = longitude - widthDeg / 2;
        const rightLon = longitude + widthDeg / 2;
        
        const entity = this.viewer.entities.add({
            name: `Grid ${gridIndex}`,
            polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray([
                    leftLon, topLat,
                    rightLon, topLat,
                    rightLon, bottomLat,
                    leftLon, bottomLat
                ]),
                material: Cesium.Color.fromCssColorString(color.fill).withAlpha(0.01),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(color.stroke),
                outlineWidth: Config.GRID_DEFAULTS.LINE_WIDTH,
                height: 0,
                extrudedHeight: 0
            },
            properties: {
                gridIndex: gridIndex,
                taskType: taskType
            }
        });
        
        const labelText = `${labelName}\n${gridIndex}`;
        const labelEntity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
            label: {
                text: labelText,
                font: 'bold 14px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, 0),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 1e8, 0.9),
                translucencyByDistance: new Cesium.NearFarScalar(5e4, 1.0, 1e7, 0.75),
                show: true
            }
        });
        labelEntity.isPickable = false;
        
        this.entities.push({
            entity: entity,
            labelEntity: labelEntity,
            gridIndex: gridIndex,
            taskType: taskType,
            grid: { ...grid, taskType: taskType }
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
     * 选中该阶段全部网格（与 DA_Interface 一致）
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
     * 清除网格
     */
    clearGrids() {
        this.entities.forEach(item => {
            this.viewer.entities.remove(item.entity);
            if (item.labelEntity) this.viewer.entities.remove(item.labelEntity);
        });
        this.entities = [];
        this.selectedGrids.clear();
        this.visibleGrids.clear();
        this.updateStats();
    }
    
    /**
     * 设置网格可见性
     */
    setVisible(visible) {
        this.entities.forEach(item => {
            item.entity.show = visible;
            if (item.labelEntity) item.labelEntity.show = visible;
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
            const isSelected = this.selectedGrids.has(item.gridIndex);
            const color = isSelected ? selectedColor : this.getColorForTaskType(item.taskType, item.gridIndex);
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(isSelected ? 0.2 : 0.01);
            // 与 DA_Interface 一致：选中状态边框完全不透明，未选中随透明度滑块
            item.entity.polygon.outlineColor = isSelected
                ? Cesium.Color.fromCssColorString(selectedColor.stroke)
                : Cesium.Color.fromCssColorString(color.stroke).withAlpha(opacity);
            item.entity.polygon.outlineWidth = isSelected ? lineWidthSelected : lineWidth;
            if (item.labelEntity && item.labelEntity.label) {
                item.labelEntity.label.fillColor = isSelected
                    ? Cesium.Color.fromCssColorString(selectedColor.text || selectedColor.stroke)
                    : Cesium.Color.WHITE;
            }
        });
    }
    
    /**
     * 设置编辑模式
     */
    setEditMode(enabled) {
        this.editMode = enabled;
    }
    
    /**
     * 选中网格（高亮与 DA_Interface 一致）
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
                // 与 DA_Interface 一致：选中时半透明黄底 rgba(255,255,0,0.2)
                item.entity.polygon.material = Cesium.Color.fromCssColorString(selectedColor.fill).withAlpha(0.2);
                item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(selectedColor.stroke);
                item.entity.polygon.outlineWidth = lineWidthSelected;
                if (item.labelEntity && item.labelEntity.label) {
                    item.labelEntity.label.fillColor = Cesium.Color.fromCssColorString(selectedColor.text || selectedColor.stroke);
                }
            }
        });
        
        this.updateStats();
        eventBus.emit('grid:selectionChange', { selected: Array.from(this.selectedGrids) });
    }
    
    /**
     * 取消选中（恢复任务色，含 platform10xx）
     */
    deselectGrids(gridIndices) {
        const lineWidth = Config.GRID_DEFAULTS.LINE_WIDTH ?? 2;
        const applyColor = (item) => {
            const color = this.getColorForTaskType(item.taskType, item.gridIndex);
            // 与 createGridEntity 一致：保留极小 alpha 以便取消选中后仍可被拾取（避免“点一次就不能再点”）
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(0.01);
            item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color.stroke);
            item.entity.polygon.outlineWidth = lineWidth;
            if (item.labelEntity && item.labelEntity.label) {
                item.labelEntity.label.fillColor = Cesium.Color.WHITE;
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
            const color = this.getColorForTaskType(item.taskType, item.gridIndex);
            item.entity.polygon.material = Cesium.Color.fromCssColorString(color.fill).withAlpha(0.01);
            item.entity.polygon.outlineColor = Cesium.Color.fromCssColorString(color.stroke);
            item.entity.polygon.outlineWidth = lineWidth;
            if (item.labelEntity && item.labelEntity.label) {
                item.labelEntity.label.fillColor = Cesium.Color.WHITE;
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
