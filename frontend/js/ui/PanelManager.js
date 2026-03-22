/**
 * 面板管理器 - 控制左右侧面板的显示/隐藏
 */
class PanelManager {
    constructor() {
        this.leftPanel = document.getElementById('leftPanel');
        this.rightPanel = document.getElementById('rightPanel');
        this.leftToggle = document.getElementById('leftPanelToggle');
        this.rightToggle = document.getElementById('rightPanelToggle');
        
        this.setupEventListeners();
    }
    
    /**
     * 设置事件监听
     */
    setupEventListeners() {
        // 左侧面板折叠
        this.leftToggle.addEventListener('click', () => {
            this.leftPanel.classList.toggle('collapsed');
        });
        
        // 右侧面板折叠
        this.rightToggle.addEventListener('click', () => {
            this.rightPanel.classList.toggle('collapsed');
        });
    }
    
    /**
     * 切换左侧面板
     */
    toggleLeftPanel() {
        this.leftPanel.classList.toggle('collapsed');
    }
    
    /**
     * 切换右侧面板
     */
    toggleRightPanel() {
        this.rightPanel.classList.toggle('collapsed');
    }
    
    /**
     * 展开左侧面板
     */
    expandLeftPanel() {
        this.leftPanel.classList.remove('collapsed');
    }
    
    /**
     * 展开右侧面板
     */
    expandRightPanel() {
        this.rightPanel.classList.remove('collapsed');
    }
}
