import logging
import re

import structlog

# Client quote links carry their share token in the path: /api/v1/public/quotes/<token>[/...].
_SHARE_TOKEN_PATH = re.compile(r"(/api/v1/public/quotes/)[^/?#\s\"]+")
SHARE_TOKEN_REDACTED = r"\1[redacted]"
ACCESS_LOGGERS = ("uvicorn.access",)


def redact_share_tokens(value: str) -> str:
    return _SHARE_TOKEN_PATH.sub(SHARE_TOKEN_REDACTED, value)


class ShareTokenFilter(logging.Filter):
    """Redacts quote share tokens from access-log lines (uvicorn logs every request path)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_share_tokens(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(
                redact_share_tokens(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        elif isinstance(record.args, dict):
            record.args = {
                key: redact_share_tokens(arg) if isinstance(arg, str) else arg
                for key, arg in record.args.items()
            }
        return True


def configure_logging(level: str) -> None:
    logging.basicConfig(format="%(message)s", level=level)
    # httpx/httpcore INFO request logs include full URLs, which can carry keys and tokens.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    # Access logs print request paths, and a client quote link's path is its share token.
    for name in ACCESS_LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(f, ShareTokenFilter) for f in logger.filters):
            logger.addFilter(ShareTokenFilter())
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
    )
