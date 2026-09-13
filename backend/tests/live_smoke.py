"""Opt-in, billable Astra smoke test: python -m backend.tests.live_smoke."""

import asyncio
import json

from backend.main import app  # Loads the ignored local environment.
from backend.protocol import Command, handle_command
from backend.sessions import Session


async def main():
    session = Session()
    queue = asyncio.Queue()
    session.subscribers.add(queue)
    await handle_command(session, Command(type="chat.send", requestId="smoke-start", budget=1500,
        text="Design a cosy bedroom with a workspace, warm oak and sage. Use 5 to 7 items. Complete the room without asking me unless essential."))
    locked = None
    try:
        async with asyncio.timeout(240):
            while True:
                event = await queue.get()
                if event["type"] == "agent.status":
                    print("STATUS", event["status"], event["activity"], flush=True)
                if event["type"] == "design.updated":
                    placed = [s for s in session.state.slots.values() if s.catalogId]
                    print("SCENE", session.state.revision, "placed", len(placed), flush=True)
                    if locked is None and placed:
                        slot = next((s for s in placed if s.anchor), placed[0])
                        locked = (slot.id, slot.catalogId, slot.x, slot.z, slot.rotation)
                        await handle_command(session, Command(type="item.lock", requestId="smoke-lock", slotIds=[slot.id], expectedProducts={slot.id: slot.catalogId}, locked=True))
                        print("LOCKED_ANCHOR", slot.id, flush=True)
                if event["type"] == "feedback.ack":
                    print("ACK", event["requestId"], event["stage"], flush=True)
                if event["type"] == "error":
                    raise RuntimeError("Live test failed: " + event["code"])
                if event["type"] == "design.completed":
                    if locked:
                        slot = session.state.slots[locked[0]]
                        assert (slot.id, slot.catalogId, slot.x, slot.z, slot.rotation) == locked
                    print("COMPLETE", event["complete"], flush=True)
                    assert event["complete"], "The live design stopped before filling all planned slots."
                    assert locked is not None, "No anchor group appeared."
                    break
    finally:
        failures = [{"code": r.get("code"), "message": r.get("message")} for r in session.tool_results.values() if not r.get("ok")]
        print("TOOL_FAILURES", json.dumps(failures), flush=True)
        print("FINAL_PLACED", sum(bool(s.catalogId) for s in session.state.slots.values()), flush=True)
        if session.task:
            session.task.cancel()
            await asyncio.gather(session.task, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
