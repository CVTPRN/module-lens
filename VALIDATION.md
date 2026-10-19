# Verification results — 2026-10-19

## Application checks

- Python: 20 tests cover source parsing, real HTTP serving and Registry route protection.
- JavaScript/DOM/Node: 46 tests cover HCL comparisons, the live Registry workflow, pagination, provider filtering, complete version lists, semantic versions, error handling, stale responses, the standalone Node server and static-hosting fallback.
- English UI labels, comparison conditions, actions and Markdown report expectations are exercised by the existing comparison and DOM tests.
- Registry fixtures use real `terraform-aws-modules/ec2-instance/aws` metadata for versions 5.0.0 and 6.0.0, independently of the curated catalog.
- Version handling is tested with 1,200 entries and is not restricted to locally indexed versions.
- The static build validates all 102 bundled Terraform/OpenTofu snapshots.
- GitHub Pages builds preserve the hosted application link in `site.json` when `GITHUB_REPOSITORY` is set.
- Bundled module descriptions and parser warnings are in English. Upstream source declarations, license texts, identifiers and evidence URLs are preserved.

## Hosting checks

The initial public Render deployment returned HTTP 200 for the home page, health endpoint, Azure module search, EC2 version list and EC2 6.0.0 metadata. The EC2 version list contained 99 releases at verification time.

Render automatic deployment is configured, but the subsequent documentation commit did not start a deployment. Do not assume a push has reached production: check the deployed commit and explicitly deploy the latest version when required.

## Limitations

- No visual browser inspection was performed. DOM tests verify behavior, not rendered appearance.
- Full Registry search requires a server-side API. The Pages view explains API unavailability and links to the hosted application.
- Registry comparisons use published metadata; they do not inspect user configuration, state, output expressions or the complete migration history of skipped releases.
- In the OpenTofu snapshot view, the pinned HCL parser cannot fully process two files in the Google Network `modules/foundation/network` submodule for v18.2.0, v18.3.0 and v18.3.1. Reports mark this analysis as incomplete.

## Reproduce

```bash
python -m pip install -r requirements.txt
npm ci
python -m unittest discover -s tests -p 'test_*.py' -v
npm test
python scripts/build.py
```
