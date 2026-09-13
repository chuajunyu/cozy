"""Authoritative scene validation. Mutations are atomic and contain no network I/O."""

from copy import deepcopy
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.catalog import BY_ID


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class LightSettings(Model):
    on: bool = True
    brightness: float = Field(default=.7, ge=0, le=1)
    color: str = Field(default="#ffd3a0", pattern=r"^#[0-9a-fA-F]{6}$")


class Window(Model):
    wall: Literal['north', 'east', 'south', 'west']
    offset: float = Field(ge=0, le=1)
    width: float = Field(ge=.5, le=4)
    height: float = Field(ge=.5, le=5)
    sill: float = Field(ge=.2, le=5)


class DoorAnchor(Model):
    wall: Literal['north', 'east', 'south', 'west']
    offset: float = Field(ge=0, le=1)
    open: bool = False


class WallMount(Model):
    wall: Literal['north', 'east', 'south', 'west']
    offset: float = Field(ge=0, le=1)
    height: float = Field(gt=0, le=5)


class Room(Model):
    wallColors: dict[Literal['north', 'east', 'south', 'west'], Annotated[str, Field(pattern=r'^#[0-9a-fA-F]{6}$')]] = Field(default_factory=dict)
    width: float = Field(default=4, ge=2, le=12)
    depth: float = Field(default=3.5, ge=2, le=12)
    height: float = Field(default=2.6, ge=2, le=5)
    daylight: float = Field(default=1, ge=0, le=1)
    windows: list[Window] = Field(default_factory=lambda: [Window(wall='east', offset=.5, width=1.8, height=1.4, sill=.9)], max_length=4)
    sunHour: float = Field(default=9, ge=6, le=20)


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
    elevation: float = Field(default=0, ge=0, le=5)
    light: LightSettings | None = None
    supportId: str | None = Field(default=None, max_length=60)
    door: DoorAnchor | None = None
    wallMount: WallMount | None = None
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
    wallMount: WallMount | None = None
    slotId: str
    catalogId: str
    x: float
    z: float
    rotation: Literal[0, 90, 180, 270]
    elevation: float = Field(default=0, ge=0, le=5)
    light: LightSettings | None = None
    supportId: str | None = Field(default=None, max_length=60)
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


def total(state: DesignState, products: dict | None = None) -> float:
    products = BY_ID if products is None else products
    return sum(products[s.catalogId]["price"] for s in state.slots.values() if s.catalogId and not products[s.catalogId].get('door'))


def validate_layout(state: DesignState, products: dict | None = None) -> None:
    products = BY_ID if products is None else products
    from backend.placement import validate_architecture, validate_supports, valid_support
    validate_architecture(state, products)
    validate_supports(state, products)
    require(len(state.slots) <= 100, "item_limit", "A room supports at most 100 items.")
    footprints = []
    fixtures = 0
    for slot in state.slots.values():
        if not slot.catalogId:
            continue
        p = products.get(slot.catalogId)
        require(p is not None, "unknown_product", f"Unknown product {slot.catalogId}.")
        require(p.get("readyForPreview", True), "missing_asset", f"{p['name']}: local model is unavailable.")
        require(p['category'] == slot.category, "category_mismatch", "Product and slot categories must agree.")
        if p.get('door'):
            continue
        fixtures += bool(p.get("lighting"))
        require(fixtures <= 8, "fixture_limit", "A room supports eight light fixtures.")
        if slot.light:
            require(bool(p.get("lighting")), "not_fixture", "Only fixtures have light settings.")
            mode = p["lighting"]["colorMode"]
            if mode == "fixed":
                require(slot.light.color.lower() == "#ffd3a0", "fixed_light", "This fixture has fixed light color.")
            elif mode == "white-spectrum":
                require(slot.light.color.lower() in {"#ffd3a0", "#fff4dd", "#dceaff"}, "light_color", "Choose a white-spectrum color.")
        width, depth = (p["depth"], p["width"]) if slot.rotation % 180 else (p["width"], p["depth"])
        require(abs(slot.x) + width / 2 <= state.room.width / 2 + 1e-6
                and abs(slot.z) + depth / 2 <= state.room.depth / 2 + 1e-6,
                "out_of_bounds", f"{slot.id} extends outside the room. Coordinates use the room center.")
        require(slot.elevation + p["height"] <= state.room.height + 1e-6, "too_tall", f"{slot.id} exceeds room height.")
        for other, ow, od, layer, oh in footprints:
            if valid_support(slot, other, products) or valid_support(other, slot, products):
                continue
            # Rugs may sit under furniture; two rugs cannot occupy the same floor area.
            if p["floorLayer"] != layer:
                continue
            if slot.elevation >= other.elevation + oh - .005 or other.elevation >= slot.elevation + p["height"] - .005:
                continue
            overlap = abs(slot.x - other.x) < (width + ow) / 2 - 1e-6 and abs(slot.z - other.z) < (depth + od) / 2 - 1e-6
            require(not overlap, "overlap", f"{slot.id} overlaps {other.id}. Leave room between solid footprints.")
        footprints.append((slot, width, depth, p["floorLayer"], p["height"]))
    require(state.budget is None or total(state, products) <= state.budget, "over_budget",
            f"The arrangement costs S${total(state, products):.0f}, exceeding the S${state.budget} budget.")


