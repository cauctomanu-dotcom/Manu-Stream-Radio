"""Dry-run must never update a live database or require Icecast."""
import importlib.util
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

V9 = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "msr_planner_dryrun", V9 / "tools" / "studio_planner_dry_run.py")
dryrun = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dryrun)
from engine import Station  # imported by the tool above


class DryRunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "media"
        self.db = base / "original.sqlite3"
        self.music = self.root / "Musique" / "music.mp3"
        self.chronicle = self.root / "Chroniques" / "Actu Gaming" / "gaming.wav"
        self.jingle = self.root / "Jingles" / "Général" / "station.mp3"
        for media in (self.music, self.chronicle, self.jingle):
            media.parent.mkdir(parents=True, exist_ok=True)
            media.write_bytes(b"fake-audio")
        station = Station(self.root, self.db)
        station.scan()
        station.set_rotation({"media_path": "Musique/music.mp3", "enabled": True})
        self.station = station

    def tearDown(self):
        self.tmp.cleanup()

    def rule(self, enabled):
        return {
            "id": "gaming", "kind": "chronicle", "label": "ACTU GAMING",
            "days": [2], "enabled": enabled,
            "start": "00:00", "end": "23:59",
            "scheduleMode": "exact-times", "sourceMode": "exact",
            "exactTimes": ["19:30"],
            "mediaRel": "Chroniques/Actu Gaming/gaming.wav"
        }

    def count(self, table):
        with sqlite3.connect(self.db) as db:
            return db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]

    def test_dry_run_exercises_scheduled_chronicle_but_preserves_live_database(self):
        self.station.update_studio_planner({
            "expected_revision": 0, "plannerOn": True,
            "plannerRules": [self.rule(True)]})
        previous_flag = os.environ.get("MSR_ENABLE_STUDIO_PLANNER")
        before = {t: self.count(t) for t in ("runs", "history", "state")}
        start = datetime(2026, 11, 4, 19, 30, tzinfo=ZoneInfo("Europe/Paris"))
        results = dryrun.simulate(self.root, self.db, start, steps=4, spacing=4)
        self.assertEqual([r["category"] for r in results[:2]],
                         ["jingles", "scheduled"])
        self.assertEqual(results[1]["title"], "ACTU GAMING")
        self.assertEqual(before, {t: self.count(t) for t in ("runs", "history", "state")})
        self.assertEqual(os.environ.get("MSR_ENABLE_STUDIO_PLANNER"), previous_flag)

    def test_disabled_chronicle_is_not_simulated(self):
        self.station.update_studio_planner({
            "expected_revision": 0, "plannerOn": True,
            "plannerRules": [self.rule(False)]})
        start = datetime(2026, 11, 4, 19, 30, tzinfo=ZoneInfo("Europe/Paris"))
        results = dryrun.simulate(self.root, self.db, start, steps=4, spacing=4)
        self.assertNotIn("scheduled", [r["category"] for r in results])
        self.assertEqual(self.count("runs"), 0)


if __name__ == "__main__":
    unittest.main()
