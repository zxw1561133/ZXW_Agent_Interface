/**
 * API 服务 - 后端通信
 */
class ApiService {
    constructor() {
        this.baseUrl = Config.SERVER.API_SERVER;
        this.tileBaseUrl = Config.SERVER.TILE_SERVER;
    }
    
    /**
     * 健康检查
     */
    async healthCheck() {
        try {
            const response = await fetch(`${this.baseUrl}/api/health`);
            return await response.json();
        } catch (error) {
            console.error('Health check failed:', error);
            return { status: 'error', message: error.message };
        }
    }
    
    /**
     * 获取网格列表
     */
    async getGridList() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/list`);
            return await response.json();
        } catch (error) {
            console.error('Get grid list failed:', error);
            return [];
        }
    }
    
    /**
     * 获取网格数据
     * @param {string} task - 任务类型
     */
    async getGridData(task) {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/data?task=${task}`);
            return await response.json();
        } catch (error) {
            console.error(`Get grid data failed for ${task}:`, error);
            return null;
        }
    }
    
    /**
     * 批量获取网格数据
     * @param {string[]} tasks - 任务类型数组
     */
    async getMultipleGridData(tasks) {
        const promises = tasks.map(task => this.getGridData(task));
        const results = await Promise.all(promises);
        
        const data = {};
        tasks.forEach((task, index) => {
            if (results[index]) {
                data[task] = results[index];
            }
        });
        return data;
    }
    
    /**
     * 按 DA_Interface 方式加载并解析网格：请求 task1/task2/task3/group 四类，组装为统一结构。
     * 初始网格(initGrid)来自 task1 文件的 initGrid 键，不读单独文件。
     * @returns {Promise<{initGrid: Array, task1Grid: Array, task2Grid: Array, task3Grid: Array, groups: Array}>}
     */
    async getGridDataLikeDA() {
        const [task1Data, task2Data, task3Data, groupData] = await Promise.all([
            this.getGridData('task1').catch(() => ({})),
            this.getGridData('task2').catch(() => ({})),
            this.getGridData('task3').catch(() => ({})),
            this.getGridData('group').catch(() => ({}))
        ]);
        return {
            initGrid: task1Data.initGrid || [],
            task1Grid: task1Data.task1Grid || task1Data.initGrid || [],
            task2Grid: task2Data.task2Grid || [],
            task3Grid: task3Data.task3Grid || [],
            groups: groupData.groups || []
        };
    }
    
    /**
     * 构建瓦片 URL
     * @param {number} z - 缩放级别
     * @param {number} x - X 坐标
     * @param {number} y - Y 坐标
     * @param {string} format - 图片格式
     */
    buildTileUrl(z, x, y, format = 'jpg') {
        const base = (this.tileBaseUrl || '').replace(/\/$/, '');
        // 支持 ArcGIS 在线地图格式
        if (base.includes('arcgisonline.com')) {
            return `${base}/${z}/${y}/${x}`;
        }
        // 本地服务或其他标准格式: /z/x/y.jpg
        return `${base}/${z}/${x}/${y}.${format}`;
    }
    
    /**
     * 加载图片
     * @param {string} url - 图片 URL
     */
    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }
}

// 创建全局 API 服务实例
const apiService = new ApiService();
