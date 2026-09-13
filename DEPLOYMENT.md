# Deploy Cozy to Render

## One service, frontend and backend

`render.yaml` deploys the `main` branch as one **Free Docker web service** in
Singapore. The frontend and backend are separate build stages inside the image,
but share one running service and one public hostname:

```text
Browser -> HTTPS / WSS -> Render -> FastAPI (one Uvicorn worker)
                                   |-- /              React studio
                                   |-- /assets/*      Built JS, CSS and workers
                                   |-- /models/*      Validated furniture GLBs
                                   |-- /draco/*       Local model decoders
                                   |-- /health        Health check
                                   |-- /catalog       Authoritative catalog
                                   |-- /ws            Room state and Astra chat
                                   `-- /ws/voice      Optional voice control
```

The Docker build installs locked frontend and Python dependencies, runs
`scripts.prepare_assets`, then builds React. Model downloads are build-time work;
the application does not redownload models on each cold start. Preparation fails
the build if a recorded asset is unavailable, so a partial catalog is not silently
deployed. Retry the build if the asset source has a temporary outage.

The final image includes catalog data and built assets. `frontend/public` points
to `frontend/dist`, so backend model validation inspects the same files served to
the browser. It runs as a non-root user with one Uvicorn worker on Render's `PORT`.
The API key is supplied at runtime and excluded from the image build context.

## Create the free service

1. Push the updated `main` branch to GitHub.
2. In the [Render dashboard](https://dashboard.render.com/), select **New >
   Blueprint**, choose the Cozy repository and **main** as the Blueprint branch.
   Render reads the root `render.yaml`, which also sets the service branch to main.
3. Confirm **Free**, Docker, Singapore, and `/health` as the health check. Enter
   `OPENAI_API_KEY` when prompted, then deploy. Text design requires Astra access;
   optional voice also requires GPT-Live access with the same backend key.
4. Open the assigned `https://<service>.onrender.com` URL. Confirm the collection
   loads models, manual edits work, chat connects and the room restores on refresh.
   Testing Astra or voice incurs separate API usage.

To skip Blueprints, use **New > Web Service** with the same repository and **main**
branch. Select **Docker**, **Free**, and **Singapore**. Leave Root Directory and
Docker Command empty; set Dockerfile Path to `./Dockerfile`, health check to
`/health`, and add the backend `OPENAI_API_KEY` environment variable.

If a service already exists from `codex/render-deploy`, update that service's
branch to **main** instead of creating a duplicate. If it is Blueprint-managed,
change the Blueprint source branch to main too, then sync. Its service name stays
`cozy`; retain the existing API-key value in Render's environment settings.

## Free-tier behavior

Free web services sleep after 15 minutes without incoming HTTP requests or
WebSocket messages and take about a minute to wake. Open the app before a demo.
Sleeping, restarts and deployments clear server sessions and active agent work.
This studio can restore its saved room from browser localStorage and recent chat
from sessionStorage; this is browser recovery, not server-side durable storage.
Keep one worker and one instance. A database or Key Value service is not required.

Free hosting has monthly usage limits. API usage is separate. The prototype has
no login: anyone with its URL can initiate design work using the backend key.
See [Render's free-tier limits](https://render.com/docs/free).

## Add your subdomain

1. After the Render URL works, open the service's **Settings > Custom Domains**
   and add your actual subdomain, for example `cozy.example.com`.
2. At your DNS provider, add a **CNAME** for `cozy` pointing to the service's exact
   `<service>.onrender.com` hostname, without `https://` or a path. Follow the
   specific records displayed by Render. Modify only the chosen subdomain.
3. With Cloudflare DNS, start with **DNS only** (gray cloud) for verification.
4. Verify the domain in Render and wait for its managed HTTPS certificate. Open
   your subdomain and check manual edits, Astra chat and optional voice.

The frontend derives both WebSocket URLs from its current host. No CORS setup,
frontend API URL, separate backend subdomain or rebuild is needed. Free instances
support custom domains and managed TLS. Browser storage is per origin, so moving
from the Render URL to the custom subdomain starts with separate browser storage.
Existing browser backups are not automatically transferred between hostnames.

See [custom domains](https://render.com/docs/custom-domains),
[Cloudflare DNS](https://render.com/docs/configure-cloudflare-dns), and
[Blueprint configuration](https://render.com/docs/blueprint-spec).

## Local production check

With Docker running, from the repository root:

```sh
docker build -t cozy .
docker run --rm -p 10000:10000 --env-file .env.local cozy
```

Open `http://localhost:10000`. Omit `--env-file .env.local` to exercise the manual
studio and connections without enabling API requests. Builds download the
recorded models and need network access and time for the first asset build.
