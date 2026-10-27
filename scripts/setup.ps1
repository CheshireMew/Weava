$ErrorActionPreference = 'Stop'
$frameworkRoot = Split-Path -Parent $PSScriptRoot
$nodePath = if ($env:WEAVA_NODE) { $env:WEAVA_NODE } else { 'D:\Tools\NodeJS\node.exe' }
if (!(Test-Path -LiteralPath $nodePath)) { throw '请先准备 Node 24，并通过 WEAVA_NODE 指定 node.exe。' }
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $env:PATH
$env:TEMP='D:\Tools\cache\weava'; $env:TMP=$env:TEMP; $env:npm_config_cache='D:\Tools\cache\weava\npm'
New-Item -ItemType Directory -Path 'D:\Tools\cache\weava','D:\Tools\weava-tooling' -Force | Out-Null
$pnpmPath='D:\Tools\weava-tooling\node_modules\pnpm\bin\pnpm.mjs'
if (!(Test-Path -LiteralPath $pnpmPath)) { & (Join-Path (Split-Path -Parent $nodePath) 'npm.cmd') install --prefix 'D:\Tools\weava-tooling' pnpm@12.4.2 --no-audit --no-fund; if($LASTEXITCODE) { exit $LASTEXITCODE } }
Push-Location -LiteralPath $frameworkRoot
try { & $nodePath $pnpmPath install --frozen-lockfile --store-dir 'D:\Tools\pnpm-store'; exit $LASTEXITCODE } finally { Pop-Location }
