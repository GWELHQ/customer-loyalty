# Google Cloud deployment

## Services used

| Service | Purpose |
| --- | --- |
| Cloud Run | Hosts the NestJS API (`apps/api`). Also hosts the web app if you pick the Cloud Run static-hosting option. |
| Firebase Hosting **or** Cloud Storage + Cloud CDN **or** Cloud Run | Hosts the built React admin app (`apps/web`) — pick one, see below. |
| Cloud Firestore (Native mode) | Primary database. |
| Cloud Storage | Customer Excel import files, generated error reports, and captured vehicle-plate photos. |
| Cloud Vision API | OCRs vehicle-plate photos captured by the Android app (`POST /mobile/vehicle-plate-checks`) — billed per image, uses the Cloud Run service account's Application Default Credentials, no separate key. |
| Secret Manager | JWT signing secrets, Microsoft Entra client secret, SMS provider key, scheduler shared secret. |
| Cloud Scheduler | Triggers `POST /jobs/price-reminders` on a monthly cadence. |
| Cloud Logging / Error Reporting | Automatic for anything running on Cloud Run — no extra wiring needed beyond normal `console.log`/thrown errors. |
| Artifact Registry | Stores the Docker images built for Cloud Run. |

## One-time project setup

```bash
gcloud config set project <PROJECT_ID>

gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  vision.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com

# Firestore, Native mode, pick a region close to Kenya (e.g. europe-west1 or asia-south1)
gcloud firestore databases create --location=<REGION> --type=firestore-native

gsutil mb -l <REGION> gs://<PROJECT_ID>-loyalty-files
```

Deploy indexes and (optional, defense-in-depth) security rules — `firestore.rules`/`firestore.indexes.json` live at the repo root, alongside `firebase.json`:

```bash
firebase deploy --only firestore:indexes --project <PROJECT_ID>
firebase deploy --only firestore:rules --project <PROJECT_ID>
```

## Service accounts and IAM

Create one service account for the API's Cloud Run service — do **not** reuse the default Compute service account:

```bash
gcloud iam service-accounts create loyalty-api-run \
  --display-name="Loyalty API (Cloud Run)"
```

Grant it exactly what it needs:

| Role | Why |
| --- | --- |
| `roles/datastore.user` | Read/write Firestore. |
| `roles/storage.objectAdmin` (scoped to the one bucket) | Upload/read import files and error reports. |
| `roles/secretmanager.secretAccessor` | Read the secrets below at startup. |
| `roles/logging.logWriter` | Structured logs (granted by default on Cloud Run, listed for completeness). |

```bash
gsutil iam ch serviceAccount:loyalty-api-run@<PROJECT_ID>.iam.gserviceaccount.com:objectAdmin \
  gs://<PROJECT_ID>-loyalty-files

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:loyalty-api-run@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:loyalty-api-run@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

If you deploy the web app to Cloud Run too, give it its own minimal service account with no extra roles (it serves static files only).

## Secrets

```bash
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create jwt-access-secret --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create jwt-refresh-secret --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create scheduler-shared-secret --data-file=-
echo -n "<entra-client-secret>" | gcloud secrets create ms-entra-client-secret --data-file=-
```

## Deploying the API to Cloud Run

```bash
gcloud builds submit --tag <REGION>-docker.pkg.dev/<PROJECT_ID>/loyalty/api:latest -f apps/api/Dockerfile .

gcloud run deploy loyalty-api \
  --image <REGION>-docker.pkg.dev/<PROJECT_ID>/loyalty/api:latest \
  --region <REGION> \
  --service-account loyalty-api-run@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars GCP_PROJECT_ID=<PROJECT_ID>,FIRESTORE_DATABASE_ID='(default)',GCS_BUCKET_NAME=<PROJECT_ID>-loyalty-files,CORS_ORIGIN=https://<your-web-app-domain>,MS_ENTRA_TENANT_ID=<tenant-id>,MS_ENTRA_CLIENT_ID=<client-id>,MS_ENTRA_REDIRECT_URI=https://<your-web-app-domain>/auth/microsoft/callback,JWT_ACCESS_TTL=15m,JWT_REFRESH_TTL=7d,ATTENDANT_JWT_TTL=12h,SMS_PROVIDER=mock \
  --set-secrets JWT_ACCESS_SECRET=jwt-access-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest,SCHEDULER_SHARED_SECRET=scheduler-shared-secret:latest,MS_ENTRA_CLIENT_SECRET=ms-entra-client-secret:latest \
  --allow-unauthenticated
```

`GOOGLE_APPLICATION_CREDENTIALS` is intentionally **not** set here — on Cloud Run the Admin SDK picks up the attached service account automatically (Application Default Credentials). Only set it locally, pointing at a downloaded key file for a dev/scratch project.

## Deploying the web app

Pick one:

**A. Firebase Hosting** (simplest, free CDN, easiest custom domain + TLS) — this is what's actually wired up, see "CI/CD" below:
```bash
npm run build --workspace=@loyalty/web
firebase deploy --only hosting --project <PROJECT_ID>
```
(see `firebase.json` at the repo root for the `dist/` rewrite config — it and `.firebaserc` must live at the repo root, not nested, or the Firebase CLI rejects `public: apps/web/dist` as outside the project directory)

**B. Cloud Storage + Cloud CDN**:
```bash
npm run build --workspace=@loyalty/web
gsutil -m rsync -r apps/web/dist gs://<PROJECT_ID>-loyalty-web
# then front the bucket with a Cloud CDN + external HTTPS load balancer (console or `gcloud compute` — one-time setup)
```

**C. Cloud Run** (same container-per-service model as the API):
```bash
gcloud builds submit --tag <REGION>-docker.pkg.dev/<PROJECT_ID>/loyalty/web:latest \
  --build-arg VITE_API_BASE_URL=https://<api-domain>/api/v1 \
  --build-arg VITE_MS_ENTRA_TENANT_ID=<tenant-id> \
  --build-arg VITE_MS_ENTRA_CLIENT_ID=<client-id> \
  --build-arg VITE_MS_ENTRA_REDIRECT_URI=https://<web-domain>/auth/microsoft/callback \
  -f apps/web/Dockerfile .
