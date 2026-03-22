/**
 * Agent 聊天系统
 * 模拟智能助手对话，支持网格导入流程
 */
class ChatAgent {
    constructor(app = null) {
        this.app = app;
        this.messagesContainer = document.getElementById('chatMessages');
        this.input = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendMessageBtn');
        
        this.messageHistory = [];
        this.isWaitingResponse = false;
        this.pendingImport = false;
        
        this.setupEventListeners();
    }
    
    /**
     * 设置事件监听
     */
    setupEventListeners() {
        // 发送按钮点击
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        // 回车键发送
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.isWaitingResponse) {
                this.sendMessage();
            }
        });
        
    }
    
    /**
     * 添加消息（内容在此时刻做快照并一次性写入 DOM，之后绝不修改，保证聊天记录不可变）
     * 使用 createElement + textContent 逐节点构建，确保每条消息完全独立，不受后续数据变化影响。
     * @param {string} content - 消息内容，会立即被复制为字符串快照
     * @param {string} type - 'user' | 'agent'
     */
    addMessage(content, type = 'agent') {
        const raw = typeof content === 'string' ? content : (content == null ? '' : String(content));
        const contentSnapshot = raw.slice(0);
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const s = now.getSeconds();
        const ms = now.getMilliseconds();
        const timeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}-message`;
        messageEl.dataset.msgId = now.getTime() + '-' + Math.random().toString(36).slice(2, 8);
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = type === 'agent' ? Config.AGENT.AVATAR : Config.AGENT.USER_AVATAR;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = type === 'agent' ? Config.AGENT.NAME : '你';
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        const lines = contentSnapshot.split('\n');
        lines.forEach((line, idx) => {
            if (idx > 0) textDiv.appendChild(document.createElement('br'));
            const lineSpan = document.createElement('span');
            lineSpan.textContent = line;
            textDiv.appendChild(lineSpan);
        });
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = timeStr;
        contentDiv.appendChild(senderDiv);
        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(timeDiv);
        messageEl.appendChild(avatarDiv);
        messageEl.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        this.messageHistory.push({ type, content: contentSnapshot, time: timeStr, id: messageEl.dataset.msgId });
    }
    
    /**
     * 发送用户消息
     */
    sendMessage() {
        const content = this.input.value.trim();
        if (!content || this.isWaitingResponse) return;
        
        this.addMessage(content, 'user');
        this.input.value = '';
        
        // 有待处理导入时根据用户回复决定是否执行
        if (this.pendingImport) {
            this.handleImportResponse(content);
            return;
        }
        // 任务区域确认流程：接收/不接受或需要修改、已修改完毕
        if (this.app && typeof this.app.handleTaskAreaConfirmationReply === 'function' && this.app.handleTaskAreaConfirmationReply(content)) {
            return;
        }
        
        this.simulateAgentResponse(content);
    }
    
    /**
     * 模拟 Agent 回复
     */
    simulateAgentResponse(userMessage) {
        this.isWaitingResponse = true;
        
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
        
        if (lowerMsg.includes('导入') || lowerMsg.includes('网格') || lowerMsg.includes('grid')) {
            return this.pendingImport ? 
                '请先确认是否导入当前可用的网格数据？回复"是"或"确认"即可开始导入。' :
                '我可以帮你导入网格数据。系统检测到以下可用数据：\n\n• 初始网格 (initGrid)\n• 任务1网格 (task1Grid)\n• 任务2网格 (task2Grid)\n• 任务3网格 (task3Grid)\n\n需要我现在导入吗？';
        }
        
        if (lowerMsg.includes('地图') || lowerMsg.includes('地球') || lowerMsg.includes('map')) {
            return '地图系统已就绪。\n\n你可以：\n• 鼠标拖拽旋转地球\n• 滚轮缩放\n• 右键点击网格弹出菜单（选中/取消选中/查看详情）\n\n需要我帮你加载特定区域的瓦片吗？';
        }
        
        if (lowerMsg.includes('帮助') || lowerMsg.includes('help') || lowerMsg.includes('能做什么')) {
            return '我可以帮你：\n\n**1. 网格管理**\n• 导入网格数据\n• 查看网格详情\n• 批量选择网格\n\n**2. 地图操作**\n• 飞移到指定位置\n• 调整显示设置\n\n**3. 数据分析**\n• 统计网格数量\n• 分析分布情况\n\n直接告诉我你需要什么帮助！';
        }
        
        if (lowerMsg.includes('你好') || lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
            return '你好！很高兴为你服务。有什么我可以帮你的吗？';
        }
        
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
     * 执行导入操作（请求 initGrid/task1/task2/task3/group 五类独立接口，组装后按 initGrid/task1Grid 等解析）
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
                eventBus.emit('grid:importComplete', { tasks: loaded, task3Preferences: allGridData.task3Preferences });
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
     * 发送系统消息（非用户触发）。内容会在发送时固化为快照，之后不会随外部数据变化。
     */
    sendSystemMessage(content) {
        const snapshot = (typeof content === 'string' ? content : (content == null ? '' : String(content))).slice(0);
        this.addMessage(snapshot, 'agent');
    }

    /**
     * 任务区域待确认：交互卡片（操作按钮），非普通纯文本提示。
     * @param {string} dataText - 本次数据摘要快照
     * @param {{ variant?: 'initial' | 'updated' }} [options] - initial：Agent 首次下发；updated：在等待确认期间服务端数据再次变更
     */
    addTaskAreaConfirmCard(dataText, options = {}) {
        const variant = options.variant === 'updated' ? 'updated' : 'initial';
        const dataSnapshot = typeof dataText === 'string' ? dataText.slice(0) : '';
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const s = now.getSeconds();
        const ms = now.getMilliseconds();
        const timeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
        const messageEl = document.createElement('div');
        messageEl.className = 'message agent-message message-card message-task-area-confirm';
        messageEl.dataset.msgId = now.getTime() + '-' + Math.random().toString(36).slice(2, 8);
        messageEl.dataset.cardKind = variant === 'updated' ? 'task_area_confirm_updated' : 'task_area_confirm';

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = Config.AGENT.AVATAR;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content message-card-shell';
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = Config.AGENT.NAME;

        const badge = document.createElement('div');
        badge.className = 'message-card-badge' + (variant === 'updated' ? ' message-card-badge-warn' : '');
        badge.textContent = variant === 'updated' ? '任务区域已更新' : '任务区域确认';

        const desc = document.createElement('div');
        desc.className = 'message-card-desc';
        desc.textContent = variant === 'updated'
            ? '服务端任务区域数据已更新，地图已按最新数据重绘。请再次确认是否接收该分配用于后续任务网格生成，或选择需要修改。'
            : '已收到预生成的任务区域数据并已绘制显示。是否接收该任务区域分配用于后续任务网格生成？请选择操作：';

        const dataPre = document.createElement('pre');
        dataPre.className = 'message-card-data';
        dataPre.textContent = (variant === 'updated' ? '当前数据（与地图一致）：\n' : '本次数据（预生成）：\n') + dataSnapshot;

        const actions = document.createElement('div');
        actions.className = 'message-card-actions';
        const btnAccept = document.createElement('button');
        btnAccept.type = 'button';
        btnAccept.className = 'btn-task-card btn-task-card-primary';
        btnAccept.textContent = '接收';
        const btnReject = document.createElement('button');
        btnReject.type = 'button';
        btnReject.className = 'btn-task-card btn-task-card-secondary';
        btnReject.textContent = '不接受 / 需要修改';
        actions.appendChild(btnAccept);
        actions.appendChild(btnReject);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = timeStr;

        const disableCard = () => {
            messageEl.dataset.cardConsumed = '1';
            btnAccept.disabled = true;
            btnReject.disabled = true;
        };

        btnAccept.addEventListener('click', () => {
            if (messageEl.dataset.cardConsumed === '1') return;
            disableCard();
            if (this.app && typeof this.app.onTaskAreaConfirmAccept === 'function') {
                this.app.onTaskAreaConfirmAccept();
            }
        });
        btnReject.addEventListener('click', () => {
            if (messageEl.dataset.cardConsumed === '1') return;
            disableCard();
            if (this.app && typeof this.app.onTaskAreaConfirmRejectModify === 'function') {
                this.app.onTaskAreaConfirmRejectModify();
            }
        });

        contentDiv.appendChild(senderDiv);
        contentDiv.appendChild(badge);
        contentDiv.appendChild(desc);
        contentDiv.appendChild(dataPre);
        contentDiv.appendChild(actions);
        contentDiv.appendChild(timeDiv);
        messageEl.appendChild(avatarDiv);
        messageEl.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        this.messageHistory.push({
            type: 'agent',
            kind: messageEl.dataset.cardKind,
            content: (variant === 'updated' ? '[任务区域更新卡片]\n' : '[任务区域确认卡片]\n') + dataSnapshot,
            time: timeStr,
            id: messageEl.dataset.msgId
        });
    }

    /**
     * 任务区域修改后：询问是否已改完（按钮）。
     * @param {string} [dataText] - 本次保存后的数据摘要（与地图一致）
     */
    addTaskAreaModifyDoneCard(dataText) {
        const dataSnapshot = typeof dataText === 'string' ? dataText.slice(0) : '';
        const now = new Date();
        const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0') + '.' + String(now.getMilliseconds()).padStart(3, '0');
        const messageEl = document.createElement('div');
        messageEl.className = 'message agent-message message-card message-task-area-modify';
        messageEl.dataset.msgId = now.getTime() + '-' + Math.random().toString(36).slice(2, 8);
        messageEl.dataset.cardKind = 'task_area_modify_done';

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = Config.AGENT.AVATAR;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content message-card-shell';
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = Config.AGENT.NAME;

        const badge = document.createElement('div');
        badge.className = 'message-card-badge message-card-badge-modify';
        badge.textContent = '修改后确认';

        const desc = document.createElement('div');
        desc.className = 'message-card-desc';
        desc.textContent = '您刚才保存的是修改后的任务区域（地图与下方数据一致）。若已全部调整完毕，请点击「已修改完毕」将数据返回请求端；否则可继续拖动修改并再次保存。';

        let dataPre = null;
        if (dataSnapshot.trim()) {
            dataPre = document.createElement('pre');
            dataPre.className = 'message-card-data';
            dataPre.textContent = '本次保存后的数据：\n' + dataSnapshot;
        }

        const actions = document.createElement('div');
        actions.className = 'message-card-actions';
        const btnDone = document.createElement('button');
        btnDone.type = 'button';
        btnDone.className = 'btn-task-card btn-task-card-primary';
        btnDone.textContent = '已修改完毕';
        const btnMore = document.createElement('button');
        btnMore.type = 'button';
        btnMore.className = 'btn-task-card btn-task-card-secondary';
        btnMore.textContent = '继续修改';
        actions.appendChild(btnDone);
        actions.appendChild(btnMore);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = timeStr;

        const disableCard = () => {
            messageEl.dataset.cardConsumed = '1';
            btnDone.disabled = true;
            btnMore.disabled = true;
        };

        btnDone.addEventListener('click', () => {
            if (messageEl.dataset.cardConsumed === '1') return;
            disableCard();
            if (this.app && typeof this.app.onTaskAreaModifyDone === 'function') {
                this.app.onTaskAreaModifyDone();
            }
        });
        btnMore.addEventListener('click', () => {
            if (messageEl.dataset.cardConsumed === '1') return;
            disableCard();
            if (this.app && typeof this.app.onTaskAreaContinueModify === 'function') {
                this.app.onTaskAreaContinueModify();
            }
        });

        contentDiv.appendChild(senderDiv);
        contentDiv.appendChild(badge);
        contentDiv.appendChild(desc);
        if (dataPre) contentDiv.appendChild(dataPre);
        contentDiv.appendChild(actions);
        contentDiv.appendChild(timeDiv);
        messageEl.appendChild(avatarDiv);
        messageEl.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        this.messageHistory.push({
            type: 'agent',
            kind: 'task_area_modify_done',
            content: '[任务区域修改确认卡片]\n' + dataSnapshot,
            time: timeStr,
            id: messageEl.dataset.msgId
        });
    }
}

// 打字指示器内联样式
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
