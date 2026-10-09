@echo off
cd /d "%~dp0"
title 赛博女友

echo.
echo   ================================
echo      赛博女友  正在启动
echo   ================================
echo.

rem ---- 端口以 config.json 为准（读不到就用 3000），保证和设置里改的端口一致 ----
set "PORT=3000"
for /f "delims=" %%p in ('node -e "try{process.stdout.write(String(require('./config.json').port||3000))}catch(e){process.stdout.write('3000')}" 2^>nul') do set "PORT=%%p"

rem ---- 已经在运行：直接打开页面，避免重复启动 ----
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if($p){exit 0}else{exit 1}" >nul 2>nul
if %errorlevel%==0 (
  echo   服务已经在运行，正在打开页面...
  start "" http://localhost:%PORT%
  ping -n 3 127.0.0.1 >nul
  exit /b
)

rem ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo   [错误] 没有检测到 Node.js
  echo   请先安装：https://nodejs.org/  选 LTS 版，一路下一步即可
  echo.
  pause
  exit /b
)

rem ---- 首次启动自动装依赖 ----
if not exist "node_modules" (
  echo   首次启动，正在安装依赖（只做一次，稍等）...
  call npm install
  echo.
)
if not exist "public\app.js" (
  echo   正在打包前端...
  call npm run build
  echo.
)

echo   启动中... 下面会列出手机/平板可以打开的地址
echo   要关闭：直接关掉本窗口，或双击 关闭.cmd
echo.
node server.mjs

echo.
echo   服务已停止。
pause
