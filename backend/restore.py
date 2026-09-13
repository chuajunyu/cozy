"""Non-mutating, server-owned migration previews."""

import secrets

from backend.design import DesignError, require, validate_layout
from backend.placement import pose, settle_state
from backend.products import generated


def preview_restore(session, command):
    require(command.backup is not None, 'missing_backup', 'Supply a backup to preview.')
    require(session.state.revision == 0 and not session.state.slots, 'restore_conflict', 'Restore into a new empty session.')
    backup = command.backup.model_copy(deep=True)
    products = dict(session.products)
    for raw in backup.products:
        p = generated(raw.model_dump(exclude_none=True))
        require(p['id'] not in products, 'duplicate_product', 'Duplicate backup product ID.')
        products[p['id']] = p
    state = backup.state
    require(all(id == s.id for id,s in state.slots.items()), 'invalid_backup', 'Slot IDs must match their keys.')
    adjustments, blockers = [], []
    if backup.version == 2:
        adjustments += [{'text': 'Use windows and solar time in place of the former daylight slider.'}]
        if 'windows' not in state.room.model_fields_set:
            w = state.room.windows[0]
            w.width = min(w.width, state.room.depth - .4)
            w.height = min(w.height, state.room.height - w.sill - .1)
        if 'sunHour' not in state.room.model_fields_set:
            state.room.sunHour = 20 if state.room.daylight == 0 else 9
    if any(s.light for s in state.slots.values()):
        adjustments += [{'text': 'Fixture brightness uses fixed lumen output; on/off and supported colors are retained.'}]
    proposed = None
    try:
        # Calculate all changes, including locked changes, without accepting them.
        proposed = settle_state(state, state, products, migration=True, allow_locked=list(state.slots))
        validate_layout(proposed, products, check_budget=False)
        for id, s in proposed.slots.items():
            old = state.slots[id]
            if pose(old) != pose(s) or old.supportId != s.supportId:
                adjustments.append({'slotId': id, 'locked': old.locked and pose(old) != pose(s),
                    'text': f'{s.label}: base {old.elevation:.2f} m to {s.elevation:.2f} m; support {s.supportId or "floor/mount"}.',
                    'before': old.model_dump(), 'after': s.model_dump()})
    except DesignError as exc:
        proposed = None
        blockers.append(str(exc))
    preview_id = secrets.token_urlsafe(24)
    session.restore_previews.clear()
    session.restore_previews[preview_id] = {'state': proposed, 'backup': backup,
        'required': {a['slotId'] for a in adjustments if a.get('locked')}, 'revision': session.state.revision}
    return {'type': 'session.restore.preview', 'requestId': command.requestId, 'previewId': preview_id,
            'state': proposed.model_dump() if proposed else None, 'adjustments': adjustments, 'blockers': blockers}


def apply_preview(session, command):
    saved = session.restore_previews.get(command.previewId)
    require(saved is not None and saved['revision'] == session.state.revision, 'stale_preview', 'Preview this backup again.')
    require(saved['state'] is not None, 'invalid_backup', 'Resolve the preview blockers first.')
    require(saved['required'] <= set(command.allowLocked), 'locked', 'Explicitly select each locked adjustment before restoring.')
    backup = saved['backup'].model_copy(deep=True)
    backup.state = saved['state'].model_copy(deep=True)
    backup.version = 4
    return backup
