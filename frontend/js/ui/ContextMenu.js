/**
 * 右键菜单管理器
 * 由 App 在 contextmenu 事件中调用 showAt(grid, clientX, clientY) 显示
 */
class ContextMenu {
    constructor(gridSystem) {
        this.gridSystem = gridSystem;
        this.menu = document.getElementById('contextMenu');
        this.pickerPanel = document.getElementById('contextMenuPicker');
        this.actionsPanel = document.getElementById('contextMenuActions');
        this.pickerList = document.getElementById('contextMenuPickerList');
        this.currentGrid = null;
        this.currentTaskArea = null;
        this.pendingGrids = [];
        this.pickerPosition = { x: 0, y: 0 };
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        if (!this.menu) return;
        this.menu.addEventListener('click', (e) => {
            const el = e.target.closest('.context-item');
            if (!el || !el.dataset.action) {
                e.stopPropagation();
                this.hide();
                return;
            }
            if (getComputedStyle(el).display === 'none') {
                e.stopPropagation();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (el.dataset.action === 'pickGrid') {
                const index = parseInt(el.dataset.index, 10);
                if (!isNaN(index) && this.pendingGrids[index]) {
                    this.choosePickedGrid(index);
                }
                return;
            }
            this.handleAction(el.dataset.action);
            this.hide();
        });
    }
    
    /**
     * 多网格重叠时显示网格选择列表（App 拾取到多个网格时调用）
     */
    showGridPicker(grids, clientX, clientY) {
        if (!this.menu || !this.pickerList || grids.length < 2) return;
        this.pendingGrids = grids;
        this.pickerPosition = { x: clientX, y: clientY };
        this.pickerList.innerHTML = '';
        grids.forEach((grid, i) => {
            const taskName = Config.GRID_COLORS[grid.taskType]?.name || grid.taskType;
            const item = document.createElement('div');
            item.className = 'context-item';
            item.dataset.action = 'pickGrid';
            item.dataset.index = String(i);
            item.textContent = `${taskName} #${grid.gridIndex}`;
            this.pickerList.appendChild(item);
        });
        if (this.pickerPanel) this.pickerPanel.style.display = 'block';
        if (this.actionsPanel) this.actionsPanel.style.display = 'none';
        this.positionMenu(clientX, clientY, 180, 50 + grids.length * 32);
        this.menu.style.display = 'block';
    }
    
    /**
     * 从重叠列表选定网格后切换至操作菜单
     */
    choosePickedGrid(index) {
        const grid = this.pendingGrids[index];
        if (!grid) return;
        this.currentGrid = grid;
        this.pendingGrids = [];
        if (this.pickerPanel) this.pickerPanel.style.display = 'none';
        if (this.actionsPanel) this.actionsPanel.style.display = 'block';
        this.updateMenuItems();
        this.positionMenu(this.pickerPosition.x, this.pickerPosition.y, 180, 260);
    }
    
    positionMenu(clientX, clientY, menuWidth, menuHeight) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let left = clientX + 4;
        let top = clientY + 4;
        if (left + menuWidth > viewportWidth) left = clientX - menuWidth - 4;
        if (top + menuHeight > viewportHeight) top = clientY - menuHeight - 4;
        if (left < 4) left = 4;
        if (top < 4) top = 4;
        this.menu.style.left = `${left}px`;
        this.menu.style.top = `${top}px`;
    }
    
    /**
     * 在指定位置显示菜单（单个网格时由 App 直接调用）
     */
    showAt(grid, clientX, clientY) {
        if (!this.menu) return;
        this.currentGrid = grid;
        this.currentTaskArea = null;
        this.pendingGrids = [];
        if (this.pickerPanel) this.pickerPanel.style.display = 'none';
        if (this.actionsPanel) this.actionsPanel.style.display = 'block';
        this.updateMenuItems();
        this.positionMenu(clientX, clientY, 180, 260);
        this.menu.style.display = 'block';
    }

    /**
     * 在指定位置显示任务区域菜单（选中该任务区域、查看详情）
     */
    showAtTaskArea(taskAreaInfo, clientX, clientY) {
        if (!this.menu) return;
        this.currentGrid = null;
        this.currentTaskArea = taskAreaInfo;
        this.pendingGrids = [];
        if (this.pickerPanel) this.pickerPanel.style.display = 'none';
        if (this.actionsPanel) this.actionsPanel.style.display = 'block';
        this.updateMenuItems();
        this.positionMenu(clientX, clientY, 180, 140);
        this.menu.style.display = 'block';
    }
    
    /**
     * 内部：按坐标显示（与 showAt 统一用 client 坐标）
     */
    show(x, y) {
        if (this.currentGrid) this.showAt(this.currentGrid, x, y);
    }
    
    /**
     * 隐藏菜单
     */
    hide() {
        this.menu.style.display = 'none';
        this.currentGrid = null;
        this.currentTaskArea = null;
        this.pendingGrids = [];
        if (this.pickerPanel) this.pickerPanel.style.display = 'none';
        if (this.actionsPanel) this.actionsPanel.style.display = 'block';
    }
    
