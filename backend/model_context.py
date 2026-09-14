"""Compact model input without changing authoritative snapshots or saved rooms."""

import json


def compact_feedback(feedback: list[dict]) -> list[dict]:
    result = []
    manual = {}
    for entry in feedback:
        # Older backups used untyped, boilerplate manual entries. Typed chat
        # remains user feedback even if its text starts with the same phrase.
        if entry.get('type') == 'manual' or (
            not entry.get('type') and entry.get('text', '').startswith('Manual change:')
        ):
            key = tuple(entry.get('slotIds', []))
            manual[key] = {**entry, 'text': entry['text'].split('. Background activity', 1)[0]}
        else:
            result.append(entry)
    return [*result, *manual.values()]


def model_state(state: dict, *, exclude_request_ids: set[str] | None = None) -> dict:
    excluded = exclude_request_ids or set()
    return {k: (compact_feedback([f for f in value if f.get('requestId') not in excluded])
                if k == 'feedback' else value)
            for k, value in state.items() if k != 'undoCount'}


def model_json(value: dict) -> str:
    """Project every tool state too, including saved results replayed for steering."""
    if isinstance(value.get('state'), dict):
        value = {**value, 'state': model_state(value['state'])}
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)
