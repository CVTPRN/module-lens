# Third-party notices

ModuleLens application code is MIT-licensed. Indexed module declarations and
documentation remain the property of their respective upstream authors and are
subject to the licenses distributed with each upstream version. The MIT license
does not relicense those materials.

Each compressed snapshot includes a `license_notices` array containing the
upstream LICENSE/NOTICE/COPYING texts and their immutable GitHub source URLs.
Decompress a snapshot with `gzip -dc path.json.gz` to inspect these notices.

Default upstream projects:

- https://github.com/terraform-aws-modules/terraform-aws-eks
- https://github.com/terraform-aws-modules/terraform-aws-vpc
- https://github.com/terraform-aws-modules/terraform-aws-s3-bucket
- https://github.com/terraform-google-modules/terraform-google-network
- https://github.com/terraform-google-modules/terraform-google-kubernetes-engine

Python dependencies (installed only by the indexing/build process):

- python-hcl2 — https://github.com/amplify-education/python-hcl2 (MIT)
- Lark — https://github.com/lark-parser/lark (MIT)
- regex — https://github.com/mrabarnett/mrab-regex (Apache-2.0 and CNRI-Python)

Terraform is a trademark of HashiCorp. OpenTofu is a Linux Foundation project.
AWS and Google Cloud product names belong to their respective owners.
ModuleLens is an independent project and is not endorsed by those organizations.