    /** 当前任务阶段是否有任意网格被选中 */
    hasStageSelected(taskType) {
        return this.gridSystem.entities.some(
            e => e.taskType === taskType && this.gridSystem.selectedGrids.has(e.gridIndex)
        );
    }
    
    updateMenuItems() {
        if (!this.menu) return;
        const container = this.actionsPanel || this.menu;
        const gridItems = container.querySelectorAll('.context-item-grid');
        const taskAreaItems = container.querySelectorAll('.context-item-taskarea');

        if (this.currentTaskArea) {
            gridItems.forEach(el => { el.style.display = 'none'; });
            const isTaskAreaSelected = this.gridSystem.selectedTaskAreaKey === this.currentTaskArea.areaKey;
            taskAreaItems.forEach(el => {
                const action = el.dataset.action;
                if (action === 'taskAreaSelect') el.style.display = isTaskAreaSelected ? 'none' : 'block';
                else if (action === 'taskAreaDeselect') el.style.display = isTaskAreaSelected ? 'block' : 'none';
                else if (action === 'taskAreaDetails') el.style.display = 'block';
                else el.style.display = 'block';
            });
            return;
        }
        if (!this.currentGrid) return;

        gridItems.forEach(el => { el.style.display = ''; });
        taskAreaItems.forEach(el => { el.style.display = 'none'; });

        const isSelected = this.gridSystem.selectedGrids.has(this.currentGrid.gridIndex);
        container.querySelectorAll('.context-item').forEach(item => {
            const action = item.dataset.action;
            switch (action) {
                case 'select':
                    item.style.display = isSelected ? 'none' : 'block';
                    break;
                case 'deselect':
                    item.style.display = isSelected ? 'block' : 'none';
                    break;
                case 'selectAll':
                    item.style.display = isSelected ? 'none' : 'block';
                    break;
                case 'deselectStage':
                    item.style.display = this.hasStageSelected(this.currentGrid.taskType) ? 'block' : 'none';
                    break;
                case 'deselectAll':
                    item.style.display = this.gridSystem.selectedGrids.size > 0 ? 'block' : 'none';
                    break;
                case 'details':
                    item.style.display = 'block';
                    break;
            }
        });
    }
    
    /**
     * 处理菜单动作
     */
    handleAction(action) {
        if (action === 'taskAreaSelect' || action === 'taskAreaDeselect' || action === 'taskAreaDetails') {
            if (!this.currentTaskArea) return;
            if (action === 'taskAreaSelect') {
                this.gridSystem.setSelectedTaskArea(this.currentTaskArea.areaKey);
            } else if (action === 'taskAreaDeselect') {
                this.gridSystem.clearSelectedTaskArea();
            } else {
                this.showTaskAreaDetails(this.currentTaskArea);
            }
            return;
        }
        if (!this.currentGrid) return;
        
        switch (action) {
            case 'select':
                this.gridSystem.selectGrids(this.currentGrid.gridIndex);
                break;
                
            case 'deselect':
                this.gridSystem.deselectGrids(this.currentGrid.gridIndex);
                break;
                
            case 'selectAll':
                this.gridSystem.selectAllByType(this.currentGrid.taskType);
                break;
                
                case 'deselectStage':
                    this.gridSystem.deselectGridsByType(this.currentGrid.taskType);
                break;
                
                case 'deselectAll':
                    this.gridSystem.deselectGrids();
                break;
                
            case 'details':
                this.showGridDetails(this.currentGrid);
                break;
        }
    }

    /**
     * 显示任务区域详情（经纬度、长宽、高程等）
     */
    showTaskAreaDetails(taskAreaInfo) {
        const a = taskAreaInfo.area;
        const name = (a.name && a.name.trim()) || taskAreaInfo.areaKey;
        const details = `
任务区域详情
• 区域: ${name} (${taskAreaInfo.areaKey})
• 经度: ${(a.longitude ?? 0).toFixed(6)}°
• 纬度: ${(a.latitude ?? 0).toFixed(6)}°
• 长度: ${a.length ?? 6} km
• 宽度: ${a.width ?? 6} km
${a.altitude != null ? `• 高程: ${a.altitude} m` : ''}
        `.trim();
        alert(details);
    }
    
    /**
     * 显示网格详情（任务名、网格索引等，3D 平台额外展示经纬度/长宽/高程）
     */
    showGridDetails(grid) {
        const taskName = Config.GRID_COLORS[grid.taskType]?.name || grid.taskType;
        const details = `
网格详情
• 任务: ${taskName}
• 网格索引: ${grid.gridIndex}
• 纬度: ${(grid.latitude || 0).toFixed(6)}°
• 经度: ${(grid.longitude || 0).toFixed(6)}°
• 长度: ${grid.length} km
• 宽度: ${grid.width} km
${grid.altitude != null ? `• 高程: ${grid.altitude} m` : ''}
        `.trim();
        
        alert(details);
    }
}
