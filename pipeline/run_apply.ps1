$script:m = New-Object System.Threading.Mutex($false, 'Global\ca-run-apply')
try { if (-not $script:m.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] {}
$dir = $PSScriptRoot   # dossier du script (aucun chemin personnel en dur)
$py  = "$dir\.venv\Scripts\python.exe"
$pw  = (Get-Content "$dir\.dbpass" -Raw).Trim()
$env:DATABASE_URL = "postgres://carteasso:$pw@127.0.0.1:5434/carteasso"
Set-Location $dir
while ($true) {
  & $py apply.py *> "$dir\_applyLoop.log"
  Start-Sleep 120
}
