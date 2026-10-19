# ModuleLens

Search the **full public Terraform Registry**, load every published module version and compare two releases to understand what changed and when your configuration may need updating.

**[Open ModuleLens](https://module-lens.onrender.com)** · [Source code](https://github.com/CVTPRN/module-lens)

The application interface, generated guidance, exports and project documentation are in English. Upstream identifiers, code examples and quoted documentation retain their original content.

## Live Terraform Registry explorer

- Search by keyword or enter an exact `namespace/name/provider` module address.
- Paste a Registry page URL or a `//modules/...` submodule address.
- Browse and paginate the full public catalog without a predefined module list.
- Filter by provider; modules from all providers remain accessible.
- Load all published semantic versions, including prereleases.
- Select submodules across the two chosen releases.
- Review added, removed and changed inputs, outputs, available provider requirements, module dependencies and resource lists.
- See applicability conditions, suggested actions and Registry evidence links for each finding.
- Review possible renames as uncertain hints; their additions and removals remain visible separately.
- Export JSON or Markdown reports and share comparison URLs.
- Use a responsive interface with keyboard navigation for search suggestions.

“Full Registry” describes the live API search scope, not a local copy of every module. The catalog loads 24 results at a time; **Load more modules** continues pagination. Terraform search has no curated module list or indexed-version limit.

## Run locally

The complete application requires **Python 3.12+** and no third-party Python packages at runtime:

```bash
python app.py --port 8080
```

Open **http://localhost:8080/**. The same server serves the interface and live Registry API. No token or user code is required. `npm run serve` starts the same server.

### Docker

```bash
docker compose up --build
```

Compose binds to **http://localhost:8080/** on the local machine by default. For hosting, use the Dockerfile on a container platform; the application listens on port `8080` inside the container.

### Node.js

Node.js 22+ is also supported without installing runtime packages:

```bash
node server/node-server.js
```

Configure this server with the `PORT` and `HOST` environment variables.

## Hosting and GitHub Pages

**GitHub Pages cannot run the live Registry API.** Registry responses do not provide the cross-origin browser access needed by this application, so live search uses a server-side gateway. The static Pages entry explains this and links to the hosted application configured in `web/site.json`.

| Deployment | Live Registry explorer | OpenTofu snapshots |
|---|---|---|
| Python server | Yes | Yes |
| Docker | Yes | Yes |
| Node.js server | Yes | Yes |
| Render web service | Yes | Yes |
| GitHub Pages / static hosting | Requires a separate API server | Yes |

### Render Free

The public application runs in **My Workspace**, in the **Frankfurt** region, on a **Free web service** using the repository Dockerfile. [Render dashboard](https://dashboard.render.com/web/srv-dbb0l6cs728c739vo49g).

- The interface and API share one origin.
- The service tracks the `main` branch. GitHub CI checks application changes independently.
- Health endpoint: `/api/registry/health`; application port: `8080`.
- No database or persistent disk is required.
- `render.yaml` records reproducible deployment settings. The current service was created through the Render integration and is not linked to a Blueprint; editing the YAML alone does not change its settings.
- Automatic deploys are configured for commits, but require a working Git provider connection. Verify that a new deployment starts after a push. If it does not, deploy the latest commit through the Render integration or dashboard.

The free service spins down after 15 minutes of inactivity; the next request can take about a minute to start it again. See [Render Free documentation](https://render.com/docs/free) for quotas and build/bandwidth limits.

## API

The Python and JavaScript servers provide the same read-only API:

```text
GET /api/registry/health
GET /api/registry/search?q=network&provider=azurerm&offset=0&limit=24
GET /api/registry/versions?module=terraform-aws-modules/ec2-instance/aws
GET /api/registry/module?module=terraform-aws-modules/ec2-instance/aws&version=6.0.0
```

An empty `q` browses the full catalog. The browser compares metadata for the selected versions; comparisons do not require a GitHub Actions job.

Both `app.py` and `server/registry-proxy.js` send GET requests only to the fixed `registry.terraform.io/v1/modules` upstream. They do not accept arbitrary proxy URLs, follow upstream redirects or forward visitor cookies or Authorization headers. Requests have timeouts, response size limits and bounded in-memory caches.

## OpenTofu snapshot view

The **OpenTofu →** link opens `opentofu.html`. This view compares HCL/JSON snapshots parsed from module sources, respects `.tofu` file precedence and includes documented migration guides.

It uses the curated catalog and versions configured in `modules.json`: AWS EKS, VPC and S3, plus Google Network and GKE. The live full-Registry search is available on the Terraform home page.

```bash
# Refresh source snapshots
python -m pip install -r requirements.txt
python -m collector.collect

# Refresh a single module
python -m collector.collect --module aws-eks
```

To add a public module, add its repository and optional anchor versions to `modules.json`, then refresh the catalog. Only processed versions are listed. The collector examines up to 400 tags, selecting recent stable releases, key releases from the last three major versions and configured anchors.

## Verification

```bash
python -m pip install -r requirements.txt
npm ci
python -m unittest discover -s tests -p 'test_*.py' -v
npm test
python scripts/build.py
```

Tests cover real EC2 Registry metadata, lists of 1,200 versions, semantic version ordering, missing metadata, conditional actions, pagination, provider filtering, stale asynchronous responses, HTTP path protection and the OpenTofu workflow. The build validates all 102 bundled snapshots.

DOM tests check behavior, not visual browser rendering. See [VALIDATION.md](VALIDATION.md) for verification results and limitations.

## Interpretation and limitations

The Terraform view compares **published Registry metadata**. It does not analyze user configuration, evaluate expressions or output values, inspect validation blocks or state, or reconstruct the complete migration history of intermediate releases. A missing Registry field does not prove a deletion or code change; it is flagged for review.

Possible renames are suggestions based on similar names and identical detailed descriptions. They are not proven mappings, so both the removed and added items remain listed.

The OpenTofu view analyzes source declarations and selected migration documents. Parser errors mark results as incomplete. Local submodules must be selected separately; transitive dependencies are not fully evaluated.

Use a Terraform/OpenTofu plan in your own environment to assess actual infrastructure impact. Finding no differences is not a guarantee of a trouble-free upgrade.

## Repository structure

- `web/index.html`, `web/registry-app.js`, `web/registry-styles.css`: live Registry interface, adapted from the supplied prototype.
- `web/lib/registry.js`: independently testable Registry metadata comparison.
- `app.py`: dependency-free Python HTTP and Registry server.
- `server/registry-proxy.js`, `server/node-server.js`: JavaScript gateway and standalone Node server.
- `sites-runtime/`: documentation for the optional hosted preview adapter.
- `web/opentofu.html`, `web/app.js`, `web/lib/compare.js`, `collector/`: HCL-based snapshot comparison.
- `modules.json`: curated snapshot catalog configuration.
- `.github/workflows/`: CI, snapshot refresh and static Pages deployment.
- `render.yaml`: reproducible Render service configuration.

Application code is MIT-licensed. Registry metadata and upstream documentation remain subject to their authors' terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
