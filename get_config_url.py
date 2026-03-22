#!/usr/bin/env python3
"""从 config.json 读取地址，供启动脚本使用。用法: python get_config_url.py [api_server|tile_server]"""
import json
import os
import sys

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, "config.json")
    default_api = "http://127.0.0.1:9000"
    default_tile = "http://127.0.0.1:9001"
    key = (sys.argv[1:] or ["api_server"])[0].strip().lower()
    if key in ("tile", "tile_server", "tile_server_public"):
        default, cfg_key = default_tile, "tile_server_public"
    else:
        default, cfg_key = default_api, "api_server"
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                c = json.load(f)
            val = c.get(cfg_key) or (c.get("tile_service_url") if cfg_key == "tile_server_public" else None) or default
        except Exception:
            val = default
    else:
        val = default
    print(val.rstrip("/"))

if __name__ == "__main__":
    main()
