# Run one of the .sh scripts from PowerShell.
#
#   .\run.ps1 02-point-local
#   .\run.ps1 03-simulator
#   $env:SPEED = 20; .\run.ps1 03-simulator
#
# ── Why this exists ──────────────────────────────────────────────────────────
# PowerShell will not execute a .sh file: `./02-point-local.sh` returns silently
# because it hands the file to the shell's default handler, and typing the name
# without `./` is parsed as an expression -- `-point` becomes an operator.
#
# And `bash` on this machine's PATH is WSL's, which has no distribution
# installed, so it fails with `execvpe(/bin/bash) failed`. The bash that works
# is Git's, which is not on PATH. This finds it.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Script,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$bash = @(
  "C:\Program Files\Git\bin\bash.exe",
  "C:\Program Files (x86)\Git\bin\bash.exe",
  "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $bash) {
  Write-Error "Git Bash not found. Install Git for Windows, or run these from a Git Bash window."
  exit 1
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Script.EndsWith('.sh')) { $Script = "$Script.sh" }
$target = Join-Path $here $Script

if (-not (Test-Path $target)) {
  Write-Host "No such script: $Script`n"
  Write-Host "Available:"
  Get-ChildItem $here -Filter *.sh | ForEach-Object { "  $($_.BaseName)" }
  exit 1
}

# Git Bash wants a POSIX path. Its own `cygpath` does the conversion, rather
# than this guessing at drive-letter rules.
$posix = & $bash -c "cygpath -u '$target'"

Write-Host "-> $Script" -ForegroundColor Cyan
& $bash $posix @Rest
exit $LASTEXITCODE
