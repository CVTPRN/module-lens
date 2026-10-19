import io
import tarfile
import unittest

from collector.collect import read_archive, select_tags
from collector.snapshot import make_snapshot


def snapshot(files, engine="terraform"):
    return make_snapshot(files, "example/module", "v1.0.0", "a" * 40, engine)


class SnapshotTests(unittest.TestCase):
    def test_required_vs_explicit_null(self):
        data = snapshot({"variables.tf": 'variable "required" { type = string }\nvariable "optional" { default = null }'})
        inputs = data["scopes"]["."]["inputs"]
        self.assertNotIn("default", inputs["required"])
        self.assertIsNone(inputs["optional"]["default"])

    def test_multiline_types_and_heredoc(self):
        text = '''variable "settings" {
          type = object({ name = string, tags = map(string) })
          description = <<-EOT
          A string with { braces }, // and # characters.
          EOT
          validation { condition = length(var.settings.name) > 0
            error_message = "Provide a name." }
        }'''
        data = snapshot({"variables.tf": text})["scopes"]["."]
        self.assertFalse(data["warnings"])
        self.assertIn("object", data["inputs"]["settings"]["type"])
        self.assertIn("validation", data["inputs"]["settings"])

    def test_opentofu_counterparts(self):
        files = {"versions.tf": 'terraform { required_version = ">= 1.5" }',
            "versions.tofu": 'terraform { required_version = ">= 1.8" }'}
        tf = snapshot(files)["scopes"]["."]
        tofu = snapshot(files, "opentofu")["scopes"]["."]
        self.assertEqual(tf["requirements"][0]["constraint"], ">= 1.5")
        self.assertEqual(tofu["requirements"][0]["constraint"], ">= 1.8")
        self.assertEqual(len(tofu["files"]), 1)

    def test_json_counterparts(self):
        files = {"variables.tf.json": '{"variable":{"name":{"default":"old"}}}',
            "variables.tofu.json": '{"variable":{"name":{"default":"new"}}}'}
        self.assertEqual(snapshot(files)["scopes"]["."]["inputs"]["name"]["default"], "old")
        self.assertEqual(snapshot(files, "opentofu")["scopes"]["."]["inputs"]["name"]["default"], "new")

    def test_submodules_are_separate_and_examples_skipped(self):
        data = snapshot({"main.tf": 'output "root" { value = 1 }',
            "modules/child/main.tf": 'output "child" { value = 2 }',
            "examples/basic/main.tf": 'output "example" { value = 3 }'})
        self.assertEqual(set(data["scopes"]), {".", "modules/child"})

    def test_parse_errors_are_visible(self):
        scope = snapshot({"bad.tf": 'variable "x" { ??? }'})["scopes"]["."]
        self.assertEqual(len(scope["warnings"]), 1)
        self.assertEqual(scope["inputs"], {})

    def test_unknown_blocks_and_overrides_are_visible(self):
        scope = snapshot({"x_override.tf": 'future "x" { name = "a" }'})["scopes"]["."]
        self.assertEqual(len(scope["warnings"]), 2)

    def test_providers_resources_and_state(self):
        text = '''terraform { required_providers { aws = { source = "hashicorp/aws", version = ">= 5" } } }
        resource "aws_vpc" "this" { cidr_block = "10.0.0.0/16" }
        moved { from = aws_vpc.old
          to = aws_vpc.this }
        removed { from = aws_vpc.gone
          lifecycle { destroy = false } }
        module "nested" { source = "./modules/nested" }'''
        scope = snapshot({"main.tf": text})["scopes"]["."]
        self.assertFalse(scope["warnings"])
        self.assertEqual(scope["providers"]["aws"]["requirement"]["version"], ">= 5")
        self.assertIn("aws_vpc.this", scope["resources"])
        self.assertEqual(len(scope["moves"]), 1)
        self.assertEqual(len(scope["removals"]), 1)

    def test_only_explicit_documented_renames(self):
        data = snapshot({"docs/UPGRADE-2.0.md": '* `old_name` -> `new_name`\n* `second` → `third`',
            "main.tf": 'variable "new_name" { default = null }'})
        self.assertEqual(len(data["renames"]), 2)
        self.assertIn("#L1", data["renames"][0]["source"])

    def test_license_preserved(self):
        self.assertEqual(snapshot({"LICENSE": "License text"})["license_notices"][0]["text"], "License text")

    def test_immutable_evidence(self):
        url = snapshot({"main.tf": 'output "x" { value = 1 }'})["scopes"]["."]["outputs"]["x"]["_source"]
        self.assertIn("/blob/" + "a" * 40 + "/main.tf", url)


class CollectionTests(unittest.TestCase):
    def test_tags_numeric_order_and_anchors(self):
        tags = [{"name": name} for name in ["v2.9.0", "v2.10.0", "v2.0.0", "v1.0.0", "v2.11.0-beta.1", "garbage"]]
        selected, missing = select_tags(tags, ["v0.1.0"], recent=1)
        self.assertEqual(selected[0]["name"], "v2.10.0")
        self.assertNotIn("v2.11.0-beta.1", [x["name"] for x in selected])
        self.assertEqual(missing, ["v0.1.0"])

    def archive(self, path, data=b'output "x" { value = 1 }', symlink=False):
        memory = io.BytesIO()
        with tarfile.open(fileobj=memory, mode="w:gz") as archive:
            entry = tarfile.TarInfo(path)
            if symlink:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "/etc/passwd"
            else:
                entry.size = len(data)
            archive.addfile(entry, None if symlink else io.BytesIO(data))
        return memory.getvalue()

    def test_unsafe_archive_rejected(self):
        for path in ["repo/../../escape.tf", "/absolute/main.tf"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                read_archive(self.archive(path))

    def test_symlinks_ignored_and_files_not_extracted(self):
        self.assertEqual(read_archive(self.archive("repo/main.tf", symlink=True)), {})
        self.assertIn("main.tf", read_archive(self.archive("repo/main.tf")))


if __name__ == "__main__":
    unittest.main()
