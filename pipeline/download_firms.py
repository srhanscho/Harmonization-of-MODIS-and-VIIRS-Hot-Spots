"""Download historical FIRMS active-fire CSVs through the FIRMS area API.

    python download_firms.py --start 2000-11-01 --end 2026-11-13 --countries CO,AR \
        --sources MODIS,VIIRS_SNPP,VIIRS_NOAA20

Endpoint: /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{day_range 1-5}/{YYYY-MM-DD}
Families are expanded to the standard (SP) source for dates inside its archive and to the NRT
source only for later dates (ranges come from /api/data_availability/csv/{MAP_KEY}/ALL).

Files are written to data/raw/{source}/{country}/{start}_{days}d.csv. Existing files are skipped,
so the script is resumable. The MAP_KEY is read from env FIRMS_MAP_KEY or pipeline/.env and is
never printed.
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

import config as C

log = logging.getLogger("download_firms")

BASE = "https://firms.modaps.eosdis.nasa.gov"
FAMILIES = {
    "MODIS": ("MODIS_SP", "MODIS_NRT"),
    "VIIRS_SNPP": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "VIIRS_NOAA20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
}
CHUNK_DAYS = 5
MIN_INTERVAL_S = 0.4  # <= 1500 requests / 10 min, far below the 5000 transaction limit
TX_SOFT_LIMIT = 4000  # pause when the key's current transactions exceed this (large bboxes cost several each)
MAX_RETRIES = 6


class FirmsKeyError(RuntimeError):
    pass


def get_key() -> str | None:
    try:
        from dotenv import load_dotenv

        load_dotenv(C.PIPELINE_DIR / ".env")
    except ImportError:
        pass
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    return key or None


class Client:
    def __init__(self, key: str):
        self._key = key
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "fire-harmonization-pipeline"
        self._last = 0.0
        self.n_requests = 0

    def _redact(self, text: str) -> str:
        return text.replace(self._key, "***")

    def _throttle(self) -> None:
        wait = MIN_INTERVAL_S - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get_text(self, path: str, timeout: float = 90) -> str:
        """GET BASE+path (path may contain the key) with retries/backoff; never logs the key."""
        url = BASE + path
        for attempt in range(1, MAX_RETRIES + 1):
            self._throttle()
            try:
                r = self.session.get(url, timeout=timeout)
                self.n_requests += 1
            except requests.RequestException as e:
                msg = self._redact(f"{type(e).__name__}: {e}")
                self._backoff(attempt, msg)
                continue
            body = r.text
            if r.status_code >= 500 or r.status_code == 429:
                self._backoff(attempt, f"HTTP {r.status_code}")
                continue
            low = body[:300].lower()
            if ("invalid" in low and "key" in low) or ("exceed" in low and "transaction" in low):
                # FIRMS answers "invalid key"-style messages when the transaction budget is spent.
                tx = self.current_transactions()
                if tx is None or tx < TX_SOFT_LIMIT:
                    raise FirmsKeyError("FIRMS rejected the MAP_KEY (invalid key)")
                log.warning("Transaction budget exhausted (%d used); waiting for the window to reset", tx)
                self.wait_for_budget()
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"HTTP {r.status_code}: {self._redact(body[:200])}")
            return body
        raise RuntimeError(f"Giving up after {MAX_RETRIES} attempts")

    @staticmethod
    def _backoff(attempt: int, msg: str) -> None:
        delay = min(300, 5 * 2 ** (attempt - 1))
        log.warning("Request failed (%s), attempt %d/%d, retrying in %ds", msg, attempt, MAX_RETRIES, delay)
        time.sleep(delay)

    def wait_for_budget(self) -> None:
        """Block until the key's transactions in the current window drop below TX_SOFT_LIMIT."""
        while True:
            tx = self.current_transactions()
            if tx is None or tx < TX_SOFT_LIMIT:
                return
            log.info("Key has %d transactions in the current 10-minute window; pausing 60s", tx)
            time.sleep(60)

    def current_transactions(self) -> int | None:
        try:
            r = self.session.get(f"{BASE}/mapserver/mapkey_status/", params={"MAP_KEY": self._key}, timeout=30)
            return int(r.json().get("current_transactions"))
        except Exception:  # best effort only
            return None

    def availability(self) -> dict[str, tuple[date, date]]:
        import csv

        text = self.get_text(f"/api/data_availability/csv/{self._key}/ALL")
        out = {}
        for row in csv.DictReader(io.StringIO(text)):
            try:
                out[row["data_id"].strip()] = (date.fromisoformat(row["min_date"].strip()), date.fromisoformat(row["max_date"].strip()))
            except (KeyError, ValueError):
                continue
        return out

    def area_csv(self, source: str, bbox: list[float], days: int, start: date) -> str:
        area = ",".join(f"{v:g}" for v in bbox)
        return self.get_text(f"/api/area/csv/{self._key}/{source}/{area}/{days}/{start.isoformat()}")


