/**
 * 全局配置
 * 各选项控制说明见下方注释
 */
const Config = {
    // ---------- 版本 ----------
    VERSION: '1.0.0',

    // ---------- 服务器（控制前端请求的地址） ----------
    // 页面加载时可由 config.json 或 /api/config 覆盖
    SERVER: {
        TILE_SERVER: 'http://127.0.0.1:9001',   // 瓦片服务地址，控制地图底图来源
        API_SERVER: 'http://127.0.0.1:9000',   // 业务 API 地址，控制网格/配置等接口
        FRONTEND_PORT: 9002                     // 前端端口，仅作提示用
    },

    // 本地瓦片磁盘路径：仅用于界面提示，需与 config.json 中 tiles_dir 一致
    LOCAL_TILES_PATH: 'F:\\jk\\天津滨海\\cursor\\map_test\\tiles',

    // ---------- 3D 地球（控制 Cesium 球体与相机） ----------
    GLOBE: {
        RADIUS: 100,              // 球体半径（场景单位）
        SEGMENTS: 64,              // 球体分段数，影响曲面平滑度
        ROTATION_SPEED: 0.0005,   // 自动旋转速度，0 则不旋转
        MIN_DISTANCE: 120,        // 相机最近拉近距离
        MAX_DISTANCE: 500,        // 相机最远拉远距离
        MIN_CAMERA_HEIGHT: 1e3,   // 相机高度下限（米），用于计算缩放级别
        MAX_CAMERA_HEIGHT: 1.2e8  // 相机高度上限（米）
    },

    // ---------- 瓦片（控制底图瓦片请求与层级） ----------
    // 需与本地瓦片数据一致；从一级瓦片开始，不请求 0 级
    TILES: {
        MIN_ZOOM: 1,              // 最小缩放级别
        MAX_ZOOM: 10,             // 最大缩放级别
        TILE_SIZE: 256,           // 单张瓦片像素尺寸
        FORMAT: ['jpg', 'png'],   // 支持的瓦片格式
        TILE_EXT: 'jpg',          // 默认请求的瓦片扩展名
        USE_REVERSE_Y: false      // 为 true 时使用 TMS 坐标系（y=0 在南）
    },

    // ---------- 网格颜色（控制各任务阶段网格的填充、边框、标签文字色） ----------
    // 每项：name 显示名，labelName 地图标签用短名，fill 多边形填充，stroke 边框，text 标签文字（对比度≥4.5:1）
    GRID_COLORS: {
        initGrid: {
            name: '初始网格',
            labelName: 'Init',
            fill: 'rgba(80, 180, 255, 0.22)',
            stroke: 'rgba(80, 180, 255, 0.85)',
            text: '#5eb8ff'
        },
        task1Grid: {
            name: '任务 1',
            labelName: 'Task1',
            fill: 'rgba(80, 220, 140, 0.22)',
            stroke: 'rgba(80, 220, 140, 0.85)',
            text: '#50dc8c'
        },
        task2Grid: {
            name: '任务 2',
            labelName: 'Task2',
            fill: 'rgba(0, 200, 160, 0.22)',
            stroke: 'rgba(0, 200, 160, 0.9)',
            text: '#00c8a0'
        },
        task3Grid: {
            name: '任务 3',
            labelName: 'Task3',
            fill: 'rgba(180, 100, 255, 0.22)',
            stroke: 'rgba(180, 100, 255, 0.9)',
            text: '#b464ff'
        },
        groups: {
            name: '分组网格',
            labelName: 'Group',
            fill: 'rgba(255, 200, 60, 0.22)',
            stroke: 'rgba(255, 200, 60, 0.9)',
            text: '#ffc83c'
        },
        platform10xx: {
            name: 'Platform10xx',
            labelName: '10xx',
            fill: 'rgba(255, 70, 80, 0.28)',
            stroke: 'rgba(255, 70, 80, 0.95)',
            text: '#ff4650'
        },
        selected: {
            name: '选中',
            labelName: '选中',
            fill: 'rgba(255, 220, 0, 0.35)',
            stroke: 'rgba(255, 220, 0, 1)',
            text: '#ffdc00'
        },
        channel: {
            name: '通道',
            labelName: '通道',
            fill: 'rgba(0, 200, 255, 0.15)',
            stroke: 'rgba(0, 180, 255, 0.9)',
            text: '#00b4ff'
        }
    },

    /** 任务区域矩形配色（可选）。task_area.json 中任意 key 都会绘制；未在此配置的 key 会按 key 自动分配可区分颜色，显示名可用数据里的 name 或 key。 */
    TASK_AREA_COLORS: {
        init:   { name: 'init区域', fill: 'rgba(80, 180, 255, 0.2)', stroke: 'rgba(80, 180, 255, 0.9)', text: '#50b4ff' },
        task1:  { name: 'task1区域', fill: 'rgba(80, 220, 140, 0.2)', stroke: 'rgba(80, 220, 140, 0.9)', text: '#50dc8c' },
        task2:  { name: 'task2区域', fill: 'rgba(255, 180, 60, 0.2)', stroke: 'rgba(255, 180, 60, 0.9)', text: '#ffb43c' },
        task3:  { name: 'task3区域', fill: 'rgba(200, 100, 255, 0.2)', stroke: 'rgba(200, 100, 255, 0.9)', text: '#c864ff' }
    },

    /** 任务3 偏好分组色带：控制偏好图例与地图上按偏好着色的 fill/stroke/text，约 10 组 */
    TASK3_PREFERENCE_COLORS: [
        { name: '偏好1', fill: 'rgba(60, 100, 255, 0.38)', stroke: 'rgba(60, 100, 255, 0.95)', text: '#3c64ff' },
        { name: '偏好2', fill: 'rgba(255, 120, 60, 0.38)', stroke: 'rgba(255, 120, 60, 0.95)', text: '#ff783c' },
        { name: '偏好3', fill: 'rgba(0, 200, 120, 0.38)', stroke: 'rgba(0, 200, 120, 0.95)', text: '#00c878' },
        { name: '偏好4', fill: 'rgba(200, 50, 255, 0.38)', stroke: 'rgba(200, 50, 255, 0.95)', text: '#c832ff' },
        { name: '偏好5', fill: 'rgba(255, 220, 0, 0.38)', stroke: 'rgba(255, 220, 0, 0.95)', text: '#ffdc00' },
        { name: '偏好6', fill: 'rgba(0, 220, 255, 0.38)', stroke: 'rgba(0, 220, 255, 0.95)', text: '#00dcff' },
        { name: '偏好7', fill: 'rgba(255, 80, 140, 0.38)', stroke: 'rgba(255, 80, 140, 0.95)', text: '#ff508c' },
        { name: '偏好8', fill: 'rgba(100, 255, 150, 0.38)', stroke: 'rgba(100, 255, 150, 0.95)', text: '#64ff96' },
        { name: '偏好9', fill: 'rgba(255, 100, 0, 0.38)', stroke: 'rgba(255, 100, 0, 0.95)', text: '#ff6400' },
        { name: '偏好10', fill: 'rgba(150, 80, 255, 0.38)', stroke: 'rgba(150, 80, 255, 0.95)', text: '#9650ff' }
    ],
    
    // ---------- 网格默认参数（控制网格边线宽度、透明度与标签样式） ----------
    // 边框由 Polyline 绘制，此处像素宽度会生效；polygon.outline 受 WebGL 限制多数环境仅 1px，故用 polyline 实现粗边框
    GRID_DEFAULTS: {
        OPACITY: 0.65,               // 网格整体透明度（未单独指定时），略高以提升可读性
        LINE_WIDTH: 2.5,             // 普通网格边线宽度（像素）
        LINE_WIDTH_SELECTED: 4,      // 选中网格边线宽度，形成清晰层次
        LABEL_FONT: 'bold 15px sans-serif',
        LABEL_OUTLINE_WIDTH: 3,
        LABEL_OUTLINE_COLOR: 'rgba(0, 0, 0, 0.85)'  // 深色描边保证在底图上可读
    },

    // ---------- Agent（控制聊天 Agent 名称、头像与模拟延迟） ----------
    AGENT: {
        NAME: 'Agent',
        AVATAR: '<img src="images/icons/icon-robot.svg" alt="" class="message-avatar-icon" width="20" height="20" aria-hidden="true">',
        USER_AVATAR: '<img src="images/icons/icon-user.svg" alt="" class="message-avatar-icon" width="20" height="20" aria-hidden="true">',
        AUTO_IMPORT_DELAY: 1000   // 模拟导入延迟（毫秒）
    },

    // ---------- 性能（控制瓦片缓存、网格数量上限与渲染节流） ----------
    PERFORMANCE: {
        MAX_TILE_CACHE: 100,      // 瓦片缓存最大张数
        MAX_GRID_COUNT: 10000,    // 允许渲染的网格数量上限
        RENDER_THROTTLE: 16       // 渲染节流间隔（毫秒），约 60fps
    }
};
