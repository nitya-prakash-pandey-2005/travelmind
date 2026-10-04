"""gunicorn settings for the production-like stack (deploy/docker-compose.yml).

    gunicorn 'travelmind.main:create_app()' -k uvicorn_worker.UvicornWorker -c gunicorn.conf.py

Connection pool math (keep both inequalities true when changing any number):

    api replicas x workers x (TM_DB_POOL_SIZE + TM_DB_MAX_OVERFLOW)  (+ the arq worker's pool)
        <= PgBouncer MAX_CLIENT_CONN
    PgBouncer DEFAULT_POOL_SIZE per (database, user) pool (app + owner)
        <= Postgres max_connections - headroom (superuser slots, migrations, admin sessions)

    Defaults: 2 replicas x 8 workers x (10 + 5) = 240 client connections (+15 for the worker)
    <= 2000, multiplexed onto at most 40 server connections for travelmind_app (+ at most 40
    for travelmind_owner) <= 200 - headroom.

The app connects to PgBouncer, which runs in transaction mode, so a client connection only holds
a server connection for the length of a transaction.
"""

import multiprocessing
import os
import shutil
from pathlib import Path
from typing import Any


def _default_workers() -> int:
    return min(2 * multiprocessing.cpu_count() + 1, 8)


workers = int(os.environ.get("WEB_CONCURRENCY") or _default_workers())
bind = "0.0.0.0:8000"
keepalive = 5  # nginx's upstream keepalive_timeout is shorter, so nginx closes idle sockets first
graceful_timeout = 20
timeout = 60  # searches are capped at 25 s by the app; this only catches a stuck worker

# Trust X-Forwarded-For / X-Forwarded-Proto from any peer. This is safe here because the api is
# not published on the host: only nginx can reach it on the compose network, and nginx overwrites
# X-Forwarded-For with the connecting address ($remote_addr) rather than appending to whatever the
# client sent. UvicornWorker passes this to uvicorn's proxy-header handling, so request.client.host
# (used by the per-IP login, signup, demo and public-quote limits) is the visitor's address.
# Narrow it (e.g. to nginx's subnet) if the api is ever reachable by anything else.
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "*")

# Request logging is the app's own structured `request` line (route templates, no share tokens).
accesslog = None
errorlog = "-"

# Worker heartbeat files on tmpfs: a slow container filesystem can't make gunicorn kill workers.
if os.path.isdir("/dev/shm"):
    worker_tmp_dir = "/dev/shm"

# No runtime control socket: nothing in the stack uses it.
control_socket_disable = True


def on_starting(server: Any) -> None:
    """prometheus_client multiprocess mode needs an existing, empty directory at startup."""
    directory = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if not directory:
        return
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    for entry in path.iterdir():  # leftovers from a previous run would skew the counters
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()


def child_exit(server: Any, worker: Any) -> None:
    """Drop a dead worker's live gauges (livesum/mostrecent) from the merged metrics."""
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        from prometheus_client import multiprocess

        multiprocess.mark_process_dead(worker.pid)
