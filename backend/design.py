"""Authoritative scene validation. Mutations are atomic and contain no network I/O."""

from copy import deepcopy
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.catalog import BY_ID


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Room(Model):
    width: float = Field(default=4, ge=2, le=12)
    depth: float = Field(default=3.5, ge=2, le=12)
    height: float = Field(default=2.6, ge=2, le=5)


class SlotPlan(Model):
    id: str = Field(min_length=1, max_length=60, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=80)
    category: str
    zone: str = Field(min_length=1, max_length=60)
    group: str = Field(min_length=1, max_length=60)
    anchor: bool = False


class Slot(SlotPlan):
    catalogId: str | None = None
    x: float = 0
    z: float = 0
    rotation: Literal[0, 90, 180, 270] = 0
    locked: bool = False
    liked: bool = False
    replacing: bool = False
    explanation: str = ""


class Concept(Model):
    title: str = Field(default="Your room, taking shape", max_length=100)
    summary: str = Field(default="", max_length=2000)
    palette: list[str] = Field(default_factory=list, max_length=8)
    materials: list[str] = Field(default_factory=list, max_length=8)


class DesignState(Model):
    revision: int = 0
    room: Room = Field(default_factory=Room)
    brief: str = ""
    budget: float | None = Field(default=None, gt=0, le=1_000_000)
    concept: Concept = Field(default_factory=Concept)
    slots: dict[str, Slot] = Field(default_factory=dict)
    feedback: list[dict] = Field(default_factory=list)
    rejected: dict[str, list[dict]] = Field(default_factory=dict)
    # None permits full design; a set restricts product changes to selected slots.
    rerollTargets: list[str] | None = None


class ConceptUpdate(Model):
    baseRevision: int
    concept: Concept
    slots: list[SlotPlan] = Field(min_length=1, max_length=12)


class Placement(Model):
    slotId: str
    catalogId: str
    x: float
    z: float
    rotation: Literal[0, 90, 180, 270]
    explanation: str = Field(min_length=1, max_length=1500)


class DesignPatch(Model):
    baseRevision: int
    placements: list[Placement] = Field(default_factory=list, max_length=12)
    removeSlotIds: list[str] = Field(default_factory=list, max_length=12)
    explanation: str = Field(min_length=1, max_length=2000)


class DesignError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def require(condition: bool, code: str, message: str) -> None:
    if not condition:
        raise DesignError(code, message)


def total(state: DesignState) -> float:
    return sum(BY_ID[s.catalogId]["price"] for s in state.slots.values() if s.catalogId)


def validate_layout(state: DesignState) -> None:
    footprints = []
    for slot in state.slots.values():
        if not slot.catalogId:
            continue
        p = BY_ID[slot.catalogId]
        width, depth = (p["depth"], p["width"]) if slot.rotation % 180 else (p["width"], p["depth"])
        require(abs(slot.x) + width / 2 <= state.room.width / 2 + 1e-6
                and abs(slot.z) + depth / 2 <= state.room.depth / 2 + 1e-6,
                "out_of_bounds", f"{slot.id} extends outside the room. Coordinates use the room center.")
        require(p["height"] <= state.room.height, "too_tall", f"{slot.id} exceeds room height.")
        for other, ow, od, layer in footprints:
            # Rugs may sit under furniture; two rugs cannot occupy the same floor area.
            if p["floorLayer"] != layer:
                continue
            overlap = abs(slot.x - other.x) < (width + ow) / 2 - 1e-6 and abs(slot.z - other.z) < (depth + od) / 2 - 1e-6
            require(not overlap, "overlap", f"{slot.id} overlaps {other.id}. Leave room between solid footprints.")
        footprints.append((slot, width, depth, p["floorLayer"]))
    require(state.budget is None or total(state) <= state.budget, "over_budget",
            f"The arrangement costs S${total(state):.0f}, exceeding the S${state.budget} budget.")


