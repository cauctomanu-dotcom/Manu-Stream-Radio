"""Check the safe Studio 7J/24H snapshot contract and concurrency handling."""
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
SPEC = importlib.util.spec_from_file_location("msr_planner_http", ENGINE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class QuietAPI(module.API):
    def log_message(self, *args):
        pass


class StudioPlannerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.old_token = os.environ.get("MSR_ADMIN_TOKEN")
        os.environ["MSR_ADMIN_TOKEN"] = "studio-planner-test-only"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietAPI)
        self.server.station = module.Station(self.root / "media", self.root / "db.sqlite3")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        if self.old_token is None:
            os.environ.pop("MSR_ADMIN_TOKEN", None)
        else:
            os.environ["MSR_ADMIN_TOKEN"] = self.old_token
        self.tmp.cleanup()

    def request(self, method, payload=None, authenticated=True):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=5)
        headers = {}
        if authenticated:
            headers["Authorization"] = "Bearer studio-planner-test-only"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection.request(method, "/api/admin/studio-planner", body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read().decode("utf-8"))
        connection.close()
        return result

    def test_old_imported_snapshot_stays_readable_at_revision_zero(self):
        rules = [self.rule(i) for i in range(27)]
        with self.server.station.db() as db:
            self.server.station._put(db, "studio_planner_snapshot_v1", json.dumps(
                {"plannerOn": True, "plannerRules": rules}, ensure_ascii=False))
        status, snapshot = self.request("GET")
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["revision"], 0)
        self.assertEqual(len(snapshot["plannerRules"]), 27)
        self.assertEqual(sum(x["enabled"] for x in snapshot["plannerRules"]), 3)
        self.assertEqual(snapshot["plannerRules"][0]["label"], "Réglage n° 0")

    def rule(self, index):
        return {"id": str(index), "kind": "rotation" if index == 0 else "chronicle",
                "label": f"Réglage n° {index}", "days": [0, 1, 2, 3, 4, 5, 6],
                "start": "00:00", "end": "23:59",
                "enabled": index in (0, 6, 26),
                "repeatMinutes": 120 if index == 0 else None,
                "rotationPath": ""}

    def test_authenticated_update_uses_revision_and_retains_disabled_rules(self):
        rules = [self.rule(i) for i in range(27)]
        payload = {"plannerOn": True, "plannerRules": rules, "expected_revision": 0}
        code, _ = self.request("PUT", payload, authenticated=False)
        self.assertEqual(code, 401)
        code, saved = self.request("PUT", payload)
        self.assertEqual(code, 200)
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(sum(x["enabled"] for x in saved["plannerRules"]), 3)
        code, conflict = self.request("PUT", payload)
        self.assertEqual(code, 409)
        self.assertIn("actualiser", conflict["error"])
        code, current = self.request("GET")
        self.assertEqual(code, 200)
        self.assertEqual(len(current["plannerRules"]), 27)
        self.assertEqual(current["revision"], 1)
        payload["expected_revision"] = 1
        payload["plannerRules"][6]["enabled"] = False
        code, saved = self.request("PUT", payload)
        self.assertEqual(code, 200)
        self.assertEqual(saved["revision"], 2)
        code, restored = self.request("GET")
        self.assertEqual(code, 200)
        self.assertEqual(sum(x["enabled"] for x in restored["plannerRules"]), 2)

    def test_invalid_planner_rejected_without_overwriting_snapshot(self):
        sample = {"plannerOn": True, "plannerRules": [self.rule(0)],
                  "expected_revision": 0}
        for changed in [
            {**sample, "plannerOn": 1},
            {**sample, "expected_revision": "0"},
            {**sample, "plannerRules": [{**self.rule(0), "days": [7]}]},
            {**sample, "plannerRules": [{**self.rule(0), "start": "25:00"}]},
            {**sample, "plannerRules": [{**self.rule(0), "enabled": 1}]},
        ]:
            code, _ = self.request("PUT", changed)
            self.assertEqual(code, 400)
        code, snapshot = self.request("GET")
        self.assertEqual(code, 200)
        self.assertEqual(snapshot["revision"], 0)
        self.assertEqual(snapshot["plannerRules"], [])

    def test_planner_snapshot_does_not_add_playout_rules(self):
        self.server.station.scan()
        music = self.root / "media" / "Musique" / "approved.mp3"
        music.parent.mkdir(exist_ok=True)
        music.write_bytes(b"song")
        self.server.station.scan()
        self.server.station.set_rotation(
            {"media_path": "Musique/approved.mp3", "enabled": True})
        code, _ = self.request("PUT", {"plannerOn": True,
            "plannerRules": [self.rule(i) for i in range(27)],
            "expected_revision": 0})
        self.assertEqual(code, 200)
        self.assertEqual(self.server.station.rules_list(), [])
        self.assertEqual(Path(self.server.station.next_media()).name, "approved.mp3")


if __name__ == "__main__":
    unittest.main()
