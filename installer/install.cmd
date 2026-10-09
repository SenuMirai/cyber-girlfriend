@echo off
setlocal
title 安装 - 赛博女友

set "SRC=%~dp0app.exe"
set "DESTDIR=%LOCALAPPDATA%\Programs\CyberGirlfriend"
set "DEST=%DESTDIR%\赛博女友.exe"

echo.
echo   ================================
echo      正在安装  赛博女友
echo   ================================
echo.

if not exist "%SRC%" (
  echo   [错误] 安装包里的 app.exe 不见了，请重新下载安装包。
  echo.
  pause
  exit /b 1
)

rem ---- 复制程序本体 ----
if not exist "%DESTDIR%" mkdir "%DESTDIR%" >nul 2>nul
copy /Y "%SRC%" "%DEST%" >nul
if errorlevel 1 (
  echo   [错误] 复制文件失败，可能被杀毒软件拦住了，关掉杀软再试一次。
  echo.
  pause
  exit /b 1
)

rem ---- 使用说明也留一份（安装包的临时目录会被清掉，不复制就看不到）----
if exist "%~dp0readme.txt" copy /Y "%~dp0readme.txt" "%DESTDIR%\使用说明.txt" >nul 2>nul

rem ---- 创建桌面 + 开始菜单快捷方式 ----
powershell -NoProfile -Command "$s=New-Object -ComObject WScript.Shell; $tgt=$env:LOCALAPPDATA+'\Programs\CyberGirlfriend\赛博女友.exe'; $work=$env:LOCALAPPDATA+'\Programs\CyberGirlfriend'; $d=$s.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\赛博女友.lnk'); $d.TargetPath=$tgt; $d.WorkingDirectory=$work; $d.Description='赛博女友'; $d.Save(); $m=$s.CreateShortcut([Environment]::GetFolderPath('Programs')+'\赛博女友.lnk'); $m.TargetPath=$tgt; $m.WorkingDirectory=$work; $m.Description='赛博女友'; $m.Save()" >nul 2>nul

echo   安装完成！
echo.
echo   · 桌面和开始菜单都有「赛博女友」图标，双击即可启动
echo   · 程序装在：%DESTDIR%
echo   · 使用说明：%DESTDIR%\使用说明.txt
echo   · 你的数据（角色、形象图、设置、证书）在：
echo       %LOCALAPPDATA%\赛博女友
echo   · 卸载：直接删掉上面这两个文件夹就行
echo.
echo   现在自动启动一次，浏览器会自动打开……
ping -n 3 127.0.0.1 >nul
start "" "%DEST%"
exit /b 0
