import asyncio
import json
import struct

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.astra import AstraDesigner
from backend.catalog import BY_ID, search
from backend.design import DesignError, DesignState, Room, Slot, validate_layout
from backend.design_tools import execute_tool
from backend.main import app
from backend.products import GeneratedProduct, generated, load_ikea, validate_glb
from backend.protocol import Command, handle_command
from backend.sessions import Session
from backend.studio import StudioCommand, handle_studio
from backend.tests.test_design import QuietDesigner


async def edit(session, kind, **kwargs):
    if kind == 'session.restore' and 'backup' in kwargs and not session.state.slots:
        from backend.restore import preview_restore
        preview = preview_restore(session, StudioCommand(type='session.restore.preview', requestId='preview', baseRevision=session.state.revision, backup=kwargs['backup']))
        if preview['blockers']:
            raise DesignError('invalid_backup', preview['blockers'][0])
        kwargs = {'previewId': preview['previewId']}
    command = StudioCommand(type=kind, requestId=f"edit-{session.state.revision}-{kind}",
                            baseRevision=session.state.revision, **kwargs)
    await handle_studio(session, command)
    return command


async def add(session, id="desk", product="sample-desk", **kwargs):
    return await edit(session, "item.add", slotId=id, catalogId=product, x=kwargs.pop("x", 0), z=kwargs.pop("z", 0), **kwargs)


def test_search_tool_bounds_payload_and_manual_snapshot_includes_feedback():
    async def run():
        s = Session()
        result = await execute_tool(s, 'bounded', 'search_catalog', '{}')
        assert len(result['products']) <= 30
        assert all('parts' not in p and 'modelCandidates' not in p for p in result['products'])
        queue = asyncio.Queue()
        s.subscribers.add(queue)
        await add(s)
        state = queue.get_nowait()['state']
        assert state['feedback'][-1]['text'].startswith('Manual change: item.add')
    asyncio.run(run())


def test_manual_edits_are_atomic_idempotent_and_revision_guarded():
    async def run():
        s = Session()
        command = await add(s)
        await handle_studio(s, command)
        assert s.state.revision == 1 and len(s.history) == 1
        stale = StudioCommand(type="item.update", requestId="stale", baseRevision=0, slotId="desk", expectedProduct="sample-desk", x=.1)
        with pytest.raises(DesignError, match="room changed"):
            await handle_studio(s, stale)
        for changes in ({"x": 10}, {"elevation": 2.5}, {"expectedProduct": "bed-oak"}):
            before = s.state.model_dump()
            with pytest.raises(DesignError):
                await edit(s, "item.update", slotId="desk", **{"expectedProduct": "sample-desk", **changes})
            assert s.state.model_dump() == before
        await edit(s, "item.update", slotId="desk", expectedProduct="sample-desk", rotation=90, x=.5)
        assert s.state.slots["desk"].rotation == 90
    asyncio.run(run())


def test_height_collisions_rugs_and_lamp_controls():
    async def run():
        s = Session()
        await add(s)
        with pytest.raises(DesignError, match="overlaps"):
            await add(s, "lamp", "sample-demo-lamp")
        await add(s, "lamp", "sample-demo-lamp", elevation=.75)
        await edit(s, "fixture.update", slotId="lamp", expectedProduct="sample-demo-lamp", light={"on": False, "brightness": .2, "color": "#ff92cd"})
        assert not s.state.slots["lamp"].light.on
        await add(s, "rug", "rug-oat")
        with pytest.raises(DesignError, match="overlaps"):
            await add(s, "rug2", "rug-olive")
        with pytest.raises(DesignError):
            await edit(s, "fixture.update", slotId="desk", expectedProduct="sample-desk", light={"on": True})
    asyncio.run(run())


def test_locks_budget_resize_clear_and_undo():
    async def run():
        s = Session()
        await add(s)
        await handle_command(s, Command(type="item.lock", requestId="lock", slotIds=["desk"], locked=True), QuietDesigner)
        for kind in ("item.delete", "item.update", "room.clear"):
            with pytest.raises(DesignError, match="[Uu]nlock"):
                await edit(s, kind, slotId="desk", expectedProduct="sample-desk", x=.1)
        await edit(s, "room.update", budget=10)
        assert s.state.budget == 10
        await edit(s, "room.undo")
        await edit(s, "room.undo")
        assert not s.state.slots["desk"].locked
        await edit(s, "item.update", slotId="desk", expectedProduct="sample-desk", x=1.2)
        with pytest.raises(DesignError, match="outside"):
            await edit(s, "room.update", room={"width": 2, "depth": 3})
        await edit(s, "room.clear")
        assert not s.state.slots
        await edit(s, "room.undo")
        assert s.state.slots["desk"].x == 1.2
    asyncio.run(run())


