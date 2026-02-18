"""Structured JSON logging with request ID context."""

import json
import logging
import sys
import threading
import time

_request_id = threading.local()


def set_request_id(rid: str):
    _request_id.value = rid


def get_request_id() -> str:
    return getattr(_request_id, "value", "-")


class JSONFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": get_request_id(),
        }
        # Add extra kwargs
        for k, v in getattr(record, "_extra", {}).items():
            entry[k] = v
        if record.exc_info and record.exc_info[0]:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


class StructuredLogger:
    def __init__(self, name: str):
        self._logger = logging.getLogger(name)
        if not self._logger.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(JSONFormatter())
            self._logger.addHandler(handler)
            self._logger.setLevel(logging.INFO)
            self._logger.propagate = False

    def _log(self, level, msg, **kwargs):
        record = self._logger.makeRecord(
            self._logger.name, level, "(unknown)", 0, msg, (), None
        )
        record._extra = kwargs
        self._logger.handle(record)

    def info(self, msg, **kw): self._log(logging.INFO, msg, **kw)
    def warning(self, msg, **kw): self._log(logging.WARNING, msg, **kw)
    def error(self, msg, **kw): self._log(logging.ERROR, msg, **kw)
    def debug(self, msg, **kw): self._log(logging.DEBUG, msg, **kw)


def get_logger(name: str) -> StructuredLogger:
    return StructuredLogger(name)
