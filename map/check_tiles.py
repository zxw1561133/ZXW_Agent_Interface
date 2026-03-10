#!/usr/bin/env python3
"""
瓦片数据检测脚本：检查本地瓦片是否符合 Cesium 引擎要求
运行方式：在 map 目录下执行 python check_tiles.py
"""
import os
import sys

# 与 server.py 保持一致
TILES_DIR = r'F:\jk\天津滨海\cursor\map_test\tiles'

# Cesium WebMercator 对 level 1 必须有的 4 张瓦片：(z, x, y)
CESIUM_LEVEL1_REQUIRED = [(1, 0, 0), (1, 0, 1), (1, 1, 0), (1, 1, 1)]


def main():
    print("=" * 60)
    print("  瓦片数据检测（Cesium WebMercator 要求）")
    print("=" * 60)
    print(f"瓦片目录: {TILES_DIR}\n")

    if not os.path.exists(TILES_DIR):
        print("[错误] 目录不存在，请检查 TILES_DIR 或路径。")
        sys.exit(1)

    # 按 z/x/y 结构扫描（标准：tiles/z/x/y.jpg）
    tiles = []
    for z_dir in os.listdir(TILES_DIR):
        z_path = os.path.join(TILES_DIR, z_dir)
        if not os.path.isdir(z_path):
            continue
        try:
            z = int(z_dir)
        except ValueError:
            continue
        for x_dir in os.listdir(z_path):
            x_path = os.path.join(z_path, x_dir)
            if not os.path.isdir(x_path):
                continue
            try:
                x = int(x_dir)
            except ValueError:
                continue
            for f in os.listdir(x_path):
                if f.endswith((".jpg", ".jpeg", ".png")):
                    base, ext = os.path.splitext(f)
                    try:
                        y = int(base)
                        tiles.append((z, x, y, ext.lower()))
                    except ValueError:
                        pass

    tiles_set = {(z, x, y) for z, x, y, _ in tiles}
    ext_used = set(e for _, _, _, e in tiles)

    # 按层级统计
    levels = {}
    for z, x, y, e in tiles:
        levels.setdefault(z, []).append((x, y))
    levels = {k: sorted(set(v)) for k, v in levels.items()}

    print("[1] 目录结构：z/x/y 形式（例如 1/0/0.jpg）")
    print("    当前检测到的层级 (z) 及每层瓦片数：")
    for z in sorted(levels.keys()):
        pts = levels[z]
        print(f"      z={z}: {len(pts)} 张瓦片")
    if not levels:
        print("      （未发现符合 z/x/y 的瓦片文件）")
    print()

    print("[2] Cesium 要求（WebMercator，level 1 最少 4 张）")
    print("    必须存在: 1/0/0, 1/0/1, 1/1/0, 1/1/1（扩展名 .jpg 或 .png）")
    missing = [t for t in CESIUM_LEVEL1_REQUIRED if t not in tiles_set]
    if not missing:
        print("    [OK] level 1 的 4 张瓦片齐全")
    else:
        print(f"    [X] 缺少: {missing}")
        for (z, x, y) in missing:
            print(f"        {z}/{x}/{y}.jpg 或 .png")
    print()

    print("[3] 扩展名")
    if ext_used:
        print(f"    当前瓦片扩展名: {', '.join(ext_used)}")
        if ".jpg" not in ext_used and ".jpeg" not in ext_used and ".png" in ext_used:
            print("    注意: 当前引擎请求的是 .jpg，若你只有 .png 需改前端或重命名/双写。")
    print()

    print("[4] 行列约定（避免贴反）")
    print("    Cesium WebMercator: x=列(西→东), y=行(北→南)，y=0 为北侧。")
    print("    若你的瓦片是 TMS（y=0 为南），需在前端使用 {reverseY} 替代 {y}。")
    print()

    # 示例路径（从 config.json 读取，与项目一致）
    print("[5] 建议在浏览器直接访问测试")
    base = "http://127.0.0.1:9001"
    _config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config.json")
    if os.path.exists(_config_path):
        try:
            import json
            with open(_config_path, "r", encoding="utf-8") as f:
                c = json.load(f)
            base = (c.get("tile_server_public") or c.get("tile_service_url") or base).rstrip("/")
        except Exception:
            pass
    for (z, x, y) in CESIUM_LEVEL1_REQUIRED[:2]:
        print(f"    {base}/{z}/{x}/{y}.jpg")
    print()
    print("=" * 60)


if __name__ == "__main__":
    main()
