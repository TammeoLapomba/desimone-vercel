#!/usr/bin/env bash
# scripts/pubblica-codice.sh — Pubblica SOLO il codice sul repository pubblico usato da Vercel.
#
# Il repository privato (remote "origin", DedaloTeam/desimone-os) contiene tutto: codice e materiale
# di progetto. Il repository pubblico (remote "vercel", TammeoLapomba/desimone-vercel) serve solo per il
# deploy e non deve ricevere le cartelle private elencate in PRIVATE_PATHS.
#
# Lo script prende l'ultimo commit locale, toglie le cartelle private e pubblica il risultato come un
# nuovo commit sul branch main del repository pubblico. Il push diretto verso "vercel" è disattivato di
# proposito: si pubblica solo da qui.
#
# Uso:
#   scripts/pubblica-codice.sh          anteprima: mostra cosa verrebbe pubblicato
#   scripts/pubblica-codice.sh --push   pubblica (Vercel avvia il deploy)

set -euo pipefail

PRIVATE_PATHS=(docs bilancia old_software)
REMOTE=vercel
BRANCH=main

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Ci sono modifiche non committate: fai prima il commit." >&2
  exit 1
fi

URL=$(git remote get-url "$REMOTE")
git fetch -q "$URL" "$BRANCH"
PARENT=$(git rev-parse FETCH_HEAD)

# Albero del commit corrente senza le cartelle private (indice temporaneo, il working tree non cambia)
TMP_INDEX=$(mktemp)
trap 'rm -f "$TMP_INDEX"' EXIT
GIT_INDEX_FILE="$TMP_INDEX" git read-tree HEAD
for p in "${PRIVATE_PATHS[@]}"; do
  GIT_INDEX_FILE="$TMP_INDEX" git rm -r -q --cached --ignore-unmatch -- "$p"
done
TREE=$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)

for p in "${PRIVATE_PATHS[@]}"; do
  if git ls-tree -r --name-only "$TREE" | grep -q "^$p/"; then
    echo "ERRORE: la cartella privata '$p' è ancora nell'albero da pubblicare." >&2
    exit 1
  fi
done

if [ "$TREE" = "$(git rev-parse "$PARENT^{tree}")" ]; then
  echo "Il codice pubblico è già aggiornato: niente da pubblicare."
  exit 0
fi

echo "Modifiche che verrebbero pubblicate su $REMOTE/$BRANCH:"
git diff --stat "$PARENT" "$TREE"

if [ "${1:-}" != "--push" ]; then
  echo
  echo "Questa è un'anteprima. Per pubblicare: scripts/pubblica-codice.sh --push"
  exit 0
fi

# Messaggio: elenco dei commit privati sincronizzati dall'ultima pubblicazione (trailer "Codice-da")
LAST=$(git log -1 --format='%(trailers:key=Codice-da,valueonly)' "$PARENT" | head -n1 | tr -d '[:space:]')
if [ -n "$LAST" ] && git merge-base --is-ancestor "$LAST" HEAD 2>/dev/null; then
  RANGE="$LAST..HEAD"
else
  RANGE="-1 HEAD"
fi
# shellcheck disable=SC2086
SUBJECTS=$(git log --format='- %s' $RANGE)
# shellcheck disable=SC2086
COAUTHORS=$(git log --format='%(trailers:key=Co-Authored-By)' $RANGE | sed '/^$/d' | sort -u)

MSG=$(printf 'Sync codice dal repository privato\n\n%s\n\nCodice-da: %s\n%s' "$SUBJECTS" "$(git rev-parse HEAD)" "$COAUTHORS")
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "$MSG")
git push "$URL" "$COMMIT:refs/heads/$BRANCH"
echo "Pubblicato $COMMIT su $REMOTE/$BRANCH: Vercel avvierà il deploy."
