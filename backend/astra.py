"""One persistent Responses WebSocket and one event reader per design session."""

import asyncio
import json
import logging
import os
from collections import deque
from typing import Any

from openai import AsyncOpenAI

from backend.design import snapshot
from backend.design_tools import INSTRUCTIONS, TOOLS, execute_tool
from backend.sessions import Session


class AstraDesigner:
    def __init__(self, session: Session, client: Any = None) -> None:
        self.session = session
        self.generation = session.generation
        self.client = client
        self.connection: Any = None
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.control = asyncio.Lock()
        self.active = False
        self.active_id: str | None = None
        self.waiting: list[dict] = []
        self.sent_steers: deque[dict] = deque()
        self.accepted: dict[str, dict] = {}
        self.outputs: dict[str, list[dict]] = {}
        self.continued: set[str] = set()
        self.turns = 0
        self.creating_request: dict | None = None

    def submit(self, request_id: str, text: str) -> None:
        self.inbox.put_nowait({"requestId": request_id, "text": text})

    async def run(self) -> None:
        session = self.session
        if self.client is None and not os.getenv("OPENAI_API_KEY"):
            session.publish({"type": "error", "code": "missing_key", "message": "Configure OPENAI_API_KEY on the backend to design with Astra."})
            session.set_status("error", "Astra is not configured")
            return
        client = self.client or AsyncOpenAI(timeout=60, max_retries=0)
        try:
            async with client.responses.connect() as connection:
                self.connection = connection
                session.set_status("working", "Connecting your brief to Astra")
                async with asyncio.TaskGroup() as group:
                    group.create_task(self.read_events())
                    group.create_task(self.read_inputs())
        except asyncio.CancelledError:
            session.set_status("idle", "Design paused; your room is preserved")
            raise
        except Exception as exc:
            cause = exc
            while isinstance(cause, BaseExceptionGroup):
                cause = cause.exceptions[0]
            logging.getLogger(__name__).error("Astra connection failure (%s)", type(cause).__name__)
            # Do not forward exception bodies: upstream errors can contain headers or input.
            session.publish({"type": "error", "code": "astra_unavailable", "message": "Astra's connection was interrupted. Your room and feedback are saved. Send a message to retry."})
            session.set_status("error", "Astra could not continue")
        finally:
            self.active = False
            session.room_permissions.clear()
            self.connection = None
            if self.client is None:
                await client.close()

    async def read_inputs(self) -> None:
        while True:
            request = await self.inbox.get()
            async with self.control:
                if not self.active:
                    self.turns = 0
                    # Recover from authoritative state and saved user-facing conversation.
                    history = [{"role": m["role"], "content": m["text"]} for m in self.session.messages[-20:] if m["role"] in {"user", "assistant"} and m["text"]]
                    self.creating_request = request
                    await self.create([{"role": "user", "content": "Current authoritative design state:\n" + json.dumps(self.session.snapshot())},
                                       *history,
                                       {"role": "user", "content": request["text"]}])
                    self.ack(request, "sent")
                elif self.active_id:
                    await self.steer(request)
                else:
                    self.waiting.append(request)

    async def create(self, input: list[dict], parent: str | None = None) -> None:
        if parent and parent in self.continued:
            return
        if parent:
            self.continued.add(parent)
        self.turns += 1
        if self.turns > 40:
            raise RuntimeError("Session work limit reached")
        self.active = True
        self.active_id = None
        params: dict = {"model": "gpt-6-astra", "instructions": INSTRUCTIONS,
                        "tools": TOOLS, "input": input, "parallel_tool_calls": False,
                        "reasoning": {"effort": "medium"}, "max_output_tokens": 7000}
        if parent:
            params["previous_response_id"] = parent
        await self.connection.response.create(**params)
        self.session.set_status("working", "Astra is developing your concept")

    async def steer(self, request: dict) -> None:
        request = {**request, "parent": self.active_id}
        await self.connection.response.steer(previous_response_id=self.active_id,
            input=request["text"] + "\nLatest authoritative state:\n" + json.dumps(self.session.snapshot()))
        self.sent_steers.append(request)
        self.ack(request, "sent")

    def ack(self, request: dict, stage: str) -> None:
        self.session.publish({"type": "feedback.ack", "requestId": request["requestId"], "stage": stage})

    async def read_events(self) -> None:
        async for sdk_event in self.connection:
            event = sdk_event if isinstance(sdk_event, dict) else sdk_event.model_dump()
            async with self.control:
                await self.handle_event(event)
        raise RuntimeError("Upstream closed")

    async def handle_event(self, event: dict) -> None:
        if self.generation != self.session.generation:
            return
        kind = event["type"]
        session = self.session
        if kind == "response.created":
            response = event["response"]
            self.active_id = response["id"]
            self.active = True
            if self.creating_request:
                self.ack(self.creating_request, "applied")
                self.creating_request = None
            parent = response.get("previous_response_id")
            for id, request in list(self.accepted.items()):
                if request["parent"] == parent:
                    self.ack(request, "applied")
                    del self.accepted[id]
            for request in self.waiting:
                await self.steer(request)
            self.waiting.clear()
        elif kind == "response.output_text.delta":
            session.delta(event["item_id"], event["delta"])
        elif kind == "response.output_item.added" and event["item"].get("type") == "function_call":
            activities = {"search_catalog": "Comparing catalog options", "get_design_state": "Reviewing your room and preferences", "update_concept": "Establishing the whole-room concept", "apply_design_patch": "Checking a coordinated furniture group"}
            session.set_status("working", activities.get(event["item"].get("name"), "Developing your design"))
        elif kind == "response.output_item.done" and event["item"].get("type") == "function_call":
            response_id = event.get("response_id") or self.active_id
            if response_id is None:
                raise RuntimeError("Tool event without an active response")
            await self.complete_tool(response_id, event["item"])
        elif kind == "response.steer.accepted":
            if self.sent_steers:
                request = self.sent_steers.popleft()
                self.accepted[event["steer"]["id"]] = request
                self.ack(request, "queued")
        elif kind == "response.steer.failed":
            request = self.accepted.pop(event.get("steer", {}).get("id"), None)
            if request is None and self.sent_steers:
                request = self.sent_steers.popleft()
            if request:
                self.ack(request, "failed")
            session.publish({"type": "error", "code": "steering_failed", "message": "Astra could not apply that update yet. The backend has preserved your locks and feedback. Send a follow-up to retry."})
        elif kind == "response.steer.pending":
            parent = event["steer"]["previous_response_id"]
            results = []
            for stub in event.get("required_input", []):
                call_id = stub.get("call_id")
                if call_id not in session.tool_results:
                    raise RuntimeError("Missing saved tool result")
                results.append({"type": "function_call_output", "call_id": call_id, "output": json.dumps(session.tool_results[call_id])})
            await self.create(results, parent)
        elif kind in {"response.completed", "response.incomplete"}:
            response = event["response"]
            id = response["id"]
            session.previous_response_id = id
            # Some transports may omit output_item.done; completion still contains whole calls.
            for item in response.get("output", []):
                if item["type"] == "function_call" and item.get("status", "completed") == "completed":
                    await self.complete_tool(id, item)
            steered = (response.get("incomplete_details") or {}).get("reason") == "steered"
            if kind == "response.incomplete" and not steered:
                raise RuntimeError("Incomplete model response")
            results = self.outputs.pop(id, [])
            if results:
                await self.create(results, id)
            elif steered or self.accepted or self.sent_steers:
                # Wait for the automatic successor, not another independently-created response.
                self.active = True
            elif id not in self.continued:
                self.active = False
                session.room_permissions.clear()
                self.active_id = None
                async with session.lock:
                    complete = session.snapshot()["complete"]
                    if complete:
                        session.state.rerollTargets = None
                    session.broadcast_state()
                session.set_status("complete" if complete else "idle", "Your concept is ready to refine" if complete else "Waiting for your input")
                session.publish({"type": "design.completed", "complete": complete})
        elif kind in {"error", "response.failed"}:
            raise RuntimeError("Upstream request failed")

    async def complete_tool(self, response_id: str, item: dict) -> None:
        result = await execute_tool(self.session, item["call_id"], item["name"], item["arguments"], self.generation)
        outputs = self.outputs.setdefault(response_id, [])
        if not any(o["call_id"] == item["call_id"] for o in outputs):
            outputs.append({"type": "function_call_output", "call_id": item["call_id"], "output": json.dumps(result)})