def update_concept(state: DesignState, update: ConceptUpdate) -> DesignState:
    require(update.baseRevision == state.revision, "stale_revision", "Read the latest design state before editing.")
    ids = [s.id for s in update.slots]
    require(len(ids) == len(set(ids)), "duplicate_slot", "Slot IDs must be unique.")
    categories = {p["category"] for p in BY_ID.values()}
    next_state = state.model_copy(deep=True)
    next_state.concept = update.concept
    for plan in update.slots:
        require(plan.category in categories, "unknown_category", f"No catalog products for {plan.category}.")
        old = next_state.slots.get(plan.id)
        if old:
            require(old.category == plan.category, "slot_category", "Keep an existing slot's category stable.")
            if old.locked:
                require(old.zone == plan.zone and old.group == plan.group, "locked", "Do not regroup locked anchors.")
            for key, value in plan.model_dump().items():
                setattr(old, key, value)
        else:
            require(state.rerollTargets is None, "reroll_scope", "A targeted reroll cannot add new slots.")
            next_state.slots[plan.id] = Slot(**plan.model_dump())
    # Plans merge by stable slot ID; omission never deletes an accepted item.
    next_state.revision += 1
    return next_state


def apply_patch(state: DesignState, patch: DesignPatch) -> DesignState:
    require(patch.baseRevision == state.revision, "stale_revision", "Read the latest design state before editing.")
    ids = [p.slotId for p in patch.placements] + patch.removeSlotIds
    require(bool(ids), "empty_patch", "A group must contain a change.")
    require(len(ids) == len(set(ids)), "duplicate_slot", "Change each slot at most once per patch.")
    candidate = state.model_copy(deep=True)
    for slot_id in patch.removeSlotIds:
        old = candidate.slots.get(slot_id)
        require(old is not None, "unknown_slot", f"Unknown slot {slot_id}.")
        require(not old.locked, "locked", f"{slot_id} is locked.")
        require(state.rerollTargets is None, "reroll_scope", "Reroll replaces slots; it cannot remove them.")
        del candidate.slots[slot_id]
    for placement in patch.placements:
        old = candidate.slots.get(placement.slotId)
        require(old is not None, "unknown_slot", "Define the slot using update_concept first.")
        p = BY_ID.get(placement.catalogId)
        require(p is not None, "unknown_product", f"Unknown catalog ID {placement.catalogId}.")
        require(old.category == p["category"], "category_mismatch", "The product must match the slot category.")
        same = (old.catalogId, old.x, old.z, old.rotation) == (placement.catalogId, placement.x, placement.z, placement.rotation)
        require(not old.locked or same, "locked", f"{old.id} is locked, including its position and rotation.")
        if state.rerollTargets is not None and old.id not in state.rerollTargets and old.catalogId:
            require(old.catalogId == placement.catalogId, "reroll_scope", f"Preserve the product in {old.id}.")
            require(abs(old.x - placement.x) <= .5 and abs(old.z - placement.z) <= .5,
                    "reroll_scope", "Only small adjustments (up to 0.5 m per axis) are allowed to surrounding pieces.")
        rejected = {r["catalogId"] for r in state.rejected.get(old.id, [])}
        require(placement.catalogId not in rejected or (old.catalogId == placement.catalogId and not old.replacing),
                "rejected_product", f"Choose a different product for {old.id}; this candidate was rejected.")
        if old.catalogId != placement.catalogId:
            old.liked = False
        for key in ("catalogId", "x", "z", "rotation", "explanation"):
            setattr(old, key, getattr(placement, key))
        old.replacing = False
    validate_layout(candidate)
    candidate.revision += 1
    return candidate


def snapshot(state: DesignState) -> dict:
    result = state.model_dump()
    result["total"] = total(state)
    issues = []
    try:
        validate_layout(state)
    except DesignError as exc:
        issues.append(str(exc))
    result["validationIssues"] = issues
    result["complete"] = not issues and bool(state.slots) and all(s.catalogId and not s.replacing for s in state.slots.values())
    return deepcopy(result)
