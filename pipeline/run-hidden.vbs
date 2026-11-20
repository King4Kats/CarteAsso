' Lance ca-keepalive.ps1 (meme dossier que ce fichier) en fenetre TOTALEMENT cachee (0 = hidden, False = ne pas attendre).
' Evite le flash de fenetre console que provoque powershell.exe lance directement par le planificateur.
Set sh = CreateObject("WScript.Shell")
dossier = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dossier & "\ca-keepalive.ps1""", 0, False