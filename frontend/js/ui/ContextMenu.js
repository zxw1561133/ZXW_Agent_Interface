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
     * 重叠时先显示「选择要操作的网格」列表（App 在拾取到多个网格时调用）
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
     * 用户从重叠列表中选了某一个网格，切到操作菜单
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
        this.pendingGrids = [];
        if (this.pickerPanel) this.pickerPanel.style.display = 'none';
        if (this.actionsPanel) this.actionsPanel.style.display = 'block';
        this.updateMenuItems();
        this.positionMenu(clientX, clientY, 180, 260);
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
        if (!this.menu || !this.currentGrid) return;
        
        const isSelected = this.gridSystem.selectedGrids.has(this.currentGrid.gridIndex);
        const container = this.actionsPanel || this.menu;
        
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
     * 显示网格详情（与 DA_Interface 一致：任务名、网格索引等，3D 平台额外展示经纬度/长宽/高程）
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