def plan_chunks(start: date, end: date, ranges: list[tuple[str, date, date]]) -> list[tuple[str, date, int]]:
    """Split [start, end] into <=5-day chunks per source, restricted to each source's date range.

    `ranges` is an ordered list of (source, min_date, max_date); a later source only covers dates
    after the previous source's max date (SP first, then NRT).
    """
    chunks = []
    covered_until = start - timedelta(days=1)
    for source, lo, hi in ranges:
        s = max(start, lo, covered_until + timedelta(days=1))
        e = min(end, hi)
        d = s
        while d <= e:
            n = min(CHUNK_DAYS, (e - d).days + 1)
            chunks.append((source, d, n))
            d += timedelta(days=n)
        if e >= s:
            covered_until = e
    return chunks


ALL_SOURCES = {s for pair in FAMILIES.values() for s in pair}


def source_ranges(family: str, avail: dict[str, tuple[date, date]]) -> list[tuple[str, date, date]]:
    """Ranges for a family (SP then NRT) or for one explicit source name such as MODIS_SP."""
    if family in ALL_SOURCES:
        return [(family, *avail.get(family, (date(2000, 11, 1), date.today())))]
    sp, nrt = FAMILIES[family]
    out = []
    if sp in avail:
        out.append((sp, *avail[sp]))
    if nrt in avail:
        out.append((nrt, *avail[nrt]))
    if not out:  # availability unknown: try SP over everything
        out.append((sp, date(2000, 11, 1), date.today()))
    return out


def chunk_path(source: str, country: str, start: date, days: int) -> Path:
    return C.RAW_DIR / source / country / f"{start.isoformat()}_{days}d.csv"


def run(start: date, end: date, countries: list[str], families: list[str], dry_run: bool = False) -> int:
    key = get_key()
    if not key:
        log.error("FIRMS_MAP_KEY is not set (env var or pipeline/.env). Get one at https://firms.modaps.eosdis.nasa.gov/api/map_key/")
        return 2
    client = Client(key)
    try:
        avail = client.availability()
        log.info("Data availability: %s", {k: (str(v[0]), str(v[1])) for k, v in avail.items() if any(k.startswith(f) for f in ("MODIS", "VIIRS_SNPP", "VIIRS_NOAA20"))})
    except FirmsKeyError as e:
        log.error(str(e))
        return 2
    except Exception as e:  # keep going with defaults
        log.warning("Could not read data availability (%s); using SP for the whole range", e)
        avail = {}

    jobs = []
    for country in countries:
        bbox = C.COUNTRY_BBOXES[country]
        for fam in families:
            for source, d, n in plan_chunks(start, end, source_ranges(fam, avail)):
                jobs.append((country, bbox, source, d, n))
    todo = [j for j in jobs if not chunk_path(j[2], j[0], j[3], j[4]).exists()]
    log.info("%d chunks planned, %d already downloaded, %d to fetch", len(jobs), len(jobs) - len(todo), len(todo))
    if dry_run:
        return 0

    failures = 0
    t0 = time.monotonic()
    for i, (country, bbox, source, d, n) in enumerate(todo, 1):
        if i % 10 == 0:
            client.wait_for_budget()
        path = chunk_path(source, country, d, n)
        try:
            text = client.area_csv(source, bbox, n, d)
        except FirmsKeyError as e:
            log.error(str(e))
            return 2
        except Exception as e:
            failures += 1
            log.error("Chunk %s %s %s failed: %s", source, country, d, e)
            continue
        if not text.lstrip().lower().startswith("latitude"):
            failures += 1
            log.error("Chunk %s %s %s: unexpected response (%s...)", source, country, d, client._redact(text[:80]).strip())
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
        if i % 25 == 0 or i == len(todo):
            rate = i / max(1e-6, time.monotonic() - t0)
            eta = (len(todo) - i) / rate / 60 if rate else 0
            log.info("[%d/%d] %s %s %s (%d rows) ~%.0f min left", i, len(todo), source, country, d, text.count("\n") - 1, eta)
    log.info("Done. %d requests, %d failed chunks (re-run to retry them)", client.n_requests, failures)
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2000-11-01", type=date.fromisoformat)
    ap.add_argument("--end", default=(date.today() - timedelta(days=1)).isoformat(), type=date.fromisoformat)
    ap.add_argument("--countries", default="CO,AR")
    ap.add_argument("--sources", default="MODIS,VIIRS_SNPP,VIIRS_NOAA20", help="families (" + ",".join(FAMILIES) + ") or explicit sources such as MODIS_SP")
    ap.add_argument("--dry-run", action="store_true", help="only print the plan")
    args = ap.parse_args(argv)
    countries = [c.strip().upper() for c in args.countries.split(",") if c.strip()]
    families = [s.strip().upper() for s in args.sources.split(",") if s.strip()]
    for c in countries:
        if c not in C.COUNTRY_BBOXES:
            ap.error(f"unknown country {c}; configure it in config.COUNTRY_BBOXES")
    for f in families:
        if f not in FAMILIES and f not in ALL_SOURCES:
            ap.error(f"unknown source {f}; choose families {list(FAMILIES)} or sources {sorted(ALL_SOURCES)}")
    return run(args.start, args.end, countries, families, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
