param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WeavaArguments)
$ErrorActionPreference = 'Stop'
$frameworkRoot = Split-Path -Parent $PSScriptRoot
$nodePath = if ($env:WEAVA_NODE) { $env:WEAVA_NODE } elseif (Test-Path -LiteralPath 'D:\Tools\NodeJS\node.exe') { 'D:\Tools\NodeJS\node.exe' } else { (Get-Command node -ErrorAction Stop).Source }
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $env:PATH
$env:WEAVA_FRAMEWORK = $frameworkRoot
$env:ASTRO_TELEMETRY_DISABLED = '1'
if (Test-Path -LiteralPath 'D:\Tools\cache\weava') { $env:TEMP='D:\Tools\cache\weava'; $env:TMP=$env:TEMP }
Push-Location -LiteralPath $frameworkRoot
try { & $nodePath --import tsx (Join-Path $frameworkRoot 'packages\cli\src\index.ts') @WeavaArguments; exit $LASTEXITCODE } finally { Pop-Location }