def test_manual_change_steers_active_agent_and_undo_fences_late_tools():
    async def run():
        s = Session()
        await add(s)
        s.designer = QuietDesigner(s)
        s.task = asyncio.create_task(s.designer.run())
        await edit(s, "item.update", slotId="desk", expectedProduct="sample-desk", x=.2)
        assert len(s.designer.submissions) == 1
        generation = s.generation
        await edit(s, "room.undo")
        assert s.state.slots["desk"].x == 0 and s.task is None
        revision = s.state.revision
        result = await execute_tool(s, "late", "update_concept", json.dumps({"baseRevision": revision,
            "concept": {"title": "Late"}, "slots": [{"id": "late", "label": "Late", "category": "desk", "zone": "Room", "group": "Work"}]}), generation)
        assert result["code"] == "canceled_generation" and s.state.revision == revision
    asyncio.run(run())


def test_agent_groups_share_history_and_likes_follow_products():
    async def run():
        s = Session()
        await add(s)
        result = await execute_tool(s, "move", "apply_design_patch", json.dumps({"baseRevision": s.state.revision,
            "placements": [{"slotId": "desk", "catalogId": "sample-desk", "x": .3, "z": 0, "rotation": 0, "explanation": "Better fit"}], "explanation": "Move the desk"}))
        assert result["ok"] and len(s.history) == 2
        await edit(s, "room.undo")
        assert s.state.slots["desk"].x == 0
    asyncio.run(run())


def custom():
    return {"id": "cube", "name": "Cube", "category": "custom", "price": 15, "dimensions": [.3, .3, .3],
            "parts": [{"shape": "box", "size": [.3, .3, .3], "position": [0, .15, 0], "color": "#abcdef"}]}


def test_custom_catalog_is_validated_and_session_scoped():
    async def run():
        a, b = Session(), Session()
        await edit(a, "catalog.import", product=custom())
        assert "custom-cube" in a.products and "custom-cube" not in b.products
        assert search(category="custom", products=a.products)
        with pytest.raises(DesignError, match="overwritten"):
            await edit(a, "catalog.import", product=custom())
        await add(a, "cube", "custom-cube")
        assert a.snapshot()["total"] == 15
        for invalid in ({"dimensions": [float("nan"), 1, 1]}, {"parts": []}, {"modelUrl": "https://invalid/model.glb"}):
            with pytest.raises(ValidationError):
                GeneratedProduct.model_validate({**custom(), **invalid})
        bad = custom(); bad["parts"][0]["position"][1] = 10
        with pytest.raises(ValidationError):
            generated(bad)
    asyncio.run(run())


def test_restore_is_atomic_and_does_not_overwrite_live_session():
    async def run():
        a = Session()
        await edit(a, "catalog.import", product=custom())
        await add(a, "cube", "custom-cube")
        backup = {"version": 2, "state": a.state.model_dump(), "products": [custom()]}
        b = Session()
        invalid = json.loads(json.dumps(backup)); invalid["state"]["slots"]["cube"]["x"] = 100
        with pytest.raises(DesignError):
            await edit(b, "session.restore", backup=invalid)
        assert b.state.revision == 0 and not b.custom_products and not b.history
        await edit(b, "session.restore", backup=backup)
        assert b.state.slots["cube"].catalogId == "custom-cube" and b.state.revision == 1 and not b.history
        with pytest.raises(DesignError, match="live room"):
            await edit(b, "session.restore", backup=backup)
    asyncio.run(run())


def test_missing_product_restore_keeps_room_empty():
    async def run():
        s = Session()
        state = DesignState(slots={"gone": Slot(id="gone", label="Gone", category="desk", zone="Room", group="Work", catalogId="ikea-00000000")})
        with pytest.raises(DesignError, match="Unknown product"):
            await edit(s, "session.restore", backup={"version": 2, "state": state.model_dump()})
        assert not s.state.slots
    asyncio.run(run())


