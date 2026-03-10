/**
 * Agent 聊天系统
 * 模拟智能助手对话，支持网格导入流程
 */
class ChatAgent {
    constructor() {
        this.messagesContainer = document.getElementById('chatMessages');
        this.input = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendMessageBtn');
        
        this.messageHistory = [];
        this.isWaitingResponse = false;
        this.pendingImport = false;
        
        this.setupEventListeners();
        
        // 自动触发欢迎消息后的导入建议
        setTimeout(() => {
            this.suggestImport();
        }, 3000);
    }
    
    /**
     * 设置事件监听
     */
    setupEventListeners() {
        // 发送按钮
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // 回车发送
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.isWaitingResponse) {
                this.sendMessage();
            }
        });
        
    }
    
    /**
     * 添加消息
     * @param {string} content - 消息内容
     * @param {string} type - 'user' | 'agent'
     */
    addMessage(content, type = 'agent') {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}-message`;
        
        const time = new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const avatar = type === 'agent' ? Config.AGENT.AVATAR : Config.AGENT.USER_AVATAR;
        const sender = type === 'agent' ? Config.AGENT.NAME : '你';
        
        messageEl.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <div class="message-sender">${sender}</div>
                <div class="message-text">${this.formatMessage(content)}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        
        // 保存到历史
        this.messageHistory.push({ type, content, time });
    }
    
    /**
     * 格式化消息内容（支持简单 markdown）
     */
    formatMessage(content) {
        return content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code>$1</code>');
    }
    
    /**
     * 发送用户消息
     */
    sendMessage() {
        const content = this.input.value.trim();
        if (!content || this.isWaitingResponse) return;
        
        this.addMessage(content, 'user');
        this.input.value = '';
        
        // 如果有待处理的导入，检查用户回复
        if (this.pendingImport) {
            this.handleImportResponse(content);
            return;
        }
        
        // 模拟 Agent 思考并回复
        this.simulateAgentResponse(content);
    }
    
    /**
     * 模拟 Agent 回复
     */
    simulateAgentResponse(userMessage) {
        this.isWaitingResponse = true;
        
        // 显示输入中状态
        this.showTypingIndicator();
        
        setTimeout(() => {
            this.hideTypingIndicator();
            
            const response = this.generateResponse(userMessage);
            this.addMessage(response, 'agent');
            
            this.isWaitingResponse = false;
        }, 1000 + Math.random() * 1000);
    }
    
    /**
     * 生成回复内容
     */
    generateResponse(userMessage) {
        const lowerMsg = userMessage.toLowerCase();
        
        // 导入相关
        if (lowerMsg.includes('导入') || lowerMsg.includes('网格') || lowerMsg.includes('grid')) {
            return this.pendingImport ? 
                '请先确认是否导入当前可用的网格数据？回复"是"或"确认"即可开始导入。' :
                '我可以帮你导入网格数据。系统检测到以下可用数据：\n\n• 初始网格 (initGrid)\n• 任务1网格 (task1Grid)\n• 任务2网格 (task2Grid)\n• 任务3网格 (task3Grid)\n\n需要我现在导入吗？';
        }
        
        // 地图相关
        if (lowerMsg.includes('地图') || lowerMsg.includes('地球') || lowerMsg.includes('map')) {
            return '地图系统已就绪。\n\n你可以：\n• 鼠标拖拽旋转地球\n• 滚轮缩放\n• 右键点击网格弹出菜单（选中/取消选中/查看详情）\n\n需要我帮你加载特定区域的瓦片吗？';
        }
        
        // 帮助
        if (lowerMsg.includes('帮助') || lowerMsg.includes('help') || lowerMsg.includes('能做什么')) {
            return '我可以帮你：\n\n**1. 网格管理**\n• 导入网格数据\n• 查看网格详情\n• 批量选择网格\n\n**2. 地图操作**\n• 飞移到指定位置\n• 调整显示设置\n\n**3. 数据分析**\n• 统计网格数量\n• 分析分布情况\n\n直接告诉我你需要什么帮助！';
        }
        
        // 问候
        if (lowerMsg.includes('你好') || lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
            return '你好！很高兴为你服务。有什么我可以帮你的吗？';
        }
        
        // 默认回复
        const defaults = [
            '收到。请告诉我更多细节，我会尽力协助。',
            '明白了。如果你想导入网格数据或查看地图，请直接告诉我。',
            '好的。我随时准备帮你处理网格和地图相关的任务。',
            '了解。有什么具体的操作需要我执行吗？比如导入网格或飞移到特定位置。'
        ];
        return defaults[Math.floor(Math.random() * defaults.length)];
    }
    
    /**
     * 在聊天中询问是否导入网格（不弹窗，仅发消息；只有用户回复肯定后才加载）
     */
    suggestImport() {
        this.pendingImport = true;
        
        setTimeout(() => {
            this.addMessage(
                '系统检测到可用的网格数据：\n\n' +
                '• **初始网格** - 基础覆盖区域\n' +
                '• **任务1网格** - 第一阶段任务区域\n' +
                '• **任务2网格** - 第二阶段任务区域\n' +
                '• **任务3网格** - 第三阶段任务区域\n\n' +
                '是否导入这些网格数据到地图上？请在下方回复 **是** 或 **确认** 导入，回复 **否** 取消。',
                'agent'
            );
        }, 2000);
    }
    
    /**
     * 处理用户在聊天中的回复：仅当回复肯定内容时才执行导入
     */
    handleImportResponse(content) {
        const positive = ['是', '确认', '好', 'yes', 'ok', '导入', '可以', '行'];
        const negative = ['否', '不', '取消', 'no', '算了'];
        
        const lowerContent = content.toLowerCase();
        
        if (positive.some(word => lowerContent.includes(word))) {
            this.addMessage('好的，正在导入网格数据...', 'agent');
            this.performImport();
        } else if (negative.some(word => lowerContent.includes(word))) {
            this.addMessage('已取消导入。如果需要导入网格，请随时告诉我。', 'agent');
            this.pendingImport = false;
        } else {
            this.addMessage('请确认是否导入：回复"是"导入数据，回复"否"取消。', 'agent');
        }
    }
    
    /**
     * 执行导入操作（与 DA_Interface 一致：请求 task1/task2/task3/group，组装后按 initGrid/task1Grid 等解析）
     */
    async performImport() {
        this.pendingImport = false;
        
        const tasks = ['initGrid', 'task1Grid', 'task2Grid', 'task3Grid'];
        
        try {
            const allGridData = await apiService.getGridDataLikeDA();
            const loaded = [];
            tasks.forEach((taskType) => {
                const arr = allGridData[taskType];
                if (arr && arr.length > 0) {
                    eventBus.emit('grid:load', { data: allGridData, taskType });
                    loaded.push(taskType);
                }
            });
            
            setTimeout(() => {
                this.addMessage(
                    `✅ 导入完成！\n\n成功加载 ${loaded.length} 类网格数据：\n` +
                    loaded.map(t => `• ${Config.GRID_COLORS[t]?.name || t}`).join('\n') +
                    '\n\n网格已显示在地图上，你可以：\n• 调整透明度\n• 右键点击网格弹出选项\n• 查看详细信息',
                    'agent'
                );
                eventBus.emit('grid:importComplete', { tasks: loaded });
            }, 1500);
            
        } catch (error) {
            console.error('Import failed:', error);
            this.addMessage(
                '❌ 导入失败：' + error.message + '\n请检查后端服务是否正常运行。',
                'agent'
            );
        }
    }
    
    /**
     * 显示输入中指示器
     */
    showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'typingIndicator';
        indicator.className = 'message agent-message';
        indicator.innerHTML = `
            <div class="message-avatar">${Config.AGENT.AVATAR}</div>
            <div class="message-content">
                <div class="message-sender">${Config.AGENT.NAME}</div>
                <div class="message-text typing">
                    <span class="dot">.</span>
                    <span class="dot">.</span>
                    <span class="dot">.</span>
                </div>
            </div>
        `;
        
        this.messagesContainer.appendChild(indicator);
        this.scrollToBottom();
    }
    
    /**
     * 隐藏输入中指示器
     */
    hideTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    /**
     * 滚动到底部
     */
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    /**
     * 发送系统消息（非用户触发）
     */
    sendSystemMessage(content) {
        this.addMessage(content, 'agent');
    }
}

// 添加打字指示器样式
const typingStyle = document.createElement('style');
typingStyle.textContent = `
    .typing {
        display: flex;
        gap: 4px;
        padding: 8px 0;
    }
    .typing .dot {
        animation: typing 1.4s infinite;
        font-size: 20px;
        line-height: 10px;
    }
    .typing .dot:nth-child(2) { animation-delay: 0.2s; }
    .typing .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing {
        0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
        30% { opacity: 1; transform: translateY(-4px); }
    }
`;
document.head.appendChild(typingStyle);
