#!/bin/bash
# 3D Earth Platform - Linux / macOS 启动脚本（与 Windows 共用同一套代码，无需单独打包）
# 注意：脚本名是 start.sh，运行命令为 ./start.sh（不是 sart.sh）

set -e
echo "=========================================="
echo "    3D Earth Platform - 启动脚本 (Linux/Mac)"
echo "=========================================="
echo ""

if ! command -v python3 &> /dev/null; then
    echo "[错误] 未检测到 python3，请先安装 Python 3"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 启动前先停掉之前启动的服务（释放 9000、9001 端口，避免 Address already in use）
echo "[0/3] 停止已有服务（若存在）..."
if command -v fuser &> /dev/null; then
    fuser -k 9001/tcp 2>/dev/null || true
    fuser -k 9000/tcp 2>/dev/null || true
elif command -v lsof &> /dev/null; then
    lsof -ti:9001 | xargs kill -9 2>/dev/null || true
    lsof -ti:9000 | xargs kill -9 2>/dev/null || true
else
    pkill -f "map/server.py" 2>/dev/null || true
    pkill -f "backend/server.py" 2>/dev/null || true
fi
sleep 2

# 从项目根目录读取配置
get_url() { python3 "$SCRIPT_DIR/get_config_url.py" "$1" 2>/dev/null || true; }
API_URL="${API_URL:-$(get_url api_server)}"
TILE_URL="${TILE_URL:-$(get_url tile_server)}"
[ -z "$API_URL" ] && API_URL="http://127.0.0.1:9000"
[ -z "$TILE_URL" ] && TILE_URL="http://127.0.0.1:9001"

# 在新终端窗口中运行命令（保留窗口便于看日志）；支持 gnome-terminal / konsole / xterm / macOS Terminal
run_in_new_terminal() {
    local title="$1"
    local cmd="$2"
    if command -v gnome-terminal &> /dev/null; then
        gnome-terminal --title="$title" -- bash -c "echo \"$title\"; echo ''; $cmd; echo ''; echo '服务已退出，按 Enter 关闭窗口'; read"
    elif command -v konsole &> /dev/null; then
        konsole --new-tab -p "TabTitle=$title" -e bash -c "echo \"$title\"; echo ''; $cmd; echo ''; echo '服务已退出，按 Enter 关闭窗口'; read"
    elif command -v xterm &> /dev/null; then
        xterm -T "$title" -e bash -c "echo \"$title\"; echo ''; $cmd; echo ''; echo '服务已退出，按 Enter 关闭窗口'; read"
    elif command -v open &> /dev/null && [[ "$(uname)" == Darwin ]]; then
        echo "[提示] macOS 请手动开两个终端分别运行："
        echo "  终端1: cd '$SCRIPT_DIR/map' && python3 server.py"
        echo "  终端2: cd '$SCRIPT_DIR/backend' && python3 server.py"
    else
        echo "[警告] 未找到 gnome-terminal/konsole/xterm，将在本终端后台启动（输出混在一起）"
        eval "$cmd" &
        return
    fi
}

echo "[1/3] 正在新终端中启动地图服务 (端口 9001)..."
run_in_new_terminal "地图服务 9001" "cd '$SCRIPT_DIR/map' && python3 server.py"
sleep 1

echo "[2/3] 正在新终端中启动 API 服务 (端口 9000)..."
run_in_new_terminal "API 服务 9000" "cd '$SCRIPT_DIR/backend' && python3 server.py"
sleep 2

echo "[3/3] 打开浏览器..."
if command -v xdg-open &> /dev/null; then
    xdg-open "$API_URL" 2>/dev/null || true
elif command -v open &> /dev/null; then
    open "$API_URL" 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo "已在两个独立终端中启动服务"
echo "前端页面: $API_URL"
echo "API:      $API_URL/api"
echo "瓦片:     $TILE_URL"
echo "关闭服务请到对应终端按 Ctrl+C"
echo "=========================================="
