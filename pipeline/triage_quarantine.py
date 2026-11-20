"""TRI QUARANTAINE — 2e passe LLM décisive (keep/drop) sur meta.quarantine.

meta.quarantine = candidats scorés 0.40-0.75 par la 1re passe (verify_llm), garés
pour revue humaine. Ici on tranche en BINAIRE (garder | jeter) en réutilisant la
RAISON déjà produite comme preuve (le LLM avait lu la page/slug) -> aucun refetch réseau.

Applique EXACTEMENT la sémantique de l'onglet web resolveQuarantine :
  - keep -> social[plateforme] = url  + retire la clé de meta.quarantine
  - drop -> ajoute à meta.dropped     + retire la clé de meta.quarantine
Trace chaque décision dans meta.triage (audit). updated_at bumpé seulement si `social` change.

Idempotent / reprenable (commit par fiche ; ne retraite que ce qui est ENCORE en quarantaine).
Sûr : parse KO ou exception -> on SAUTE (laisse en quarantaine), jamais de devinette.

Usage:
  python triage_quarantine.py [--limit N] [--dept 85] [--dry-run] [--model gemma4:12b]
"""
from __future__ import annotations
import argparse, json, os, sys, time
from datetime import datetime, timezone

import psycopg
from ollama import Client

DSN = os.environ.get("DATABASE_URL",
    "postgres://carteasso:carteasso@127.0.0.1:5433/carteasso")
# NB: la var d'env OLLAMA_HOST vaut souvent "0.0.0.0" (adresse de BIND du `serve`,
# posée par le superviseur) -> inutilisable pour se CONNECTER. On vise 127.0.0.1.
_oh = os.environ.get("OLLAMA_HOST", "").strip()
if _oh.startswith("0.0.0.0") or not _oh:
    _oh = "http://127.0.0.1:11434"
elif not _oh.startswith("http"):
    _oh = "http://" + _oh
OLLAMA_HOST = _oh
DEFAULT_MODEL = os.environ.get("VERIFY_MODEL", "gemma4:12b")

SYSTEM = (
    "Tu es un vérificateur STRICT de liens d'associations françaises. "
    "On te donne une association (nom, ville) et un lien candidat, avec l'analyse d'un "
    "premier examen (le champ 'analyse' : ce qui a été observé sur la page/le compte). "
    "Tu dois TRANCHER, sans hésiter : ce lien est-il la présence en ligne officielle de "
    "CETTE association précise ? "
    "JETTE (drop) si : profil d'une PERSONNE, page d'une VILLE/mairie/commune, annuaire, "
    "article de PRESSE, entreprise/commerce, organisme NATIONAL, AUTRE association (même "
    "homonyme ou nom seulement approchant), page d'un collège/lieu, contenu sans lien clair. "
    "GARDE (keep) UNIQUEMENT si l'analyse montre que ça appartient bien à CETTE asso "
    "(nom qui colle ET cohérence ville/activité). Dans le doute sur l'identité -> drop. "
    'Réponds STRICTEMENT en JSON : {"decision":"keep"|"drop","confidence":<0..1>,'
    '"reason":"<très court, français>"}.'
)

def judge(client: Client, model: str, name, city, plat, url, prior_reason, prior_score) -> dict:
    payload = json.dumps({
        "association": name, "ville": city or "", "plateforme": plat,
        "lien": url, "analyse": prior_reason or "", "score_initial": prior_score,
    }, ensure_ascii=False)
    r = client.chat(model=model, format="json", options={"temperature": 0}, think=False,
                    messages=[{"role": "system", "content": SYSTEM},
                              {"role": "user", "content": payload}])
    txt = (r.get("message", {}) or {}).get("content", "") or ""
    d = json.loads(txt)
    dec = str(d.get("decision", "")).lower().strip()
    if dec not in ("keep", "drop"):
        raise ValueError(f"decision invalide: {dec!r}")
    return {"decision": dec, "confidence": float(d.get("confidence", 0)),
            "reason": str(d.get("reason", ""))[:300]}

def fetch(conn, limit, dept):
    conds = ["meta->'quarantine' IS NOT NULL", "meta->'quarantine' <> '{}'::jsonb"]
    params = {}
    if dept:
        conds.append("department = %(dept)s"); params["dept"] = dept
    where = " AND ".join(conds)
    lim = "" if limit is None else f"LIMIT {int(limit)}"
    rows = conn.execute(
        f"""SELECT id, name, city, social, meta->'quarantine'
            FROM associations WHERE {where} ORDER BY id {lim}""", params).fetchall()
    return [{"id": str(r[0]), "name": r[1], "city": r[2],
             "social": r[3] or {}, "quar": r[4] or {}} for r in rows]

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dept", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    client = Client(host=OLLAMA_HOST)
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    n_fiche = n_keep = n_drop = n_skip = 0
    t0 = time.time()

    with psycopg.connect(DSN, autocommit=False) as conn:
        batch = fetch(conn, args.limit, args.dept)
        total = len(batch)
        print(f"TRI QUARANTAINE : {total} fiches (dry-run={args.dry_run}, model={args.model})",
              flush=True)
        for i, a in enumerate(batch, 1):
            social = dict(a["social"]); quar = dict(a["quar"])
            keeps, drops, triage = {}, [], {}
            for plat, rec in a["quar"].items():
                url = (rec or {}).get("url")
                if not url:
                    continue
                try:
                    v = judge(client, args.model, a["name"], a["city"], plat, url,
                              rec.get("reason", ""), rec.get("score"))
                except Exception as e:
                    n_skip += 1
                    if args.verbose:
                        print(f"    SKIP {a['name'][:24]} {plat}: {e}", flush=True)
                    continue
                triage[plat] = {"url": url, "decision": v["decision"],
                                "confidence": v["confidence"], "reason": v["reason"]}
                quar.pop(plat, None)
                if v["decision"] == "keep":
                    social[plat] = url; keeps[plat] = url; n_keep += 1
                else:
                    drops.append({"platform": plat, "url": url,
                                  "score": rec.get("score"), "verdict": "drop",
                                  "reason": v["reason"], "wasQuarantine": True}); n_drop += 1
            if not triage:
                continue
            n_fiche += 1
            if args.verbose or args.dry_run:
                print(f"  [{i}/{total}] {a['name'][:32]:32} keep={list(keeps) or '-'} "
                      f"drop={[d['platform'] for d in drops] or '-'}", flush=True)
            if args.dry_run:
                continue
            meta_patch = {"quarantine": quar, "triage": {**({}), **{"at": ts}, **triage}}
            # dropped : on APPEND (fusion applicative côté SQL via concat de tableaux)
            changed = json.dumps(social, sort_keys=True) != json.dumps(a["social"], sort_keys=True)
            set_upd = ", updated_at = now()" if changed else ""
            conn.execute(
                f"""UPDATE associations
                    SET social = %s::jsonb,
                        meta = jsonb_set(
                                 meta || %s::jsonb,
                                 '{{dropped}}',
                                 coalesce(meta->'dropped','[]'::jsonb) || %s::jsonb
                               ){set_upd}
                    WHERE id = %s""",
                (json.dumps(social), json.dumps(meta_patch), json.dumps(drops), a["id"]))
            conn.commit()

    dt = time.time() - t0
    rate = (n_keep + n_drop) / dt if dt else 0
    print(f"\nFINI : {n_fiche} fiches touchées | garde={n_keep} jete={n_drop} "
          f"saute={n_skip} | {dt:.0f}s ({rate:.1f} liens/s)", flush=True)
    return 0

if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sys.exit(main())
