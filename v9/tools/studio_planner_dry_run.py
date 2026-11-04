#!/usr/bin/env python3
"""Replay Studio V9 planner decisions against a TEMPORARY COPY of live SQLite.

This tool never edits the production database, the Studio configuration,
Liquidsoap configuration, or any systemd service. It does not play audio.
The V9 feature flag applies only to this short-lived local simulation.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

V9_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V9_DIR))
from engine import LOCAL_TZ, Station  # noqa: E402

DEFAULT_DB = Path("/var/lib/msr-v9/station.sqlite3")
DEFAULT_ENV = Path("/etc/msr-v9/station.env")


def get_env_value(path: Path, name: str) -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == name:
            chunks = shlex.split(value)
            return chunks[0] if chunks else ""
    raise ValueError(f"{name} is not configured in {path}")


def snapshot_database(original: Path, temporary: Path) -> None:
    if not original.is_file():
        raise FileNotFoundError(f"Production database not found: {original}")
    # Read-only source connection; sqlite backup copies a consistent WAL snapshot.
    source = sqlite3.connect(f"{original.as_uri()}?mode=ro", uri=True)
    try:
        with sqlite3.connect(temporary) as dest:
            source.backup(dest)
    finally:
        source.close()


def simulate(media_root: Path, db_path: Path, when: datetime,
             steps: int, spacing: int) -> list[dict]:
    if not media_root.is_dir():
        raise FileNotFoundError(f"Media directory not found: {media_root}")
    results = []
    with tempfile.TemporaryDirectory(prefix="msr-v9-dryrun-") as tmp:
        scratch = Path(tmp) / "station.sqlite3"
        snapshot_database(db_path, scratch)
        station = Station(media_root, scratch)
        preview = station.studio_planner_preview(when)
        print("=== STUDIO V9 / PROGRAMMATION SIMULEE ===")
        print("Date de depart :", when.isoformat())
        print("Revision :", preview["revision"])
        print("Planificateur :", preview["plannerOn"])
        print("Cadence jingle (musiques) :", preview["active_jingle_every_tracks"])
        print("Fichiers absents :", len(preview["missing_media"]))
        print("Cette simulation ne diffuse aucun son.")
        print("Base SQLite : COPIE TEMPORAIRE, suppression automatique en fin de test.")
        print("Aucun service n'est redemarre ou reconfigure.")
        print()
        original_flag = os.environ.get("MSR_ENABLE_STUDIO_PLANNER")
        try:
            os.environ["MSR_ENABLE_STUDIO_PLANNER"] = "1"
            for index in range(steps):
                boundary = when + timedelta(minutes=index * spacing)
                selected = station.next_media(boundary)
                with station.db() as db:
                    raw = station._get(db, "now", "{}")
                    state = json.loads(raw)
                    pending = bool(station._get(db, "pending_rule"))
                    count = int(station._get(db, "songs_since_jingle", "0"))
                if selected and not Path(selected).is_file():
                    raise RuntimeError(f"Selected file unavailable: {selected}")
                info = {
                    "time": boundary.strftime("%a %H:%M"),
                    "category": state.get("category", "none") if selected else "silence",
                    "title": state.get("title", "") if selected else "(aucun fichier)",
                    "path": state.get("media_path", "") if selected else "",
                    "pending_chronicle": pending,
                    "songs_since_jingle": count,
                }
                if info["category"] == "music":
                    with station.db() as db:
                        allowed = db.execute(
                            "SELECT rotation_enabled FROM media WHERE path=? AND kind='music'",
                            (info["path"],)).fetchone()
                    if not allowed or not allowed["rotation_enabled"]:
                        raise RuntimeError("Unauthorized music selected: " + info["path"])
                results.append(info)
                print(
                    f"{index + 1:02d}. {info['time']} | {info['category']:9} | "
                    f"{info['title']} | musiques depuis jingle={count} | "
                    f"chronique en attente={'oui' if pending else 'non'}"
                )
        finally:
            if original_flag is None:
                os.environ.pop("MSR_ENABLE_STUDIO_PLANNER", None)
            else:
                os.environ["MSR_ENABLE_STUDIO_PLANNER"] = original_flag
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV,
                        help="Production env file (read-only; no tokens printed)")
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--media-root", type=Path, default=None)
    parser.add_argument("--at", default="2026-11-04T19:30:00+01:00",
                        help="Simulation start time (ISO 8601 with Paris offset)")
    parser.add_argument("--steps", type=int, default=9)
    parser.add_argument("--spacing-minutes", type=int, default=4,
                        help="Synthetic song boundaries; not real track durations")
    args = parser.parse_args()
    if not 1 <= args.steps <= 40:
        parser.error("--steps must be between 1 and 40")
    if not 1 <= args.spacing_minutes <= 30:
        parser.error("--spacing-minutes must be between 1 and 30")
    try:
        when = datetime.fromisoformat(args.at)
        if when.tzinfo is None:
            parser.error("--at must include a timezone offset")
        when = when.astimezone(LOCAL_TZ)
        root = args.media_root or Path(get_env_value(args.env, "MSR_MEDIA_ROOT"))
        simulate(root, args.database, when, args.steps, args.spacing_minutes)
        return 0
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        print(f"Simulation impossible : {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
