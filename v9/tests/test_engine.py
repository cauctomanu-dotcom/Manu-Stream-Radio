"""Offline tests for the staged autonomous scheduler. Run: python3 -m unittest discover -s v9/tests -v"""
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ENGINE = Path(__file__).resolve().parents[1] / "engine.py"
SPEC = importlib.util.spec_from_file_location("msr_engine", ENGINE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
Station = module.Station
TZ = ZoneInfo("Europe/Paris")


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.media = base / "media"
        self.station = Station(self.media, base / "db" / "station.sqlite3")
        for folder, names in {
            "Musique": ["a.mp3", "b.mp3", "c.mp3", "d.mp3", "e.mp3", "f.mp3"],
            "Jingles/Général": ["intro.mp3"],
            "Chroniques": ["gaming.wav", "vanessa.mp3"],
        }.items():
            path = self.media / folder
            path.mkdir(parents=True, exist_ok=True)
            for name in names:
                (path / name).write_bytes(b"test file")
        self.station.scan()
        # Existing scheduler tests assume an explicitly approved six-song library.
        for name in ("a", "b", "c", "d", "e", "f"):
            self.station.set_rotation({"media_path": f"Musique/{name}.mp3", "enabled": True})

    def tearDown(self):
        self.tmp.cleanup()

    def at(self, hour, minute, day=4):
        return datetime(2026, 11, day, hour, minute, tzinfo=TZ)

    def test_audio_returns_musical_rotation(self):
        items = [Path(self.station.next_media(self.at(8, 0))).name for _ in range(3)]
        self.assertEqual(len(set(items)), 3)
        self.assertEqual(Path(self.station.next_media(self.at(8, 12))).name, "intro.mp3")

    def test_only_explicitly_authorized_music_can_rotate(self):
        for name in ("b", "c", "d", "e", "f"):
            self.station.set_rotation({"media_path": f"Musique/{name}.mp3", "enabled": False})
        self.assertEqual(Path(self.station.next_media(self.at(8, 0))).name, "a.mp3")
        self.assertEqual(Path(self.station.next_media(self.at(8, 1))).name, "a.mp3")
        self.station.set_rotation({"media_path": "Musique/a.mp3", "enabled": False})
        self.assertEqual(self.station.next_media(self.at(8, 2)), "")

    def test_new_media_start_disabled_and_scan_preserves_permissions(self):
        (self.media / "Musique" / "new.mp3").write_bytes(b"test")
        self.station.scan()
        music = {x["path"]: x for x in self.station.media_list() if x["kind"] == "music"}
        self.assertFalse(music["Musique/new.mp3"]["rotation_enabled"])
        self.assertTrue(music["Musique/a.mp3"]["rotation_enabled"])
        with self.assertRaises(ValueError):
            self.station.set_rotation({"media_path": "Chroniques/gaming.wav", "enabled": True})
        with self.assertRaises(ValueError):
            self.station.set_rotation({"media_path": "Musique/a.mp3", "enabled": 1})

    def test_automatic_jingles_use_only_general(self):
        seasonal = self.media / "Jingles" / "Noël"
        seasonal.mkdir()
        (seasonal / "special.mp3").write_bytes(b"test")
        self.station.scan()
        with self.station.db() as db:
            chosen = [self.station._choose(db, "jingles") for _ in range(10)]
        self.assertEqual(set(chosen), {"Jingles/Général/intro.mp3"})

    def test_program_waits_for_track_boundary_and_jingle(self):
        self.station.add_rule({"title": "Gaming",
                               "media_path": "Chroniques/gaming.wav",
                               "local_time": "15:15", "weekdays": [2]})
        # Before the scheduled time, no rule starts.
        self.assertIn("Musique", self.station.next_media(self.at(15, 14)))
        first = self.station.next_media(self.at(15, 17))
        self.assertEqual(Path(first).name, "intro.mp3")
        # The next track request after the jingle must play the SAME program.
        restarted = Station(self.media, self.station.database)
        second = restarted.next_media(self.at(15, 18))
        self.assertEqual(Path(second).name, "gaming.wav")
        self.assertNotIn("gaming.wav", restarted.next_media(self.at(15, 19)))
        self.assertEqual(len(restarted.rules_list()), 1)

    def test_recurring_rule_is_not_replayed_same_day(self):
        self.station.add_rule({"title": "Vanessa", "media_path": "Chroniques/vanessa.mp3",
                               "local_time": "18:15", "weekdays": list(range(7))})
        self.station.next_media(self.at(18, 16))
        self.assertTrue(self.station.next_media(self.at(18, 17)).endswith("vanessa.mp3"))
        others = [self.station.next_media(self.at(18, 18)) for _ in range(4)]
        self.assertTrue(all(not p.endswith("vanessa.mp3") for p in others))

    def test_old_event_expires_after_grace_period(self):
        self.station.add_rule({"title": "Gaming", "media_path": "Chroniques/gaming.wav",
                               "local_time": "15:15", "grace_minutes": 5})
        selection = self.station.next_media(self.at(15, 35))
        self.assertIn("Musique", selection)

    def test_media_path_traversal_rejected(self):
        for path in ["../../etc/passwd", "Musique/../Chroniques/gaming.wav",
                     "/etc/passwd", "Musique/malware.exe"]:
            with self.assertRaises(ValueError):
                module.safe_media_path(self.media, path)
        with self.assertRaises(ValueError):
            self.station.add_rule({"title":"bad", "media_path":"../../etc/passwd",
                                   "local_time":"10:15"})

    def test_new_folder_with_unicode_name_and_nested_tree(self):
        first = self.station.create_folder("Jingles", "Saint-Valentin")
        self.assertEqual(first, "Jingles/Saint-Valentin")
        second = self.station.create_folder(first, "Été 2027")
        self.assertEqual(second, "Jingles/Saint-Valentin/Été 2027")
        self.assertIn(second, self.station.folder_list())
        with self.assertRaises(FileExistsError):
            self.station.create_folder("Jingles", "Saint-Valentin")
        for bad in ["../ailleurs", "été/ailleurs", ".caché", "nom.", " nom"]:
            with self.assertRaises(ValueError):
                self.station.create_folder("Jingles", bad)
        with self.assertRaises(ValueError):
            self.station.create_folder("../etc", "Autre")
        with self.assertRaises(ValueError):
            self.station.create_folder(".studio-edit", "Autre")

    def test_scan_removes_missing_media_but_keeps_rules(self):
        (self.media / "Musique" / "f.mp3").unlink()
        indexed = self.station.scan()
        self.assertEqual(indexed["indexed"], 8)
        self.assertNotIn("Musique/f.mp3", [m["path"] for m in self.station.media_list()])


if __name__ == "__main__":
    unittest.main()
