# 설치가 필요 없는 아주 작은 웹 서버(Windows 기본 PowerShell 사용). 이 창을 닫으면 서버도 꺼집니다.
$root = Join-Path $PSScriptRoot 'site'
$port = 8080
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8';
           '.png'='image/png'; '.webp'='image/webp'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.txt'='text/plain; charset=utf-8'; '.woff2'='font/woff2' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch { Write-Host "서버를 켤 수 없어요. 다른 프로그램이 $port 번을 쓰고 있을 수 있어요."; Read-Host '엔터를 누르면 닫혀요'; exit 1 }
Write-Host "게임이 켜졌어요: http://localhost:$port/   (이 창을 닫으면 꺼져요)"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($path.EndsWith('/')) { $path += 'index.html' }
  $file = Join-Path $root ($path.TrimStart('/') -replace '/', '\')
  $full = [IO.Path]::GetFullPath($file)
  if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
    $ext = [IO.Path]::GetExtension($full).ToLower()
    $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
    $bytes = [IO.File]::ReadAllBytes($full)
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
