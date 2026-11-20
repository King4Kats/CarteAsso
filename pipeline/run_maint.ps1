# CarteAsso — boucle de MAINTENANCE (PC). Rafraîchit régulièrement :
#  - événements à proximité (events.py) pour CHAQUE département enrichi (terminés + en
#    cours), centrés sur leur propre région (la liste vient de l'API -> suit le pipeline) ;
#  - santé des liens (liveness), promotion fb->site (fb_promote), score, nettoyage.
# Lancée/maintenue par ca-keepalive.ps1. Tunnel B (5434).
$script:m = New-Object System.Threading.Mutex($false, 'Global\ca-run-maint')
try { if (-not $script:m.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] {}
$dir = $PSScriptRoot   # dossier du script (aucun chemin personnel en dur)
$py  = "$dir\.venv\Scripts\python.exe"
$pw  = (Get-Content "$dir\.dbpass" -Raw).Trim()
$env:DATABASE_URL = "postgres://carteasso:$pw@localhost:5434/carteasso"
Set-Location $dir
while ($true) {
  # Départements enrichis (terminés + en cours), depuis l'API -> events centrés par région.
  $depts = @()
  try {
    $p = Invoke-RestMethod 'https://carteasso.fr/api/stats/progress' -TimeoutSec 20
    if ($p.done) { $depts += $p.done }
    if ($p.territoryCode) { $depts += $p.territoryCode }
  } catch {}
  foreach ($d in ($depts | Select-Object -Unique)) {
    "[$(Get-Date -Format o)] events --dept $d" | Out-File -Append -Encoding utf8 "$dir\_maint.log"
    & $py events.py --dept $d *>> "$dir\_maint.log"
  }
  # Jobs dept-agnostiques (gating interne) : santé liens, promo fb->site, score, nettoyage.
  & $py liveness.py --limit 1500 *>> "$dir\_maint.log"
  & $py fb_promote.py --limit 30 *>> "$dir\_maint.log"
  & $py score.py            *>> "$dir\_maint.log"
  & $py reap_dead.py        *>> "$dir\_maint.log"
  & $py purge_directories.py *>> "$dir\_maint.log"
  Start-Sleep 1800   # ~30 min
}
