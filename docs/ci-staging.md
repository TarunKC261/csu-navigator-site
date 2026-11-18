# Deploy a branch to staging from GitHub Actions

Optional. Your site already deploys automatically on every push to its deploy
branch — this is only for pushing an *arbitrary* branch to your **staging**
environment on demand, so you can try changes before they reach production.

It ships as a snippet rather than a ready-made workflow file because creating
`.github/workflows/*` on your behalf requires an extra GitHub App permission,
and requiring every customer to approve that just to seed a repo caused more
broken deploys than the file was worth. Pasting it yourself takes a minute and
has no such constraint.

## 1. Create the environment

In the dashboard: **Sites → your site → Embed & deploy → Create environment**,
name it `staging`. Copy its API key from the environment's CI keys.

## 2. Add the secret

Repo **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
| --- | --- |
| `MOBEUS_STAGING_API_KEY` | the staging environment's API key |

Optionally add a **variable** `MOBEUS_API_URL` if you're not on
`https://app.mobeus.ai`.

## 3. Add the workflow

Create `.github/workflows/deploy-staging.yml`:

```yaml
name: Deploy to Mobeus staging

# Manual trigger (Actions tab → "Run workflow"). Deploys the chosen branch to
# this site's Mobeus staging environment.
on:
  workflow_dispatch:
    inputs:
      branch:
        description: Branch to deploy to staging
        required: true
        default: staging

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger staging deploy
        env:
          API_URL: ${{ vars.MOBEUS_API_URL || 'https://app.mobeus.ai' }}
          API_KEY: ${{ secrets.MOBEUS_STAGING_API_KEY }}
          BRANCH: ${{ github.event.inputs.branch }}
        run: |
          set -euo pipefail
          if [ -z "${API_KEY}" ]; then
            echo "::error::MOBEUS_STAGING_API_KEY secret is not set"; exit 1
          fi
          echo "Deploying branch '${BRANCH}' to staging…"
          http_code=$(curl -sS -o response.json -w '%{http_code}' \
            -X POST "${API_URL}/api/v1/deploy" \
            -H "Authorization: Bearer ${API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"branch\":\"${BRANCH}\"}")
          cat response.json; echo
          if [ "${http_code}" != "200" ]; then
            echo "::error::Deploy request failed (HTTP ${http_code})"; exit 1
          fi

      # Add your content-eval step here — it can hit ${API_URL}/api/v1/ask with
      # the same MOBEUS_STAGING_API_KEY once the staging build has finished.
      # - name: Run content eval
      #   run: ./scripts/eval.sh
```

## 4. Run it

**Actions → Deploy to Mobeus staging → Run workflow**, pick a branch. The
staging environment's URL is on the same Embed & deploy tab.