def test_history_and_fixture_limits():
    async def run():
        s = Session()
        for n in range(35):
            await edit(s, "room.update", room={"daylight": (n % 10) / 10})
        assert len(s.history) == 30
        s.state.room = Room(width=12, depth=12)
        for n in range(8):
            await add(s, f"lamp{n}", "sample-demo-lamp", x=-5 + n)
        with pytest.raises(DesignError, match="eight"):
            await add(s, "ninth", "sample-demo-lamp", x=4)
        invalid = DesignState(slots={str(n): Slot(id=str(n), label="Plan", category="desk", zone="R", group="G") for n in range(101)})
        with pytest.raises(DesignError, match="100"):
            validate_layout(invalid)
    asyncio.run(run())


def test_glb_validation_and_missing_asset_readiness(tmp_path):
    doc = json.dumps({"asset": {"version": "2.0"}, "buffers": [{"byteLength": 0}]}).encode()
    doc += b" " * (-len(doc) % 4)
    path = tmp_path / "model.glb"
    path.write_bytes(b"glTF" + struct.pack("<IIII", 2, 20 + len(doc), len(doc), 0x4E4F534A) + doc)
    validate_glb(path)
    path.write_bytes(b"not a model")
    with pytest.raises(ValueError):
        validate_glb(path)
    data = tmp_path / "data"; data.mkdir()
    (data / "ikea-categories.json").write_text('{}')
    (data / "ikea-ready.json").write_text(json.dumps({"products": [{"id": "ikea-12345678", "name": "Desk", "productType": "Desk", "category": "Workspace", "dimensionsMeters": {"width": 1, "height": .7, "depth": .5}, "modelUrl": "/models/ikea/12345678.glb", "canRecommend": True}]}))
    p = load_ikea(tmp_path)[0]
    assert p["category"] == "desk" and not p["readyForPreview"] and not p["canRecommend"]


def receive(socket, kind):
    for _ in range(20):
        event = socket.receive_json()
        if event["type"] == kind:
            return event
    raise AssertionError(kind)


def test_websocket_manual_roundtrip_reconnect_and_recoverable_errors():
    with TestClient(app) as client:
        with client.websocket_connect('/ws') as socket:
            socket.send_json({"type": "session.init"})
            ready = socket.receive_json(); token = ready["sessionId"]
            socket.send_json({"type": "item.add", "requestId": "add", "baseRevision": 0, "slotId": "desk", "catalogId": "sample-desk", "x": 0, "z": 0})
            assert receive(socket, "design.updated")["state"]["slots"]["desk"]["x"] == 0
            receive(socket, "command.ack")
            socket.send_json({"type": "item.update", "requestId": "stale", "baseRevision": 0, "slotId": "desk", "expectedProduct": "sample-desk", "x": 1})
            assert socket.receive_json()["code"] == "stale_revision"
            socket.send_json({"type": "echo", "text": "still here"})
            assert socket.receive_json()["text"] == "still here"
        with client.websocket_connect('/ws') as socket:
            socket.send_json({"type": "session.init", "sessionId": token})
            ready = socket.receive_json()
            assert ready["state"]["undoCount"] == 1 and "desk" in ready["state"]["slots"]


def test_startup_ack_waits_for_response_created():
    async def run():
        s = Session(); queue = asyncio.Queue(); s.subscribers.add(queue)
        d = AstraDesigner(s); d.creating_request = {"requestId": "start", "text": "A room"}
        await d.handle_event({"type": "response.created", "response": {"id": "r1"}})
        assert (await queue.get())["stage"] == "applied"
        assert d.creating_request is None
    asyncio.run(run())


def test_over_budget_room_can_be_edited_restored_and_undone():
    async def run():
        s = Session()
        await add(s)
        await edit(s, 'room.update', budget=10)
        await edit(s, 'item.update', slotId='desk', expectedProduct='sample-desk', x=.3)
        saved = json.loads(s.state.model_dump_json())
        restored = Session()
        await edit(restored, 'session.restore', backup={'version':3, 'state':saved, 'products':[]})
        assert restored.state.budget == 10
        assert restored.state.slots['desk'].x == .3
        assert restored.snapshot()['validationIssues'] == []
        await edit(s, 'room.update', budget=None)
        assert s.state.budget is None
        await edit(s, 'room.undo')
        assert s.state.budget == 10
    asyncio.run(run())
