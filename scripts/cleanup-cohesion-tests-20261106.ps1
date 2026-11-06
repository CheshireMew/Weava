# User-approved cleanup for this exact test run. This is not a general cache cleaner.
# Preview: powershell.exe -NoProfile -File .\cleanup-cohesion-tests-20261106.ps1 -WhatIf
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$cleanupRoot = 'D:\Tools\cache\weava\tests'
$approvedTargets = @(
    @{ Path = 'D:\Tools\cache\weava\tests\1793954055559'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\analytics-query-1793954058525'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\analytics-query-1793954058525.access.sqlite'; IsDirectory = $false }
    @{ Path = 'D:\Tools\cache\weava\tests\cohesion-1793954611414'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\cohesion-1793954654864'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\cohesion-migrations-20261106'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\extensions-1793954612828'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\extensions-1793954616189'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\extensions-1793954616189.access.sqlite'; IsDirectory = $false }
    @{ Path = 'D:\Tools\cache\weava\tests\import-dispatch-1793954615012'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\organization-1793954062407'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\public-query-1793954060817'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\publication-1793954050237'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\runtime-common-1793954063649'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\theme-1793954616104'; IsDirectory = $true }
    @{ Path = 'D:\Tools\cache\weava\tests\theme-1793954616104.access.sqlite'; IsDirectory = $false }
    @{ Path = 'D:\Tools\cache\weava\tests\wp-statistics-1793954052706'; IsDirectory = $true }
)

function Assert-NoDirectoryLink {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $ancestor = [System.IO.Path]::GetFullPath($LiteralPath)
    while ($ancestor) {
        $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing a directory link or reparse point: $ancestor"
        }
        $parent = [System.IO.Path]::GetDirectoryName($ancestor)
        if (-not $parent -or $parent -eq $ancestor) { break }
        $ancestor = $parent
    }
}

function Get-ApprovedTargetInventory {
    param([Parameter(Mandatory = $true)][hashtable]$Target)

    $absolute = [System.IO.Path]::GetFullPath($Target.Path)
    $parent = [System.IO.Path]::GetDirectoryName($absolute)
    if (-not [string]::Equals($parent, $cleanupRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Target is not a direct child of the approved test directory: $absolute"
    }
    Assert-NoDirectoryLink -LiteralPath $absolute
    if (-not (Test-Path -LiteralPath $absolute)) {
        return [pscustomobject]@{ Path = $absolute; Exists = $false; Files = 0; Bytes = [long]0 }
    }

    $rootItem = Get-Item -LiteralPath $absolute -Force
    $resolved = (Resolve-Path -LiteralPath $absolute -ErrorAction Stop).ProviderPath
    if (-not [string]::Equals($resolved, $absolute, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Resolved path differs from the approved absolute path: $absolute -> $resolved"
    }
    if ([bool]$rootItem.PSIsContainer -ne [bool]$Target.IsDirectory) {
        throw "Target type changed since approval: $absolute"
    }

    $pending = [System.Collections.Generic.Stack[System.IO.FileSystemInfo]]::new()
    $pending.Push($rootItem)
    [long]$bytes = 0
    $files = 0
    while ($pending.Count -gt 0) {
        $item = $pending.Pop()
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "Refusing a link inside an approved target: $($item.FullName)"
        }
        if ($item -is [System.IO.DirectoryInfo]) {
            # Enumerate one level at a time; never recurse through directory links.
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop) {
                $pending.Push($child)
            }
        }
        elseif ($item -is [System.IO.FileInfo]) {
            # A running process must not still own a test database or other test file.
            $handle = [System.IO.File]::Open(
                $item.FullName,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::None
            )
            try { $bytes += $item.Length; $files++ } finally { $handle.Dispose() }
        }
        else {
            throw "Unexpected filesystem entry: $($item.FullName)"
        }
    }
    return [pscustomobject]@{ Path = $absolute; Exists = $true; Files = $files; Bytes = $bytes }
}

# Validate every target before deleting any of them. Missing targets are safe to skip.
Assert-NoDirectoryLink -LiteralPath $cleanupRoot
$inventory = @($approvedTargets | ForEach-Object { Get-ApprovedTargetInventory -Target $_ })
$existing = @($inventory | Where-Object { $_.Exists })
$totalBytes = ($inventory | Measure-Object -Property Bytes -Sum).Sum
$inventory | Select-Object Path, Exists, Files, Bytes | Format-Table -AutoSize | Out-Host
Write-Host ('Found {0} of 17 approved targets, {1:N2} MiB.' -f $existing.Count, ($totalBytes / 1MB))
if ($existing.Count -eq 0) {
    Write-Host 'Nothing remains to clean.'
    return
}
if (-not $PSCmdlet.ShouldProcess('Only the 17 absolute paths listed above', 'Delete approved test artifacts')) {
    Write-Host 'No files were deleted.'
    return
}

# Keep deletion targets literal and individually reviewable. Do not replace with a loop or wildcard.
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\1793954055559') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\1793954055559' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\analytics-query-1793954058525') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\analytics-query-1793954058525' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\analytics-query-1793954058525.access.sqlite') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\analytics-query-1793954058525.access.sqlite' -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\cohesion-1793954611414') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\cohesion-1793954611414' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\cohesion-1793954654864') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\cohesion-1793954654864' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\cohesion-migrations-20261106') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\cohesion-migrations-20261106' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\extensions-1793954612828') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\extensions-1793954612828' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\extensions-1793954616189') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\extensions-1793954616189' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\extensions-1793954616189.access.sqlite') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\extensions-1793954616189.access.sqlite' -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\import-dispatch-1793954615012') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\import-dispatch-1793954615012' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\organization-1793954062407') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\organization-1793954062407' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\public-query-1793954060817') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\public-query-1793954060817' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\publication-1793954050237') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\publication-1793954050237' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\runtime-common-1793954063649') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\runtime-common-1793954063649' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\theme-1793954616104') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\theme-1793954616104' -Recurse -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\theme-1793954616104.access.sqlite') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\theme-1793954616104.access.sqlite' -Force -Confirm:$false
}
if (Test-Path -LiteralPath 'D:\Tools\cache\weava\tests\wp-statistics-1793954052706') {
    Remove-Item -LiteralPath 'D:\Tools\cache\weava\tests\wp-statistics-1793954052706' -Recurse -Force -Confirm:$false
}

$remaining = @($approvedTargets | Where-Object { Test-Path -LiteralPath $_.Path })
if ($remaining.Count -gt 0) {
    throw ('Cleanup incomplete; remaining paths: ' + (($remaining | ForEach-Object { $_.Path }) -join ', '))
}
Write-Host ('Cleanup complete: {0} targets removed, {1:N2} MiB of test files cleaned.' -f $existing.Count, ($totalBytes / 1MB))
