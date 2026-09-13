import asyncio
import json

import pytest
from pydantic import ValidationError

from backend.design import ConceptUpdate, DesignError, DesignPatch, DesignState, apply_patch, snapshot, update_concept
from backend.design_tools import execute_tool
from backend.protocol import Command, explicit_budget, handle_command
from backend.sessions import Session, SessionStore


def concept(revision=0):
    return ConceptUpdate.model_validate({"baseRevision": revision, "concept": {"title": "Warm retreat"}, "slots": [
        {"id": "sofa", "label": "Main sofa", "category": "sofa", "zone": "Living", "group": "Anchors", "anchor": True},
        {"id": "rug", "label": "Main rug", "category": "rug", "zone": "Living", "group": "Anchors", "anchor": True},
        {"id": "table", "label": "Coffee table", "category": "coffee_table", "zone": "Living", "group": "Support"},
    ]})


def placement(id, product, x=0, z=0):
    return {"slotId": id, "catalogId": product, "x": x, "z": z, "rotation": 0, "explanation": "Works with the warm palette."}


def patch(state, *items, remove=None):
    return DesignPatch(baseRevision=state.revision, placements=list(items), removeSlotIds=remove or [], explanation="A coordinated group.")


def furnished():
    state = update_concept(DesignState(budget=1000), concept())
    return apply_patch(state, patch(state, placement("sofa", "sofa-sage", 0, -1), placement("rug", "rug-oat", 0, -.2), placement("table", "table-oak", 0, .1)))


class QuietDesigner:
    active = True

    def __init__(self, session):
        self.submissions = []

    def submit(self, id, text):
        self.submissions.append((id, text))

    async def run(self):
        await asyncio.Event().wait()


def test_atomic_group_overlap_and_bounds():
    state = update_concept(DesignState(), concept())
    before = state.model_dump()
    with pytest.raises(DesignError, match="overlaps"):
        apply_patch(state, patch(state, placement("sofa", "sofa-sage"), placement("table", "table-oak")))
    assert state.model_dump() == before
    with pytest.raises(DesignError, match="outside"):
        apply_patch(state, patch(state, placement("sofa", "sofa-sage", 2, 0)))
    assert state.model_dump() == before


def test_rug_under_furniture_and_exact_budget():
    state = furnished()
    assert snapshot(state)["complete"]
    assert snapshot(state)["total"] == 695
    state.budget = 695
    apply_patch(state, patch(state, placement("table", "table-oak", 0, .15)))
    with pytest.raises(DesignError, match="budget"):
        apply_patch(state, patch(state, placement("table", "table-walnut", 0, .15)))


def test_revision_rejects_late_patch():
    state = furnished()
    pending = patch(state, placement("sofa", "sofa-sand", 0, -1))
    state.revision += 1
    with pytest.raises(DesignError) as error:
        apply_patch(state, pending)
    assert error.value.code == "stale_revision"


@pytest.mark.parametrize("change", [placement("sofa", "sofa-sand", 0, -1), placement("sofa", "sofa-sage", .1, -1)])
def test_lock_protects_product_and_pose(change):
    state = furnished()
    state.slots["sofa"].locked = True
    with pytest.raises(DesignError) as error:
        apply_patch(state, patch(state, change))
    assert error.value.code == "locked"
    with pytest.raises(DesignError):
        apply_patch(state, patch(state, remove=["sofa"]))


def test_rejected_candidates_and_targeted_scope():
    state = furnished()
    state.rerollTargets = ["table"]
    state.slots["table"].replacing = True
    state.rejected = {"table": [{"catalogId": "table-oak", "reason": "wrong color"}]}
    with pytest.raises(DesignError) as error:
        apply_patch(state, patch(state, placement("table", "table-oak", 0, .1)))
    assert error.value.code == "rejected_product"
    with pytest.raises(DesignError) as error:
        apply_patch(state, patch(state, placement("table", "table-cream", 0, .1), placement("sofa", "sofa-sand", 0, -1)))
    assert error.value.code == "reroll_scope"
    updated = apply_patch(state, patch(state, placement("table", "table-cream", 0, .1)))
    assert not updated.slots["table"].replacing
    assert updated.slots["sofa"] == state.slots["sofa"]


