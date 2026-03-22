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
     * 获取各网格文件最后修改时间，用于轮询检测 Agent 保存后自动刷新。
     * @returns {Promise<{task1: number, task2: number, task3: number, group: number}>}
     */
    async getGridLastUpdate() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/last-update`);
            return await response.json();
        } catch (error) {
            console.error('Get grid last-update failed:', error);
            return { task1: 0, task2: 0, task3: 0, group: 0 };
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
     * 偏好网格独立接口：从 Test_grid_task3.json 读取，返回 task3Grid + preferences
     * @returns {Promise<{task3Grid: Array, preferences: Array}>}
     */
    async getPreferenceGridData() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/preference`);
            return await response.json();
        } catch (error) {
            console.error('Get preference grid data failed:', error);
            return { task3Grid: [], preferences: [] };
        }
    }

    /**
     * 分组信息（members）独立接口：从 Test_group.json 读取，返回 groups
     * @returns {Promise<{groups: Array}>}
     */
    async getGroupMembers() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/group-members`);
            return await response.json();
        } catch (error) {
            console.error('Get group members failed:', error);
            return { groups: [] };
        }
    }

    /**
     * 通道立方体数据：从 channel.json 读取
     * @returns {Promise<{channel: {cubeList: Array}}>}
     */
    async getChannelData() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/channel`);
            return await response.json();
        } catch (error) {
            console.error('Get channel data failed:', error);
            return { channel: { cubeList: [] } };
        }
    }

    /**
     * 任务区域数据：从 task_area.json 读取
     * @returns {Promise<{task_area: Object}>}
     */
    async getTaskAreaData() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/task-area`);
            return await response.json();
        } catch (error) {
            console.error('Get task area data failed:', error);
            return { task_area: {} };
        }
    }

    /**
     * 保存任务区域数据到 task_area.json
     * @param {{ [areaKey: string]: { longitude, latitude, altitude?, length?, width?, name? } }} task_area
     * @returns {Promise<{ status?: string, error?: string }>}
     */
    /**
     * Agent 调用：阻塞直到用户在界面点击确认（接收 / 已修改完毕）后才返回 body
     */
    async saveTaskArea(task_area) {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/task-area/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_area })
            });
            return await response.json();
        } catch (error) {
            console.error('Save task area failed:', error);
            return { error: String(error) };
        }
    }

    /**
     * 前端地图编辑保存：立即返回，不阻塞 Agent 等待流程
     * @param {{ [areaKey: string]: object }} task_area
     */
    async saveTaskAreaUi(task_area) {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/task-area/save-ui`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_area })
            });
            return await response.json();
        } catch (error) {
            console.error('Save task area (UI) failed:', error);
            return { error: String(error) };
        }
    }

    /**
     * 用户确认接收或已修改完毕时调用，向等待中的 Agent POST 连接返回 task_area 数据
     * @returns {Promise<{ status?: string, error?: string }>}
     */
    async confirmTaskArea() {
        try {
            const response = await fetch(`${this.baseUrl}/api/grid/task-area/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            return await response.json();
        } catch (error) {
            console.error('Confirm task area failed:', error);
            return { error: String(error) };
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
     * 按选中的任务类型逐个请求（接口支持一次只请求一种 task），组装为与 getGridDataLikeDA 相同结构。
     * @param {string[]} taskTypes - 要请求的类型，如 ['initGrid','task1','task2']；后端 task 为 initGrid/task1/task2/task3/group
     * @param {boolean} sequential - 为 true 时顺序请求，为 false 时并发请求
     * @returns {Promise<{initGrid: Array, task1Grid: Array, task2Grid: Array, task3Grid: Array, groups: Array}>}
     */
    async getGridDataByTasks(taskTypes, sequential = false) {
        const empty = { initGrid: [], task1Grid: [], task2Grid: [], task3Grid: [], task3Preferences: [], groups: [] };
        const collect = (task, data) => {
            if (task === 'initGrid') empty.initGrid = data.initGrid || [];
            else if (task === 'task1') empty.task1Grid = data.task1Grid || [];
            else if (task === 'task2') empty.task2Grid = data.task2Grid || [];
            else if (task === 'task3') {
                empty.task3Grid = data.task3Grid || [];
                empty.task3Preferences = data.preferences || [];
            } else if (task === 'group') empty.groups = data.groups || [];
        };
        if (sequential) {
            for (const task of taskTypes) {
                const data = await this.getGridData(task).catch(() => ({}));
                collect(task, data);
            }
        } else {
            const results = await Promise.all(taskTypes.map(t => this.getGridData(t).catch(() => ({}))));
            taskTypes.forEach((task, i) => collect(task, results[i]));
        }
        return { ...empty };
    }

    /**
     * 加载并解析网格：initGrid 与 task1/task2/task3/group 各请求独立接口，组装为统一结构。
     * @returns {Promise<{initGrid: Array, task1Grid: Array, task2Grid: Array, task3Grid: Array, groups: Array}>}
     */
    async getGridDataLikeDA() {
        const [initData, task1Data, task2Data, preferenceData, groupMembersData] = await Promise.all([
            this.getGridData('initGrid').catch(() => ({})),
            this.getGridData('task1').catch(() => ({})),
            this.getGridData('task2').catch(() => ({})),
            this.getPreferenceGridData(),
            this.getGroupMembers()
        ]);
        return {
            initGrid: initData.initGrid || [],
            task1Grid: task1Data.task1Grid || [],
            task2Grid: task2Data.task2Grid || [],
            task3Grid: preferenceData.task3Grid || [],
            task3Preferences: preferenceData.preferences || [],
            groups: groupMembersData.groups || []
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

// 全局 ApiService 实例
const apiService = new ApiService();
