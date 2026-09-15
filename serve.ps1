# ============================================================
# 龙南客家非遗数字助手 · 本地服务 + 扫码访问
# 用法：右键此文件 -> 使用 PowerShell 运行，或在终端执行：
#   powershell -ExecutionPolicy Bypass -File serve.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 获取本机局域网 IP
function Get-LanIP {
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -ne "127.0.0.1" -and
                $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL|Teredo|isatap"
            } |
            Select-Object -ExpandProperty IPAddress
        if ($ips) { return $ips[0] }
    } catch { }
    try {
        $socket = New-Object System.Net.Sockets.Socket(
            [System.Net.Sockets.AddressFamily]::InterNetwork,
            [System.Net.Sockets.SocketType]::Dgram,
            [System.Net.Sockets.ProtocolType]::Udp)
        $socket.Connect("8.8.8.8", 80)
        $ip = ($socket.LocalEndPoint).Address.ToString()
        $socket.Close()
        if ($ip -and $ip -ne "0.0.0.0") { return $ip }
    } catch { }
    return "127.0.0.1"
}

# 找一个空闲端口（默认 8787，被占用则顺延）
$port = 8787
while ($port -lt 8800) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) { break }
    $port++
}

$ip = Get-LanIP
$url = "http://${ip}:${port}/"

Write-Host ""
Write-Host "==============================================" -ForegroundColor DarkGreen
Write-Host " 龙南客家非遗数字助手 · 本地服务" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor DarkGreen
Write-Host ""
Write-Host "  本机访问 : http://localhost:$port/" -ForegroundColor Cyan
Write-Host "  扫码访问 : $url" -ForegroundColor Yellow
Write-Host ""
Write-Host "  手机需与电脑连接同一 Wi-Fi，" -ForegroundColor Gray
Write-Host "  打开页面右上角「二维码」按钮即可展示扫码。" -ForegroundColor Gray
Write-Host ""
Write-Host "  按 Ctrl+C 停止服务" -ForegroundColor DarkGray
Write-Host ""

Start-Process $url

# 启动静态服务器（Python 随系统或 MiMo 运行时提供）
$python = $null
foreach ($cand in @($env:MIMO_PYTHON, "python", "python3", "py")) {
    if ($cand) {
        try {
            $ver = & $cand --version 2>$null
            if ($ver) { $python = $cand; break }
        } catch { }
    }
}

if (-not $python) {
    Write-Host "  未找到 Python，改用 .NET HttpListener 启动服务..." -ForegroundColor Yellow

    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Prefixes.Add("http://$($ip):$port/")
    $listener.Start()
    Write-Host "  服务已启动（.NET）" -ForegroundColor Green

    try {
        while ($listener.IsListening) {
            $ctx = $listener.GetContext()
            $path = $ctx.Request.Url.LocalPath.TrimStart('/')
            if ($path -eq "") { $path = "index.html" }
            $file = Join-Path $root ($path -replace '/', '\')
            if (Test-Path $file -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($file)
                $ext = [IO.Path]::GetExtension($file).ToLower()
                $mime = switch ($ext) {
                    ".html" { "text/html; charset=utf-8" }
                    ".css"  { "text/css; charset=utf-8" }
                    ".js"   { "application/javascript; charset=utf-8" }
                    ".png"  { "image/png" }
                    ".jpg"  { "image/jpeg" }
                    ".svg"  { "image/svg+xml" }
                    ".ico"  { "image/x-icon" }
                    default { "application/octet-stream" }
                }
                $ctx.Response.ContentType = $mime
                $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $ctx.Response.StatusCode = 404
                $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
            }
            $ctx.Response.Close()
        }
    } finally {
        $listener.Stop()
    }
} else {
    Write-Host "  使用 $python 启动静态服务器..." -ForegroundColor Green
    & $python -m http.server $port --bind 0.0.0.0
}