def test_unsafe_or_unknown_arguments():
    state = furnished()
    for item in [placement("missing", "table-oak"), placement("table", "invented"), placement("table", "bed-oak")]:
        with pytest.raises(DesignError):
            apply_patch(state, patch(state, item))
    with pytest.raises(ValidationError):
        patch(state, placement("table", "table-oak", float("nan")))


def test_duplicate_tool_is_executed_once():
    async def run():
        session = Session(state=furnished())
        command = patch(session.state, placement("table", "table-cream", 0, .1)).model_dump_json()
        first = await execute_tool(session, "same-call", "apply_design_patch", command)
        revision = session.state.revision
        assert first["ok"]
        assert await execute_tool(session, "same-call", "apply_design_patch", command) == first
        assert session.state.revision == revision
    asyncio.run(run())


def test_feedback_updates_before_designer_runs_and_duplicate_request():
    async def run():
        session = Session(state=furnished())
        pending = patch(session.state, placement("table", "table-walnut", 0, .1))
        await handle_command(session, Command(type="item.lock", requestId="lock", slotIds=["sofa"], expectedProducts={"sofa": "sofa-sage"}), QuietDesigner)
        assert session.state.slots["sofa"].locked
        command = Command(type="feedback.send", requestId="replace", action="reroll", slotIds=["table"], text="Wrong color")
        await handle_command(session, command, QuietDesigner)
        assert session.state.slots["table"].catalogId == "table-oak"
        assert session.state.slots["table"].replacing
        assert session.state.rejected["table"][0]["reason"] == "Wrong color"
        revision = session.state.revision
        await handle_command(session, command, QuietDesigner)
        assert session.state.revision == revision
        assert len(session.designer.submissions) == 1
        result = await execute_tool(session, "late", "apply_design_patch", pending.model_dump_json())
        assert result["code"] == "stale_revision"
        session.task.cancel()
        await asyncio.gather(session.task, return_exceptions=True)
    asyncio.run(run())


def test_session_isolation_and_restart():
    store = SessionStore()
    first, _ = store.get(None)
    second, _ = store.get(None)
    first.state.brief = "bedroom"
    assert first.id != second.id and second.state.brief == ""
    assert store.get(first.id)[0] is first
    restarted, reset = SessionStore().get(first.id)
    assert reset and restarted.id != first.id and not restarted.state.brief


def test_budget_from_comment_and_likes_are_not_locks():
    async def run():
        session = Session(state=furnished())
        await handle_command(session, Command(type="feedback.send", action="like", requestId="like", slotIds=["sofa"]), QuietDesigner)
        assert session.state.slots["sofa"].liked and not session.state.slots["sofa"].locked
        await handle_command(session, Command(type="chat.send", requestId="budget", text="Keep the room under S$800"), QuietDesigner)
        assert session.state.budget == 800
        session.task.cancel()
        await asyncio.gather(session.task, return_exceptions=True)
    asyncio.run(run())


def test_budget_mentions_do_not_silently_change_room_limit():
    assert explicit_budget("What does S$985 cover?") is None
    assert explicit_budget("Use a chair under S$80") is None
    assert explicit_budget("My chair budget is S$80") is None
    assert explicit_budget("Keep the room under S$800") == 800
    assert explicit_budget("My room budget is S$1,200") == 1200


def test_lowered_budget_prevents_false_completion():
    state = furnished()
    state.budget = 500
    result = snapshot(state)
    assert not result["complete"] and not result["validationIssues"]
    assert len(state.slots) == 3  # Preserve visible room while a new valid group is prepared.


def test_like_is_recorded_for_specific_product_not_its_replacement():
    async def run():
        session = Session(state=furnished())
        await handle_command(session, Command(type="feedback.send", action="like", requestId="like-product", slotIds=["table"]), QuietDesigner)
        assert session.state.feedback[-1]["products"] == {"table": "table-oak"}
        updated = apply_patch(session.state, patch(session.state, placement("table", "table-cream", 0, .1)))
        assert not updated.slots["table"].liked
    asyncio.run(run())


def test_astra_can_reduce_an_existing_overrun_but_cannot_increase_it():
    state = furnished()
    state.budget = 100
    cheaper = apply_patch(state, patch(state, remove=['table']))
    assert snapshot(cheaper)['total'] < snapshot(state)['total']
    assert snapshot(cheaper)['total'] > 100
    with pytest.raises(DesignError) as error:
        apply_patch(state, patch(state, placement('table', 'table-walnut', 0, .15)))
    assert error.value.code == 'over_budget'