gcloud run deploy loyalty-web --image <REGION>-docker.pkg.dev/<PROJECT_ID>/loyalty/web:latest --region <REGION> --allow-unauthenticated
```

## Cloud Scheduler: monthly price reminder

Already created for `loyalty-points-413d5` (`price-reminder-check`, `us-central1`, `Africa/Nairobi` time zone):

```bash
gcloud scheduler jobs create http price-reminder-check \
  --location=<REGION> \
  --schedule="0 * * * *" \
  --time-zone="Africa/Nairobi" \
  --uri="https://<api-domain>/api/v1/jobs/price-reminders" \
  --http-method=POST \
  --headers="x-scheduler-secret=<value-of-scheduler-shared-secret>"
```

The job endpoint itself checks whether a reminder is actually due (`priceReminderSettings.nextReminderAt`) and no-ops otherwise, so it's safe — and cheap — to run this check hourly rather than trying to compute the exact monthly cron expression. Default reminder day is the 15th (`PriceRemindersService.createDefault`); admins can change day/hour/recipients/on-off from the Prices page, or via `PATCH /price-reminders`.

## Cloud Scheduler: end-of-shift reconciliation reminder

Already created for `loyalty-points-413d5` (`reconciliation-reminder-check`, `us-central1`, `Africa/Nairobi` time zone, daily at 20:00):

```bash
gcloud scheduler jobs create http reconciliation-reminder-check \
  --location=<REGION> \
  --schedule="0 20 * * *" \
  --time-zone="Africa/Nairobi" \
  --uri="https://<api-domain>/api/v1/jobs/reconciliation-reminders" \
  --http-method=POST \
  --headers="x-scheduler-secret=<value-of-scheduler-shared-secret>"
```

For every active station with no reconciliation totals recorded yet for the current Nairobi calendar day, this in-app-notifies that station's Station Supervisor(s) (`Permission.RECONCILIATION_MANAGE`, which Station Supervisors now hold for their own station only — enforced server-side via `assertStationAccessible`). No email/admin-configurable schedule here, unlike price reminders — 20:00 is a fixed default; change the cron schedule directly if a different end-of-shift hour is needed.

## Cloud Scheduler: customer inactivity check

Not yet created — set this up manually:

```bash
gcloud scheduler jobs create http customer-inactivity-check \
  --location=<REGION> \
  --schedule="0 6 * * *" \
  --time-zone="Africa/Nairobi" \
  --uri="https://<api-domain>/api/v1/jobs/customer-inactivity-check" \
  --http-method=POST \
  --headers="x-scheduler-secret=<value-of-scheduler-shared-secret>"
```

Daily pass over customers: those with `lastActivityAt` older than `noticeAfterDays` (and no notice already sent) get an SMS notice; those already notified more than `resetAfterAdditionalDays` days ago have `totalCashbackEarned` zeroed. Both periods are Admin/RTSM-configurable from the Prices page settings, or via `PATCH /customer-inactivity-settings`. A fresh sale (`CustomersService.incrementCashback`) clears any pending notice, so a customer who returns before the reset window is never zeroed out.

## CI/CD

`.github/workflows/backend-deploy.yml` and `.github/workflows/frontend-deploy.yml` redeploy on every push to `main` that touches the relevant paths (or via manual `workflow_dispatch`). Both authenticate to GCP keylessly via Workload Identity Federation — no service account key lives in GitHub. One-time setup already done for `loyalty-points-413d5`:

```bash
gcloud iam workload-identity-pools create github-actions --location=global
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github-actions \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='GWELHQ/customer-loyalty'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

gcloud iam service-accounts create github-actions-deployer
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/run.admin"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/firebasehosting.admin"
gcloud iam service-accounts add-iam-policy-binding loyalty-api-run@<PROJECT_ID>.iam.gserviceaccount.com \
  --member="serviceAccount:github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser"
gcloud iam service-accounts add-iam-policy-binding github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/attribute.repository/<gh-owner>/<gh-repo>"
```

Neither workflow passes `--set-env-vars`/`--set-secrets` on redeploy — `gcloud run deploy` carries over the previous revision's env vars and secret mounts automatically, so those are only set once (see "Deploying the API to Cloud Run" above) and CI just ships a new image on top. Bump an env var or secret binding by re-running that `gcloud run deploy` command by hand with the new value; CI will keep it on every push after.

The backend workflow builds `apps/api/Dockerfile` directly on the runner and pushes to Artifact Registry before `gcloud run deploy`. The frontend workflow runs a normal `npm ci && npm run build --workspace=@loyalty/web` (with `VITE_*` build-time env baked into the static bundle — see the `env:` block in the workflow, not a runtime secret since a public SPA's tenant/client ID is visible in the shipped JS regardless) and pushes `apps/web/dist` via `firebase deploy --only hosting`.

## Environments

Use separate GCP projects for `dev`, `staging`, and `prod` (or at minimum separate Firestore databases/buckets/Entra app registrations per stage) — never share the `prod` Entra app registration's client secret or redirect URIs with a lower environment. Each stage gets its own `.env` populated from `apps/api/.env.example` / `apps/web/.env.example`, and its own Cloud Run env vars/secrets as above.
