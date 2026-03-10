/**
 * 全局配置
 */
const Config = {
    // 版本信息
    VERSION: '1.0.0',
    
    // 服务器配置：页面加载时会从 config.json 覆盖，改 IP 只需改 config.json。此处仅为离线/未取到配置时的默认值
    SERVER: {
        TILE_SERVER: 'http://127.0.0.1:9001',
        API_SERVER: 'http://127.0.0.1:9000',
        FRONTEND_PORT: 9002
    },
    
    // 本地瓦片磁盘路径（界面提示用，与 config.json 的 tiles_dir 一致）
    LOCAL_TILES_PATH: 'F:\\jk\\天津滨海\\cursor\\map_test\\tiles',
    
    // 3D 地球配置
    GLOBE: {
        RADIUS: 100,
        SEGMENTS: 64,
        ROTATION_SPEED: 0.0005,
        MIN_DISTANCE: 120,
        MAX_DISTANCE: 500
    },
    
    // 瓦片配置（需与本地瓦片数据一致；从一级瓦片开始，不请求 0 级）
    TILES: {
        MIN_ZOOM: 1,
        MAX_ZOOM: 10,
        TILE_SIZE: 256,
        FORMAT: ['jpg', 'png'],
        TILE_EXT: 'jpg',           // 瓦片扩展名：'jpg' 或 'png'
        USE_REVERSE_Y: false      // 若瓦片为 TMS（y=0 在南），改为 true
    },
    
    // 网格颜色配置（与 DA_Interface 一致：任务名、网格索引、颜色）
    GRID_COLORS: {
        initGrid: {
            name: '初始网格',
            labelName: 'Init',
            fill: 'rgba(100, 200, 255, 0.25)',
            stroke: 'rgba(100, 200, 255, 0.6)',
            text: '#64c8ff'
        },
        task1Grid: {
            name: '任务 1',
            labelName: 'Task1',
            fill: 'rgba(100, 255, 150, 0.25)',
            stroke: 'rgba(100, 255, 150, 0.6)',
            text: '#64ff96'
        },
        task2Grid: {
            name: '任务 2',
            labelName: 'Task2',
            fill: 'rgba(255, 200, 100, 0.25)',
            stroke: 'rgba(255, 200, 100, 0.6)',
            text: '#ffc864'
        },
        task3Grid: {
            name: '任务 3',
            labelName: 'Task3',
            fill: 'rgba(255, 150, 255, 0.25)',
            stroke: 'rgba(255, 150, 255, 0.6)',
            text: '#ff96ff'
        },
        groups: {
            name: '分组网格',
            labelName: 'Group',
            fill: 'rgba(255, 255, 150, 0.25)',
            stroke: 'rgba(255, 255, 150, 0.6)',
            text: '#ffff96'
        },
        platform10xx: {
            name: 'Platform10xx',
            labelName: '10xx',
            fill: 'rgba(255, 100, 100, 0.3)',
            stroke: 'rgba(255, 100, 100, 0.8)',
            text: '#ff6464'
        },
        selected: {
            name: '选中',
            labelName: '选中',
            fill: 'rgba(255, 255, 0, 0.4)',
            stroke: 'rgba(255, 255, 0, 1)',
            text: '#ffff00'
        }
    },
    
    // 网格默认参数（边线加粗便于辨认）
    GRID_DEFAULTS: {
        OPACITY: 0.5,
        LINE_WIDTH: 10,
        LINE_WIDTH_SELECTED: 14
    },
    
    // Agent 配置
    AGENT: {
        NAME: 'Agent',
        AVATAR: '<img src="images/icons/icon-robot.svg" alt="" class="message-avatar-icon" width="20" height="20" aria-hidden="true">',
        USER_AVATAR: '<img src="images/icons/icon-user.svg" alt="" class="message-avatar-icon" width="20" height="20" aria-hidden="true">',
        AUTO_IMPORT_DELAY: 2000 // 模拟延迟 (ms)
    },
    
    // 性能配置
    PERFORMANCE: {
        MAX_TILE_CACHE: 100,
        MAX_GRID_COUNT: 10000,
        RENDER_THROTTLE: 16 // ms
    }
};
