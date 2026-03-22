@echo off
chcp 65001 >nul
setlocal
set "SCRIPT_DIR=%~dp0"
set "TARGET=%SCRIPT_DIR%Cesium"
set "ZIP_URL=https://github.com/CesiumGS/cesium/releases/download/1.110/Cesium-1.110.zip"
set "TEMP_ZIP=%TEMP%\Cesium-1.110.zip"
set "TEMP_EXTRACT=%TEMP%\Cesium-1.110-extract"

echo.
echo 正在下载 Cesium 1.110 并部署到本地...
echo.

if exist "%TARGET%\Cesium.js" (
    echo [跳过] 已存在 %TARGET%\Cesium.js，如需重新下载请先删除 Cesium 文件夹。
    goto :eof
)

mkdir "%TARGET%" 2>nul
powershell -NoProfile -Command ^
    "try { ^
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
        Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing; ^
        Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_EXTRACT%' -Force; ^
        $build = Join-Path '%TEMP_EXTRACT%' 'Build\Cesium'; ^
        if (-not (Test-Path $build)) { $build = Join-Path '%TEMP_EXTRACT%' 'Cesium-1.110\Build\Cesium' }; ^
        if (Test-Path $build) { Copy-Item -Path (Join-Path $build '*') -Destination '%TARGET%' -Recurse -Force; echo '[OK] 已解压到 '%TARGET%'' } ^
        else { echo '[错误] 压缩包内未找到 Build/Cesium' }; ^
        Remove-Item '%TEMP_ZIP%' -Force -ErrorAction SilentlyContinue; ^
        Remove-Item '%TEMP_EXTRACT%' -Recurse -Force -ErrorAction SilentlyContinue; ^
    } catch { Write-Host '[错误]' $_.Exception.Message }"

if exist "%TARGET%\Cesium.js" (
    echo.
    echo 部署完成。请刷新页面使用本地 Cesium。
) else (
    echo.
    echo 自动下载失败，请按 frontend\lib\README_Cesium.md 手动下载并解压到 frontend\lib\Cesium\
)
echo.
endlocal
