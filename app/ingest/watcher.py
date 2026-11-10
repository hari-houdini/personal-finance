"""Watch statements/ and rebuild reports/ whenever a statement appears or changes.

A file is only imported once its size has stopped changing, so a half-copied
statement is not read. Events are debounced, so a burst of copies triggers one rebuild.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from app.ingest.pipeline import STATEMENT_SUFFIXES

log = logging.getLogger("watcher")
SETTLE_SECONDS = 2.0


class _Handler(FileSystemEventHandler):
    def __init__(self, trigger: Callable[[], None]) -> None:
        self._trigger = trigger

    def _maybe(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        path = Path(getattr(event, "dest_path", "") or event.src_path)
        if path.suffix.lower() in STATEMENT_SUFFIXES and not path.name.startswith("."):
            self._trigger()

    def on_created(self, event: FileSystemEvent) -> None:
        self._maybe(event)

    def on_modified(self, event: FileSystemEvent) -> None:
        self._maybe(event)

    def on_moved(self, event: FileSystemEvent) -> None:
        self._maybe(event)


class Debouncer:
    """Run `action` once, after `delay` seconds of quiet, no matter how many triggers arrive."""

    def __init__(self, action: Callable[[], None], delay: float = SETTLE_SECONDS) -> None:
        self._action = action
        self._delay = delay
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def trigger(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._delay, self._action)
            self._timer.daemon = True
            self._timer.start()


def start_watching(statements_dir: Path, on_change: Callable[[], None]) -> Observer:
    """Start a background observer. Returns it so the caller can stop it."""
    debouncer = Debouncer(on_change)
    observer = Observer()
    observer.schedule(_Handler(debouncer.trigger), str(statements_dir), recursive=True)
    observer.start()
    log.info("watching %s", statements_dir)
    return observer


def wait_until_stable(path: Path, polls: int = 5, interval: float = 0.5) -> bool:
    """True once a file's size is unchanged across several polls (guards against partial copies)."""
    last = -1
    for _ in range(polls):
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size == last:
            return True
        last = size
        time.sleep(interval)
    return False
