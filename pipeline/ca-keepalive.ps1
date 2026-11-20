# CarteAsso — keepalive PC (vérif IA + apply). Idempotent : relance ce qui est tombé.
# À planifier (toutes les ~10 min + au logon). Ne fait QUE : tunnels DB localhost,
# Ollama, boucle verify (run_verify.ps1), boucle apply (run_apply.ps1).
$dir = $PSScriptRoot   # dossier du script (aucun chemin personnel en dur)
# Alias SSH du serveur de la base : fichier local .serveur (non versionne, une ligne).
$SERVER = (Get-Content "$dir\.serveur" -Raw).Trim()

# 1) Tunnels SSH localhost-only vers ca-db (15433 verify, 5434 apply). 5433 et 5435 sont pris par
#    des bases Docker locales (astro-app...) depuis 11/2026.
foreach ($p in 15433,5434) {
  $up = $false
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); $up = $true } catch {}
  if (-not $up) {
    $ip = '172.24.0.3'
    try { $r = (ssh -o ConnectTimeout=10 $SERVER 'docker exec ca-db hostname -i').Trim().Split()[0]; if ($r -match '^\d{1,3}(\.\d{1,3}){3}$') { $ip = $r } } catch {}
    Start-Process -WindowStyle Hidden ssh -ArgumentList '-N','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-o','ExitOnForwardFailure=yes','-L',"127.0.0.1:${p}:${ip}:5432",$SERVER
  }
}

# 2) Ollama up (sauf si mode pause jeu video actif).
$pauseFile = "$dir\.pause_ollama"

# 2a) Garde-fou JEU (20/11) : un jeu lance (Steam, Epic, Riot, GOG, Ubisoft, EA) met la
#     validation IA en pause toute seule (fichier .pause_ollama contenant AUTO), et la
#     reprend quand le jeu est ferme. Une pause posee a la main (autre contenu) n'est
#     jamais levee automatiquement.
$jeu = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $p = $null; try { $p = $_.Path } catch {}
  $p -and $p -match '\\steamapps\\common\\|\\Epic Games\\|\\Riot Games\\|\\GOG Galaxy\\Games\\|\\Ubisoft Game Launcher\\games\\|\\EA Games\\'
} | Select-Object -First 1
$pauseAuto = (Test-Path $pauseFile) -and ((Get-Content $pauseFile -Raw -ErrorAction SilentlyContinue) -match '^AUTO')
if ($jeu -and -not (Test-Path $pauseFile)) { "AUTO $($jeu.ProcessName) $(Get-Date -Format o)" | Set-Content $pauseFile -Encoding ascii }
elseif (-not $jeu -and $pauseAuto) { Remove-Item $pauseFile -Force -ErrorAction SilentlyContinue }

# 2b) Garde-fou ORPHELINS (gel du PC du 26/10) : avec OLLAMA_MAX_LOADED_MODELS=1 il ne doit
#     y avoir qu'UN llama-server. Plusieurs = chargements rates qui ne meurent pas -> on
#     tue tout Ollama, il est relance proprement juste en dessous.
if (@(Get-Process llama-server -ErrorAction SilentlyContinue).Count -gt 1) {
  "$(Get-Date -Format o) plusieurs llama-server -> Ollama redemarre" | Out-File -Append -Encoding utf8 "$dir\_keepalive_err.log"
  Get-Process 'ollama app', ollama, llama-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
}

if (Test-Path $pauseFile) {
  Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} else {
  try { Invoke-RestMethod 'http://localhost:11434/api/tags' -TimeoutSec 6 | Out-Null }
  catch { Start-Process -WindowStyle Hidden -FilePath "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" -ArgumentList 'serve' -ErrorAction SilentlyContinue }
}

# 3+4) Boucles verify/apply : EXACTEMENT une de chaque. On tue les surnuméraires
# (le mutex PowerShell n'est pas fiable entre process séparés) puis on démarre si absente.
function Ensure-One($pat, $file) {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*$pat*" })
  # taskkill /F (pas Stop-Process) : tue aussi les instances d'une AUTRE session (tâche
  # planifiée vs session interactive), sinon les doublons ne peuvent pas être supprimés.
  if ($procs.Count -gt 1) { $procs | Sort-Object CreationDate | Select-Object -Skip 1 | ForEach-Object { & taskkill /PID $_.ProcessId /F 2>&1 | Out-Null } }
  if ($procs.Count -eq 0) {
    Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$file
  }
}
Ensure-One 'run_verify.ps1'  "$dir\run_verify.ps1"
Ensure-One 'run_apply.ps1'   "$dir\run_apply.ps1"
Ensure-One 'run_maint.ps1'   "$dir\run_maint.ps1"

# 5) Battement de coeur PC (id 1) -> table pipeline_heartbeat, lue par le mail midi/recap.
#    Sans ça le mail affiche "PC validation IA : muet". On reporte l'état verify/apply.
try {
  $py = "$dir\.venv\Scripts\python.exe"
  $pw = (Get-Content "$dir\.dbpass" -Raw).Trim()
  $vAlive = [bool]@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*run_verify.ps1*' }).Count
  $aAlive = [bool]@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*run_apply.ps1*' }).Count
  $jobs = @{ verify = $(if ($vAlive) { 'Running' } else { 'Stopped' }); apply = $(if ($aAlive) { 'Running' } else { 'Stopped' }) }
  $status = (@{ dept = '85'; jobs = $jobs } | ConvertTo-Json -Compress)
  $env:DATABASE_URL = "postgres://carteasso:$pw@127.0.0.1:5434/carteasso"
  $status | & $py "$dir\heartbeat.py" --id 1 2>&1 | Out-Null
} catch {}
