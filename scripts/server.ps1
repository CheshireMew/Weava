param(
    [Parameter(Mandatory=$true)][string]$Site,
    [Parameter(Mandatory=$true)][string]$BackupRoot,
    [Parameter(Mandatory=$true)][uri]$PublicOrigin,
    [string]$Account = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [ValidateRange(1024,65535)][int]$Port = 4322,
    [switch]$Prepare,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '这个部署入口当前只验收 Windows。' }
if ($Prepare -and $CheckOnly) { throw 'Prepare 和 CheckOnly 不能同时使用。' }
if ($PublicOrigin.Scheme -ne 'https' -or $PublicOrigin.UserInfo -or $PublicOrigin.AbsolutePath -ne '/' -or $PublicOrigin.Query -or $PublicOrigin.Fragment) { throw 'PublicOrigin 必须是不带路径、账户和查询参数的 HTTPS 网站地址。' }
$frameworkRoot = Split-Path -Parent $PSScriptRoot
$serviceSid = ([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier])
$allowedSids = @($serviceSid.Value, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
function Resolve-PrivateRoot([string]$Value) {
    if (![IO.Path]::IsPathRooted($Value)) { throw '站点和备份必须使用完整绝对路径。' }
    $path = (Get-Item -LiteralPath $Value -Force).FullName
    if ($path.TrimEnd('\') -eq [IO.Path]::GetPathRoot($path).TrimEnd('\')) { throw '不能把磁盘根目录作为站点或备份目录。' }
    $parent = Get-Item -LiteralPath $path -Force
    while ($parent) {
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "目录及其上级不能包含目录链接：$($parent.FullName)" }
        $parent = $parent.Parent
    }
    if (!(Test-Path -LiteralPath $path -PathType Container)) { throw '站点和备份根目录必须是普通目录。' }
    return $path.TrimEnd('\')
}
$siteRoot = Resolve-PrivateRoot $Site
$backupPath = Resolve-PrivateRoot $BackupRoot
$frameworkPath = [IO.Path]::GetFullPath($frameworkRoot).TrimEnd('\')
if ($siteRoot.Equals($backupPath,[StringComparison]::OrdinalIgnoreCase) -or $siteRoot.StartsWith($backupPath+'\',[StringComparison]::OrdinalIgnoreCase) -or $backupPath.StartsWith($siteRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '站点与备份必须使用互不包含的独立目录。' }
foreach ($path in @($siteRoot,$backupPath)) {
    if ($path.Equals($frameworkPath,[StringComparison]::OrdinalIgnoreCase) -or $path.StartsWith($frameworkPath+'\',[StringComparison]::OrdinalIgnoreCase) -or $frameworkPath.StartsWith($path+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '站点、备份和程序仓库必须互相独立。' }
}
if (!(Test-Path -LiteralPath (Join-Path $siteRoot 'site.json'))) { throw '请先初始化站点。' }
if (!(Test-Path -LiteralPath (Join-Path $frameworkRoot 'dist\current.json'))) { throw '请先构建生产程序。' }
# Resolve and inspect the entire chosen trees before changing any permissions.
$members = @((Get-Item -LiteralPath $siteRoot),(Get-Item -LiteralPath $backupPath)) + @(Get-ChildItem -LiteralPath $siteRoot,$backupPath -Force -Recurse)
foreach ($member in $members) {
    if ($member.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "数据目录不能含有链接：$($member.FullName)" }
}
if ($Prepare) {
    foreach ($member in $members) {
        $acl = if ($member.PSIsContainer) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
        $acl.SetAccessRuleProtection($true,$false)
        foreach ($sid in $allowedSids) {
            $identity = [Security.Principal.SecurityIdentifier]::new($sid)
            if ($member.PSIsContainer) {
                $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
            } else { $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow') }
            $acl.AddAccessRule($rule)
        }
        # Apply only the new DACL; Set-Acl can request unrelated SACL privileges on some hosts.
        if ($PSVersionTable.PSEdition -eq 'Core') {
            [IO.FileSystemAclExtensions]::SetAccessControl($member,$acl)
        } else { $member.SetAccessControl($acl) }
    }
    Write-Output '站点和备份权限已设置，仅服务账户、SYSTEM 和 Administrators 可访问。'
    exit 0
}
foreach ($member in $members) {
    $acl = Get-Acl -LiteralPath $member.FullName
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($rule.AccessControlType -eq 'Allow' -and $sid -notin $allowedSids) { throw "数据权限过宽：$($member.FullName)。请先由管理员执行 -Prepare。" }
    }
    $granted = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
    if ($serviceSid.Value -notin $granted) { throw "服务账户没有数据权限：$($member.FullName)" }
}
if ($CheckOnly) { Write-Output '部署参数、数据目录及访问权限检查通过。'; exit 0 }
$current = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($current.User.Value -ne $serviceSid.Value) { throw '请以指定的服务账户启动程序。' }
if (([Security.Principal.WindowsPrincipal]::new($current)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '网站不能使用管理员权限运行，请使用独立普通账户。' }
$env:HOST = '127.0.0.1'
$env:WEAVA_TRUST_PROXY = '1'
$env:WEAVA_TRUSTED_PROXIES = '127.0.0.1,::1'
$env:WEAVA_REQUIRE_HTTPS = '1'
$env:WEAVA_BACKUP_ROOT = $backupPath
$publicUrl = $PublicOrigin.GetLeftPart([UriPartial]::Authority)
& (Join-Path $PSScriptRoot 'run.ps1') --site $siteRoot --url $publicUrl start --port $Port
exit $LASTEXITCODE
