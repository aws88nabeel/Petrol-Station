@echo off
REM Launch the full Station ERP stack (backend + frontend)
REM Opens two terminals: backend on :4000, frontend on :5173

start "ERP Backend :4000" cmd /k "cd /d %~dp0erp-backend && node src/server.js"
timeout /t 2 >nul
start "ERP Frontend :5173" cmd /k "cd /d %~dp0erp-frontend && npm.cmd run dev"
echo.
echo Station ERP started:
echo   Backend   http://localhost:4000
echo   Frontend  http://localhost:5173
echo.
echo Demo logins:  admin/admin123  manager/manager123  cashier/cashier123  viewer/viewer123