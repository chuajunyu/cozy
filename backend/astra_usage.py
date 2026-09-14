"""Local, bounded token accounting; never log prompts, tool arguments or secrets."""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path


def record_usage(record: dict) -> None:
    logger = logging.getLogger('cozy.astra.usage')
    if not logger.handlers:
        try:
            path = Path(os.getenv('COZY_ASTRA_USAGE_LOG', str(Path(__file__).resolve().parents[1] / 'logs' / 'astra-usage.jsonl')))
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = RotatingFileHandler(path, maxBytes=5_000_000, backupCount=2, encoding='utf-8')
            handler.setFormatter(logging.Formatter('%(message)s'))
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)
            logger.propagate = False
        except OSError:
            logging.getLogger(__name__).warning('Astra usage log unavailable; token accounting could not be persisted')
            return
    logger.info(json.dumps({'timestamp': datetime.now(timezone.utc).isoformat(), **record}, separators=(',', ':')))


def session_label(session_id: str) -> str:
    # The actual session ID is a bearer credential, not a log correlation ID.
    return hashlib.sha256(session_id.encode()).hexdigest()[:16]


def token_usage(response: dict) -> dict:
    usage = response.get('usage') or {}
    inputs = usage.get('input_tokens_details') or {}
    outputs = usage.get('output_tokens_details') or {}
    fields = {'input_tokens': usage.get('input_tokens'), 'cached_tokens': inputs.get('cached_tokens'),
              'cache_write_tokens': inputs.get('cache_write_tokens'), 'output_tokens': usage.get('output_tokens'),
              'reasoning_tokens': outputs.get('reasoning_tokens'), 'total_tokens': usage.get('total_tokens')}
    # Missing usage is unknown, never zero. Reasoning is a subset of output.
    return {k: v if type(v) is int and v >= 0 else None for k, v in fields.items()}
