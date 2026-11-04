#!/usr/bin/env python3
"""Manu Stream Radio V9: library, boundary-aware scheduler and small HTTP API.

All permanent audio stays in MSR_MEDIA_ROOT; SQLite holds only metadata.
This service does not replace the production source until a separate cutover.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
import random
import re
import sqlite3
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import urlopen
from zoneinfo import ZoneInfo

# Preserve the actual Windows Studio/Remote directory names, including accents.
# Values are internal categories used by the scheduler and DB.
KINDS = {
    "Best Of": "bestof",
    "Chroniques": "chronicles",
    "Effets": "effects",
    "Emissions": "shows",
    "Fonds d'antenne": "beds",
    "Infos": "infos",
    "Jingles": "jingles",
    "Musique": "music",
    "Météo": "weather",
    "Pubs": "ads",
}
EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}
LOCAL_TZ = ZoneInfo("Europe/Paris")
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
MAX_BODY = 262_144
MAX_UPLOAD = int(os.environ.get("MSR_MAX_UPLOAD_BYTES", str(1024 * 1024 * 1024)))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_media_path(root: Path, relative: str) -> Path:
    if not isinstance(relative, str):
        raise ValueError("Chemin de fichier invalide")
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts or len(rel.parts) < 2:
        raise ValueError("Chemin de fichier invalide")
    if rel.parts[0] not in KINDS or rel.suffix.lower() not in EXTENSIONS:
        raise ValueError("Type de média non autorisé")
    target = (root / rel).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Chemin hors de la bibliothèque")
    return target


def safe_folder_path(root: Path, relative: str) -> Path:
    """Resolve a real user-visible folder under one of the Studio categories."""
    if not isinstance(relative, str) or not relative:
        raise ValueError("Choisir un dossier parent")
    if "\\" in relative:
        raise ValueError("Utiliser / pour les sous-dossiers")
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts or rel.parts[0] not in KINDS:
        raise ValueError("Dossier hors de la médiathèque")
    if any(not part or part.startswith(".") or any(c in part for c in '<>:"|?*\\\x00') for part in rel.parts):
        raise ValueError("Nom de dossier non autorisé")
    resolved = (root / rel).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("Dossier hors de la médiathèque")
    return resolved


def validate_folder_name(name: str) -> str:
    if not isinstance(name, str) or name != name.strip() or not 1 <= len(name) <= 120:
        raise ValueError("Le nom doit comporter entre 1 et 120 caractères, sans espaces en bordure")
    if name in (".", "..") or name.startswith(".") or name.endswith("."):
        raise ValueError("Nom de dossier non autorisé")
    if any(c in name for c in '/\\<>:"|?*\x00') or any(ord(c) < 32 for c in name):
        raise ValueError("Caractère interdit dans le nom du dossier")
    return name


class Station:
    def __init__(self, media_root: Path, database: Path):
        self.root = media_root.resolve()
        self.database = database.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def db(self):
        conn = sqlite3.connect(self.database, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS media (
                    path TEXT PRIMARY KEY, kind TEXT NOT NULL,
                    size INTEGER NOT NULL, modified_ns INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS rules (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, media_path TEXT NOT NULL,
                    local_time TEXT NOT NULL, weekdays TEXT NOT NULL,
                    single_date TEXT, enabled INTEGER NOT NULL DEFAULT 1,
                    grace_minutes INTEGER NOT NULL DEFAULT 90
                );
                CREATE TABLE IF NOT EXISTS runs (
                    rule_id TEXT NOT NULL, occurrence TEXT NOT NULL,
                    played_utc TEXT NOT NULL, PRIMARY KEY(rule_id, occurrence)
                );
                CREATE TABLE IF NOT EXISTS state (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
                    category TEXT NOT NULL, selected_utc TEXT NOT NULL
                );
            """)

    def scan(self):
        found = []
        for category, kind in KINDS.items():
            folder = self.root / category
            folder.mkdir(parents=True, exist_ok=True)
            for item in folder.rglob("*"):
                if not item.is_file() or item.is_symlink() or item.suffix.lower() not in EXTENSIONS:
                    continue
                if any(part.startswith(".") for part in item.relative_to(self.root).parts):
                    continue
                try:
                    resolved = safe_media_path(self.root, item.relative_to(self.root).as_posix())
                    stat = resolved.stat()
                except (OSError, ValueError):
                    continue
                found.append((item.relative_to(self.root).as_posix(), kind, stat.st_size, stat.st_mtime_ns))
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            for entry in found:
                db.execute("""INSERT INTO media(path,kind,size,modified_ns) VALUES(?,?,?,?)
                    ON CONFLICT(path) DO UPDATE SET size=excluded.size,
                    kind=excluded.kind, modified_ns=excluded.modified_ns""", entry)
            present = {entry[0] for entry in found}
            for row in db.execute("SELECT path FROM media").fetchall():
                if row["path"] not in present:
                    db.execute("DELETE FROM media WHERE path=?", (row["path"],))
            db.commit()
        return {"indexed": len(found)}

    @staticmethod
    def _get(db, key: str, default: str = "") -> str:
        row = db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    @staticmethod
    def _put(db, key: str, value: str):
        db.execute("""INSERT INTO state(key,value) VALUES(?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value""", (key, value))

    def folder_list(self):
        """Current folder tree, including new subfolders created by operators."""
        folders = []
        for category in KINDS:
            base = self.root / category
            if not base.is_dir() or base.is_symlink():
                continue
            folders.append(category)
            for folder in base.rglob("*"):
                if not folder.is_dir() or folder.is_symlink():
                    continue
                rel = folder.relative_to(self.root).as_posix()
                if any(part.startswith(".") for part in folder.relative_to(self.root).parts):
                    continue
                try:
                    safe_folder_path(self.root, rel)
                except ValueError:
                    continue
                folders.append(rel)
        return sorted(folders, key=str.casefold)

    def create_folder(self, parent: str, name: str):
        name = validate_folder_name(name)
        parent_path = safe_folder_path(self.root, parent)
        if not parent_path.is_dir() or parent_path.is_symlink():
            raise ValueError("Le dossier parent n'existe pas")
        target = safe_folder_path(self.root, (Path(parent) / name).as_posix())
        if target.exists():
            raise FileExistsError("Ce dossier existe déjà")
        target.mkdir(exist_ok=False)
        return target.relative_to(self.root).as_posix()

    def media_list(self):
        with self.db() as db:
            return [dict(r) for r in db.execute("SELECT path,kind,size FROM media ORDER BY kind,path")]

    def rules_list(self):
        with self.db() as db:
            return [self._serialize_rule(r) for r in db.execute("SELECT * FROM rules ORDER BY local_time,title")]

    @staticmethod
    def _serialize_rule(row):
        rule = dict(row)
        rule["weekdays"] = json.loads(rule.pop("weekdays"))
        rule["enabled"] = bool(rule["enabled"])
        return rule

    def add_rule(self, payload):
        title = str(payload.get("title", "")).strip()[:120]
        path = str(payload.get("media_path", "")).strip()
        hour = str(payload.get("local_time", "")).strip()
        weekdays = payload.get("weekdays", list(range(7)))
        day = payload.get("single_date") or None
        grace = payload.get("grace_minutes", 90)
        if not title or not TIME_RE.fullmatch(hour):
            raise ValueError("Titre et heure HH:MM obligatoires")
        safe_media_path(self.root, path)
        if not isinstance(weekdays, list) or not weekdays or any(type(x) is not int or x not in range(7) for x in weekdays):
            raise ValueError("weekdays : jours de 0 (lundi) à 6 (dimanche)")
        if day:
            try:
                parsed = datetime.strptime(day, "%Y-%m-%d").date()
                if parsed.isoformat() != day:
                    raise ValueError()
            except ValueError:
                raise ValueError("single_date doit être AAAA-MM-JJ")
        if type(grace) is not int or not 1 <= grace <= 240:
            raise ValueError("grace_minutes doit être compris entre 1 et 240")
        with self.db() as db:
            exists = db.execute("SELECT 1 FROM media WHERE path=?", (path,)).fetchone()
            if not exists or not safe_media_path(self.root, path).is_file():
                raise ValueError("Média absent : lancer une analyse de bibliothèque")
            ident = uuid.uuid4().hex
            db.execute("""INSERT INTO rules
                (id,title,media_path,local_time,weekdays,single_date,enabled,grace_minutes)
                VALUES(?,?,?,?,?,?,1,?)""",
                (ident, title, path, hour, json.dumps(sorted(set(weekdays))), day, grace))
        return ident

    def delete_rule(self, ident):
        with self.db() as db:
            db.execute("DELETE FROM rules WHERE id=?", (ident,))
            return db.total_changes > 0

    @staticmethod
    def _due_rows(db, now):
        candidates = []
        for rule in db.execute("SELECT * FROM rules WHERE enabled=1").fetchall():
            t = now.replace(hour=int(rule["local_time"][:2]),
                            minute=int(rule["local_time"][3:]), second=0, microsecond=0)
            if rule["single_date"] and t.date().isoformat() != rule["single_date"]:
                continue
            if not rule["single_date"] and t.weekday() not in json.loads(rule["weekdays"]):
                continue
            delta = (now - t).total_seconds()
            if not 0 <= delta <= rule["grace_minutes"] * 60:
                continue
            occurrence = t.strftime("%Y-%m-%dT%H:%M")
            if db.execute("SELECT 1 FROM runs WHERE rule_id=? AND occurrence=?",
                          (rule["id"], occurrence)).fetchone():
                continue
            candidates.append((t, dict(rule), occurrence))
        return sorted(candidates, key=lambda item: (item[0], item[1]["id"]))

    def _choose(self, db, kind):
        rows = [r["path"] for r in db.execute(
            "SELECT path FROM media WHERE kind=? ORDER BY path", (kind,)).fetchall()
            if (kind != "jingles" or r["path"].startswith("Jingles/Général/"))
            and safe_media_path(self.root, r["path"]).is_file()]
        if not rows:
            return None
        last = [r["path"] for r in db.execute(
            "SELECT path FROM history WHERE category=? ORDER BY id DESC LIMIT 5", (kind,))]
        pool = [p for p in rows if p not in last]
        return random.choice(pool or rows)

    def _record(self, db, relative, kind, title=None):
        now = utc_now()
        self._put(db, "now", json.dumps({
            "title": title or Path(relative).stem, "media_path": relative,
            "category": kind, "selected_at": now
        }, ensure_ascii=False))
        db.execute("INSERT INTO history(path,category,selected_utc) VALUES(?,?,?)", (relative, kind, now))
        db.execute("""DELETE FROM history WHERE id NOT IN
            (SELECT id FROM history ORDER BY id DESC LIMIT 300)""")
        self._put(db, "last_request_utc", now)
        return str(safe_media_path(self.root, relative))

    def next_media(self, now=None):
        """Called by Liquidsoap at the END of a track, never from a clock timer."""
        now = (now or datetime.now(LOCAL_TZ)).astimezone(LOCAL_TZ)
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            pending_raw = self._get(db, "pending_rule")
            if pending_raw:
                pending = json.loads(pending_raw)
                self._put(db, "pending_rule", "")
                db.execute("""INSERT OR IGNORE INTO runs(rule_id,occurrence,played_utc)
                    VALUES(?,?,?)""", (pending["id"], pending["occurrence"], utc_now()))
                rel = pending["media_path"]
                if safe_media_path(self.root, rel).is_file():
                    result = self._record(db, rel, "scheduled", pending["title"])
                    db.commit()
                    return result
            due = self._due_rows(db, now)
            if due:
                _, rule, occurrence = due[0]
                rel = rule["media_path"]
                if safe_media_path(self.root, rel).is_file():
                    ident = {"id": rule["id"], "occurrence": occurrence,
                             "media_path": rel, "title": rule["title"]}
                    intro = self._choose(db, "jingles")
                    if intro:
                        self._put(db, "pending_rule", json.dumps(ident))
                        result = self._record(db, intro, "jingles")
                        db.commit()
                        return result
                    db.execute("""INSERT OR IGNORE INTO runs(rule_id,occurrence,played_utc)
                        VALUES(?,?,?)""", (rule["id"], occurrence, utc_now()))
                    result = self._record(db, rel, "scheduled", rule["title"])
                    db.commit()
                    return result
            count = int(self._get(db, "songs_since_jingle", "0"))
            jingle = self._choose(db, "jingles") if count >= 3 else None
            if jingle:
                self._put(db, "songs_since_jingle", "0")
                result = self._record(db, jingle, "jingles")
            else:
                track = self._choose(db, "music")
                if track:
                    self._put(db, "songs_since_jingle", str(count + 1))
                    result = self._record(db, track, "music")
                else:
                    result = ""
            db.commit()
            return result

    def upcoming(self, count=12):
        now = datetime.now(LOCAL_TZ)
        output = []
        rules = self.rules_list()
        for offset in range(8):
            day = (now + timedelta(days=offset)).date()
            for rule in rules:
                if not rule["enabled"]:
                    continue
                if rule["single_date"]:
                    if rule["single_date"] != day.isoformat():
                        continue
                elif day.weekday() not in rule["weekdays"]:
                    continue
                hh, mm = map(int, rule["local_time"].split(":"))
                occurrence = datetime(day.year, day.month, day.day, hh, mm, tzinfo=LOCAL_TZ)
                if occurrence >= now:
                    output.append({"id": rule["id"], "title": rule["title"],
                                   "starts_at": occurrence.isoformat(),
                                   "media_path": rule["media_path"]})
        return sorted(output, key=lambda x: x["starts_at"])[:count]

    def status(self):
        with self.db() as db:
            raw = self._get(db, "now", "{}")
        return {"station": "Manu Stream Radio", "mode": "automation",
                "selected": json.loads(raw), "next": self.upcoming(1),
                "updated_at": utc_now()}


