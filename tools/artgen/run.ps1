# Runs any artgen python script inside the isolated venv:  powershell -File tools\artgen\run.ps1 generate.py --set mushrooms
# (generate.ps1 / build.ps1 are thin wrappers around this.)
param([Parameter(Position = 0, Mandatory = $true)][string]$Script, [Parameter(ValueFromRemainingArguments = $true)]$Rest)
. "$PSScriptRoot\_env.ps1"
$py = Join-Path $PSScriptRoot $Script
& $VenvPython $py @Rest
exit $LASTEXITCODE