def update_concept(state: DesignState, update: ConceptUpdate, products: dict | None = None) -> DesignState:
    products = BY_ID if products is None else products
    require(update.baseRevision == state.revision, "stale_revision", "Read the latest design state before editing.")
    ids = [s.id for s in update.slots]
    require(len(ids) == len(set(ids)), "duplicate_slot", "Slot IDs must be unique.")
    categories = {p["category"] for p in products.values()}
    next_state = state.model_copy(deep=True)
    next_state.concept = update.concept
    for plan in update.slots:
        require(plan.category != 'door', 'architecture_permission', 'Doors require an explicit room-edit request.')
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
    require(len(next_state.slots) <= 100, "item_limit", "A room supports at most 100 items.")
    # Plans merge by stable slot ID; omission never deletes an accepted item.
    next_state.revision += 1
    return next_state


def apply_patch(state: DesignState, patch: DesignPatch, products: dict | None = None) -> DesignState:
    products = BY_ID if products is None else products
    require(patch.baseRevision == state.revision, "stale_revision", "Read the latest design state before editing.")
    ids = [p.slotId for p in patch.placements] + patch.removeSlotIds
    require(bool(ids), "empty_patch", "A group must contain a change.")
    require(len(ids) == len(set(ids)), "duplicate_slot", "Change each slot at most once per patch.")
    candidate = state.model_copy(deep=True)
    for slot_id in patch.removeSlotIds:
        old = candidate.slots.get(slot_id)
        require(old is not None, "unknown_slot", f"Unknown slot {slot_id}.")
        require(not old.door, 'architecture_permission', 'Use the room-edit tool for doors.')
        require(not old.locked, "locked", f"{slot_id} is locked.")
        require(state.rerollTargets is None, "reroll_scope", "Reroll replaces slots; it cannot remove them.")
        del candidate.slots[slot_id]
    for placement in patch.placements:
        old = candidate.slots.get(placement.slotId)
        require(old is not None, "unknown_slot", "Define the slot using update_concept first.")
        p = products.get(placement.catalogId)
        require(p is not None, "unknown_product", f"Unknown catalog ID {placement.catalogId}.")
        require(not old.door and not p.get('door'), 'architecture_permission', 'Use the room-edit tool for doors.')
        require(old.category == p["category"], "category_mismatch", "The product must match the slot category.")
        require(p.get("canRecommend", True) or old.catalogId == placement.catalogId, "not_recommendable", "Choose an available catalog product.")
        same = (old.catalogId, old.x, old.z, old.rotation, old.elevation) == (placement.catalogId, placement.x, placement.z, placement.rotation, placement.elevation)
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
        for key in ("catalogId", "x", "z", "rotation", "elevation", "supportId", "explanation"):
            setattr(old, key, getattr(placement, key))
        if p.get('lighting', {}).get('mount') == 'wall':
            old.wallMount = placement.wallMount or old.wallMount
        else:
            old.wallMount = None
        if placement.light is not None:
            old.light = placement.light
        elif not p.get("lighting"):
            old.light = None
        old.replacing = False
    from backend.placement import settle_state
    candidate = settle_state(candidate, state, products)
    validate_layout(candidate, products)
    candidate.revision += 1
    return candidate


def snapshot(state: DesignState, products: dict | None = None) -> dict:
    products = BY_ID if products is None else products
    result = state.model_dump()
    result["total"] = total(state, products)
    issues = []
    try:
        validate_layout(state, products)
    except DesignError as exc:
        issues.append(str(exc))
    result["validationIssues"] = issues
    result["complete"] = not issues and bool(state.slots) and all(s.catalogId and not s.replacing for s in state.slots.values())
    return deepcopy(result)
