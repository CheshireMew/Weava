param(
    [Parameter(Mandatory=$true)][string]$Program,
    [string]$Root = 'E:\WeavaRuntime',
    [string]$SitesRoot,
    [string]$BackupRoot,
    [string]$Node = 'D:\Tools\NodeJS\node.exe'
)
$ErrorActionPreference = 'Stop'
$programRoot = (Get-Item -LiteralPath $Program).FullName
$installArguments = @((Join-Path $programRoot 'runtime\manager.mjs'), '--installation', $Root, 'install', '--program', $programRoot, '--node', $Node)
if ($SitesRoot) { $installArguments += @('--sites-root', $SitesRoot) }
if ($BackupRoot) { $installArguments += @('--backup-root', $BackupRoot) }
& $Node @installArguments
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$frameworkRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $frameworkRoot 'dist'
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
@{ root = [IO.Path]::GetFullPath($Root) } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $distRoot 'installation.json') -Encoding UTF8