def icecast_online():
    url = os.environ.get("MSR_ICECAST_STATUS_URL", "").strip()
    mount = os.environ.get("MSR_ICECAST_MOUNT", "/manustream-v9-test")
    if not url:
        return None  # Do not guess availability when monitoring is not configured.
    try:
        with urlopen(url, timeout=1.5) as response:
            data = json.load(response)
        sources = data.get("icestats", {}).get("source", [])
        if isinstance(sources, dict):
            sources = [sources]
        return any(str(s.get("listenurl", "")).split("?")[0].endswith(mount) for s in sources)
    except (OSError, ValueError, KeyError):
        return None


class API(BaseHTTPRequestHandler):
    server_version = "MSR-V9/0.1"

    def respond(self, status, data, content_type="application/json; charset=utf-8"):
        raw = (json.dumps(data, ensure_ascii=False).encode("utf-8")
               if isinstance(data, (dict, list)) else data)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        allowed = {item.strip() for item in os.environ.get(
            "MSR_PUBLIC_ORIGIN",
            "https://cauctomanu-dotcom.github.io,https://manustreamradio.duckdns.org"
        ).split(",") if item.strip()}
        if self.headers.get("Origin") in allowed:
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin"))
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(raw)

    @property
    def station(self):
        return self.server.station

    def authorized(self):
        token = os.environ.get("MSR_ADMIN_TOKEN", "")
        given = self.headers.get("Authorization", "")
        return bool(token) and hmac.compare_digest(given, "Bearer " + token)

    def json_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > MAX_BODY:
            raise ValueError("Taille de requête invalide")
        data = json.loads(self.rfile.read(size))
        if not isinstance(data, dict):
            raise ValueError("Objet JSON attendu")
        return data

    def do_OPTIONS(self):
        allowed = {item.strip() for item in os.environ.get(
            "MSR_PUBLIC_ORIGIN",
            "https://cauctomanu-dotcom.github.io,https://manustreamradio.duckdns.org"
        ).split(",") if item.strip()}
        self.send_response(204)
        if self.headers.get("Origin") in allowed:
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin"))
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        route = urlparse(self.path).path
        try:
            if route == "/api/public/status":
                return self.respond(200, {**self.station.status(), "online": icecast_online()})
            if route == "/api/public/schedule":
                return self.respond(200, {"upcoming": self.station.upcoming(24)})
            if route in ("/admin", "/admin/"):
                page = (Path(__file__).parent / "admin.html").read_bytes()
                return self.respond(200, page, "text/html; charset=utf-8")
            if not self.authorized():
                return self.respond(401, {"error": "Accès réservé"})
            if route == "/api/admin/state":
                return self.respond(200, {"status": self.station.status(),
                                          "rules": self.station.rules_list(),
                                          "media": self.station.media_list(),
                                          "folders": self.station.folder_list()})
            return self.respond(404, {"error": "Introuvable"})
        except Exception as err:
            return self.respond(500, {"error": type(err).__name__})

    def do_POST(self):
        route = urlparse(self.path).path
        if not self.authorized():
            return self.respond(401, {"error": "Accès réservé"})
        try:
            if route == "/api/admin/scan":
                return self.respond(200, self.station.scan())
            if route == "/api/admin/folders":
                payload = self.json_body()
                created = self.station.create_folder(payload.get("parent"), payload.get("name"))
                return self.respond(201, {"path": created})
            if route == "/api/admin/rules":
                ident = self.station.add_rule(self.json_body())
                return self.respond(201, {"id": ident})
            return self.respond(404, {"error": "Introuvable"})
        except FileExistsError as err:
            return self.respond(409, {"error": str(err)})
        except (ValueError, json.JSONDecodeError) as err:
            return self.respond(400, {"error": str(err)})
        except Exception as err:
            return self.respond(500, {"error": type(err).__name__})

    def do_DELETE(self):
        if not self.authorized():
            return self.respond(401, {"error": "Accès réservé"})
        route = urlparse(self.path).path
        if route.startswith("/api/admin/rules/"):
            ident = route.rsplit("/", 1)[-1]
            if re.fullmatch(r"[0-9a-f]{32}", ident) and self.station.delete_rule(ident):
                return self.respond(200, {"deleted": ident})
        return self.respond(404, {"error": "Introuvable"})

    def do_PUT(self):
        if not self.authorized():
            return self.respond(401, {"error": "Accès réservé"})
        route = urlparse(self.path).path
        prefix = "/api/admin/media/"
        if not route.startswith(prefix):
            return self.respond(404, {"error": "Introuvable"})
        file_part = unquote(route[len(prefix):])
        try:
            target = safe_media_path(self.station.root, file_part)
            parent = target.parent
            parent_rel = parent.relative_to(self.station.root).as_posix()
            safe_folder_path(self.station.root, parent_rel)
            if not parent.is_dir() or parent.is_symlink():
                raise ValueError("Créez d'abord le dossier de destination")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_UPLOAD:
                raise ValueError("Fichier vide ou dépassement de la taille autorisée")
            if target.exists():
                return self.respond(409, {"error": "Un fichier porte déjà ce nom"})
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb", dir=target.parent, prefix=".upload-", delete=False
                ) as stream:
                    temporary = Path(stream.name)
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise ValueError("Transfert interrompu")
                        stream.write(chunk)
                        remaining -= len(chunk)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.link(temporary, target)  # atomic, never overwrite existing media
                self.station.scan()
                return self.respond(201, {"saved": file_part, "bytes": length})
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
        except FileExistsError:
            return self.respond(409, {"error": "Fichier déjà présent"})
        except (ValueError, OSError) as err:
            return self.respond(400 if isinstance(err, ValueError) else 507,
                                {"error": str(err)})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve", "scan", "next", "status"])
    args = parser.parse_args()
    root = Path(os.environ.get("MSR_MEDIA_ROOT", "/srv/msr-v9-media"))
    # Fail closed: do not fill the VM's small system disk if Freebox SMB vanishes.
    if os.environ.get("MSR_REQUIRE_MEDIA_MOUNT", "1") == "1":
        required_mount = Path(os.environ.get("MSR_MOUNT_CHECK_PATH", str(root)))
        if not os.path.ismount(required_mount):
            raise SystemExit("Partage média 2 To non monté : " + str(required_mount))
    station = Station(root, Path(os.environ.get(
        "MSR_DB_PATH", "/var/lib/msr-v9/station.sqlite3")))
    if args.command == "scan":
        print(json.dumps(station.scan(), ensure_ascii=False))
    elif args.command == "next":
        print(station.next_media(), flush=True)
    elif args.command == "status":
        print(json.dumps(station.status(), ensure_ascii=False))
    else:
        host = os.environ.get("MSR_BIND", "127.0.0.1")
        port = int(os.environ.get("MSR_PORT", "17600"))
        server = ThreadingHTTPServer((host, port), API)
        server.station = station
        print("MSR V9 API ready on %s:%s" % (host, port), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
