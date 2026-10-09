@echo off
title 关闭 - 赛博女友

echo.
echo   正在关闭赛博女友...

rem ---- 1) 走接口优雅退出（默认端口；改过端口也没关系，下面有兜底）----
powershell -NoProfile -Command "foreach($p in 3000,3443){try{Invoke-WebRequest -UseBasicParsing -Method POST -TimeoutSec 2 ('http://127.0.0.1:'+$p+'/shutdown') | Out-Null}catch{}}" >nul 2>nul

rem ---- 2) 兜底：按命令行匹配，杀掉所有跑 server.mjs 的 node 进程（与端口无关）----
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

rem ---- 3) 再兜底：占用 3000 端口的进程 ----
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if($p){$p.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }}" >nul 2>nul

echo   已关闭。
ping -n 3 127.0.0.1 >nul
