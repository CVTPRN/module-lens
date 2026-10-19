import unittest
import urllib.parse
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from threading import Thread
import urllib.request
import urllib.error
import json
import app


class RegistryServerTests(unittest.TestCase):
    def test_all_module_listing_and_pagination(self):
        url = app.upstream_url('search', {'offset': ['1000'], 'limit': ['24']})
        self.assertTrue(url.startswith('https://registry.terraform.io/v1/modules?'))
        self.assertIn('offset=1000', url)

    def test_provider_and_query_encoded(self):
        url = app.upstream_url('search', {'q': ['virtual network'], 'provider': ['azurerm']})
        self.assertIn('q=virtual+network', url)
        self.assertIn('provider=azurerm', url)

    def test_only_fixed_origin_and_valid_addresses(self):
        for module in ['https://evil.test', 'a/b/c/../../secret', 'a/b/c?token=x']:
            with self.subTest(module=module), self.assertRaises(app.ApiError):
                app.upstream_url('versions', {'module': [module]})

    def test_invalid_offsets_and_versions(self):
        with self.assertRaises(app.ApiError):
            app.upstream_url('search', {'offset': ['-1']})
        with self.assertRaises(app.ApiError):
            app.upstream_url('module', {'module': ['a/b/c'], 'version': ['../../secret']})

    def test_prerelease_versions_supported(self):
        url = app.upstream_url('module', {'module': ['a/b/c'], 'version': ['1.2.3-rc.10+build.2']})
        self.assertIn('1.2.3-rc.10%2Bbuild.2', url)

    def test_http_same_origin_frontend_and_api_and_traversal_protection(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            with urllib.request.urlopen(base + '/') as response:
                self.assertIn('registry-app.js', response.read().decode())
            with urllib.request.urlopen(base + '/api/registry/health') as response:
                self.assertTrue(json.load(response)['ok'])
            with patch.object(app, 'registry_json_bytes', return_value=b'{"modules":[],"meta":{}}'):
                with urllib.request.urlopen(base + '/api/registry/search?offset=24') as response:
                    self.assertEqual(json.load(response)['modules'], [])
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + '/%2e%2e/app.py')
            self.assertEqual(error.exception.code, 404)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + '/api/registry/versions?module=../../secret')
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
