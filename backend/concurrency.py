"""Rebase direct object edits only when their dependency group is unchanged."""

from backend.design import DesignState


def related(state: DesignState, target: str) -> set[str]:
    ids = {target}
    changed = True
    while changed:
        before = len(ids)
        for slot in state.slots.values():
            if slot.id in ids and slot.supportId:
                ids.add(slot.supportId)
            if slot.supportId in ids:
                ids.add(slot.id)
        changed = len(ids) != before
    return ids


def can_rebase(before: DesignState | None, current: DesignState, target: str | None) -> bool:
    if before is None or target is None or target not in before.slots or target not in current.slots:
        return False
    if before.room != current.room:
        return False
    ids = related(before, target) | related(current, target)
    return all(before.slots.get(id) == current.slots.get(id) for id in ids)
