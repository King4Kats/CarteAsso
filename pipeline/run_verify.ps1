$script:m = New-Object System.Threading.Mutex($false, 'Global\ca-run-verify')
try { if (-not $script:m.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] {}
$dir = $PSScriptRoot   # dossier du script (aucun chemin personnel en dur)
$py  = "$dir\.venv\Scripts\python.exe"
$pw  = (Get-Content "$dir\.dbpass" -Raw).Trim()
$env:DATABASE_URL = "postgres://carteasso:$pw@127.0.0.1:15433/carteasso"
Set-Location $dir
"START run_verify $(Get-Date -Format o) py=$py exists=$(Test-Path $py)" | Out-File -Append -Encoding utf8 "$dir\_verLoop.log"
while ($true) {
  if (Test-Path "$dir\.pause_ollama") {
    "PAUSED $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 "$dir\_verLoop.log"
    Start-Sleep 20
    continue
  }
  "ITER $(Get-Date -Format o)" | Out-File -Encoding utf8 "$dir\_verLoop.log"
  try { & $py verify_llm.py --limit 200 2>&1 | Out-File -Append -Encoding utf8 "$dir\_verLoop.log" }
  catch { "ERR $($_.Exception.Message)" | Out-File -Append -Encoding utf8 "$dir\_verLoop.log" }
  "DONE exit=$LASTEXITCODE $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 "$dir\_verLoop.log"
  Start-Sleep 20
}
