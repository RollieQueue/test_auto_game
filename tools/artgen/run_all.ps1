# Generate candidates for several sets in one go (each set loads the model once): run_all.ps1 mushrooms frontispiece decor
param([Parameter(ValueFromRemainingArguments = $true)]$Sets)
. "$PSScriptRoot\_env.ps1"
foreach ($s in $Sets) { & $VenvPython "$PSScriptRoot\generate.py" --set $s; & $VenvPython "$PSScriptRoot\cutout.py" --set $s --sheets }
