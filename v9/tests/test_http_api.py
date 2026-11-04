"""Exercise admin auth and large-file streaming without a real Icecast server."""
import http.client
import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1] / "engine.py"
SPEC = importlib.util.spec_from_file_location("msr_engine_http", ENGINE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class QuietAPI(module.API):
    def log_message(self, *args):
        pass


class APITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.saved_token = os.environ.get("MSR_ADMIN_TOKEN")
        self.saved_status_url = os.environ.get("MSR_ICECAST_STATUS_URL")
        os.environ["MSR_ADMIN_TOKEN"] = "test-only-random-token"
        os.environ.pop("MSR_ICECAST_STATUS_URL", None)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietAPI)
        self.server.station = module.Station(self.root / "media", self.root / "db.sqlite3")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.tmp.cleanup()
        if self.saved_token is None:
            os.environ.pop("MSR_ADMIN_TOKEN", None)
        else:
            os.environ["MSR_ADMIN_TOKEN"] = self.saved_token
        if self.saved_status_url is not None:
            os.environ["MSR_ICECAST_STATUS_URL"] = self.saved_status_url

    def request(self, method, path, body=None, authenticated=True, extra_headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = dict(extra_headers or {})
        if authenticated:
            headers["Authorization"] = "Bearer test-only-random-token"
        if body is not None:
            headers["Content-Length"] = str(len(body))
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        status = response.status
        data = response.read()
        conn.close()
        return status, json.loads(data)

    def test_admin_requires_token(self):
        status, _ = self.request("GET", "/api/admin/state", authenticated=False)
        self.assertEqual(status, 401)
        status, data = self.request("GET", "/api/public/status", authenticated=False)
        self.assertEqual(status, 200)
        self.assertIsNone(data["online"])

    def test_media_upload_then_schedule(self):
        payload = b"pretend MP3 file" * 500
        status, data = self.request("PUT", "/api/admin/media/Chroniques/gaming.mp3", payload)
        self.assertEqual(status, 201)
        self.assertEqual(data["bytes"], len(payload))
        self.assertEqual((self.root / "media/Chroniques/gaming.mp3").read_bytes(), payload)
        code, _ = self.request("PUT", "/api/admin/media/Chroniques/gaming.mp3", b"overwrite")
        self.assertEqual(code, 409)
        rule = {"title": "Actu gaming", "media_path": "Chroniques/gaming.mp3",
                "local_time": "15:15", "weekdays": [0, 1, 2, 3, 4, 5, 6]}
        code, out = self.request("POST", "/api/admin/rules", json.dumps(rule).encode(),
                                 extra_headers={"Content-Type": "application/json"})
        self.assertEqual(code, 201)
        self.assertRegex(out["id"], "^[0-9a-f]{32}$")
        code, data = self.request("GET", "/api/admin/state")
        self.assertEqual(code, 200)
        self.assertEqual(len(data["rules"]), 1)
        code, deleted = self.request("DELETE", "/api/admin/rules/" + out["id"])
        self.assertEqual(code, 200)
        self.assertEqual(deleted["deleted"], out["id"])

    def test_new_folder_api_and_nested_upload(self):
        self.server.station.scan()
        folder = {"parent": "Jingles", "name": "Saint-Valentin"}
        code, out = self.request("POST", "/api/admin/folders",
            json.dumps(folder).encode(),extra_headers={"Content-Type":"application/json"})
        self.assertEqual(code, 201)
        self.assertEqual(out["path"], "Jingles/Saint-Valentin")
        code, _ = self.request("POST", "/api/admin/folders",json.dumps(folder).encode())
        self.assertEqual(code, 409)
        code, state = self.request("GET", "/api/admin/state")
        self.assertIn("Jingles/Saint-Valentin", state["folders"])
        code, result = self.request("PUT",
            "/api/admin/media/Jingles/Saint-Valentin/Special.mp3", b"data")
        self.assertEqual(code, 201)
        self.assertEqual(result["saved"],"Jingles/Saint-Valentin/Special.mp3")
        bad = {"parent": "Jingles", "name": "../outside"}
        code, _ = self.request("POST", "/api/admin/folders",json.dumps(bad).encode())
        self.assertEqual(code, 400)
        code, _ = self.request("POST", "/api/admin/folders",
            json.dumps({"parent":"Jingles", "name":"Hack"}).encode(), authenticated=False)
        self.assertEqual(code, 401)

    def test_upload_traversal_is_rejected(self):
        code, _ = self.request("PUT", "/api/admin/media/Chroniques/../../../escape.mp3", b"x")
        self.assertEqual(code, 400)


if __name__ == "__main__":
    unittest.main()
