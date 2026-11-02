param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WeavaArguments)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($WeavaArguments.Count -gt 0 -and $WeavaArguments[0] -eq 'start') {
    Write-Host '正在启动 Weava，请保持此窗口打开。'
    Write-Host '按 Ctrl+C 停止服务。'
    Write-Host ''
}
$frameworkRoot = Split-Path -Parent $PSScriptRoot
$nodePath = if ($env:WEAVA_NODE) { $env:WEAVA_NODE } elseif (Test-Path -LiteralPath 'D:\Tools\NodeJS\node.exe') { 'D:\Tools\NodeJS\node.exe' } else { (Get-Command node -ErrorAction Stop).Source }
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $env:PATH
$env:WEAVA_FRAMEWORK = $frameworkRoot
$env:ASTRO_TELEMETRY_DISABLED = '1'
if (Test-Path -LiteralPath 'D:\Tools\cache\weava') { $env:TEMP='D:\Tools\cache\weava'; $env:TMP=$env:TEMP }
Push-Location -LiteralPath $frameworkRoot
try { & $nodePath --import tsx (Join-Path $frameworkRoot 'packages\cli\src\index.ts') @WeavaArguments; exit $LASTEXITCODE } finally { Pop-Location }
