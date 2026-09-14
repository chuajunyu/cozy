"""One persistent Responses WebSocket and one event reader per design session."""

import asyncio
import json
import logging
import os
import secrets
import ssl
import time

import certifi
from collections import deque
from typing import Any

from openai import AsyncOpenAI

from backend.astra_usage import record_usage, session_label, token_usage
from backend.design_tools import INSTRUCTIONS, TOOLS, execute_tool
from backend.model_context import model_json, model_state
from backend.provider_errors import LIMIT_MESSAGES
from backend.sessions import Session


def astra_tls_context() -> ssl.SSLContext:
    # Some macOS Python installs have no native CA bundle. Retain configured
    # system roots and add the same verified public roots used by HTTP clients.
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=certifi.where())
    return context


class AstraDesigner:
    debounce_seconds = 1.0
    debounce_max_seconds = 3.0

    def __init__(self, session: Session, client: Any = None) -> None:
        self.session = session
        self.generation = session.generation
        self.client = client
        self.connection: Any = None
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.control = asyncio.Lock()
        self.active = False
        self.voice_turn = False
        self.active_id: str | None = None
        self.waiting: list[dict] = []
        self.sent_steers: deque[dict] = deque()
        self.accepted: dict[str, dict] = {}
        self.outputs: dict[str, list[dict]] = {}
        self.continued: set[str] = set()
        self.turns = 0
        self.creating_request: dict | None = None
        self.background: dict[str, dict] = {}
        self.background_changed = asyncio.Event()
        self.background_started = 0.0
        self.background_updated = 0.0
        self.run_id = secrets.token_hex(8)
        self.logged_responses: dict[str, None] = {}
        self.run_output_tokens = 0
        self.steer_count = 0
        self.max_turns = self.setting('COZY_ASTRA_MAX_RESPONSES', 40, 1, 100)
        self.max_output_tokens = self.setting('COZY_ASTRA_MAX_OUTPUT_TOKENS', 7000, 256, 128000)
        self.max_run_output_tokens = self.setting('COZY_ASTRA_MAX_RUN_OUTPUT_TOKENS', 28000, 256, 1000000)
        self.reasoning_effort = os.getenv('COZY_ASTRA_REASONING_EFFORT', 'medium')
        if self.reasoning_effort not in {'low', 'medium', 'high', 'xhigh', 'max'}:
            self.reasoning_effort = 'medium'

    @staticmethod
    def setting(name: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(os.getenv(name, str(default)))
            return value if minimum <= value <= maximum else default
        except ValueError:
            return default

    def submit(self, request_id: str, text: str, *, background: bool = False) -> None:
        request = {"requestId": request_id, "text": text, "background": background}
        if not background:
            self.inbox.put_nowait(request)
        elif not self.active or self.generation != self.session.generation:
            self.ack(request, 'saved')
        else:
            now = time.monotonic()
            if not self.background:
                self.background_started = now
            self.background_updated = now
            self.background[request_id] = request
            self.background_changed.set()

    def take_background(self) -> list[dict]:
        pending = list(self.background.values())
        self.background.clear()
        self.background_changed.set()
        return pending

    def save_background(self) -> None:
        for request in self.take_background():
            self.ack(request, 'saved')

    def with_background(self, request: dict) -> dict:
        pending = self.take_background()
        if not pending:
            return request
        # The single snapshot accompanying this message contains every final edit.
        return {**request, 'requestIds': [*(request.get('requestIds') or [request['requestId']]),
                                         *(r['requestId'] for r in pending)],
                'text': request['text'] + '\nBackground edits: ' + ' '.join(dict.fromkeys(r['text'] for r in pending))}

    async def read_background(self) -> None:
        while True:
            await self.background_changed.wait()
            self.background_changed.clear()
            while self.background:
                delay = max(0, min(self.background_started + self.debounce_max_seconds,
                                   self.background_updated + self.debounce_seconds) - time.monotonic())
                try:
                    async with asyncio.timeout(delay):
                        await self.background_changed.wait()
                    self.background_changed.clear()
                    continue
                except TimeoutError:
                    pass
                async with self.control:
                    if not self.background:
                        break
                    if not self.active or self.generation != self.session.generation:
                        self.save_background()
                    elif self.active_id:
                        await self.steer({'requestId': next(iter(self.background)),
                                          'text': 'Incorporate these manual edits silently; continue the current request.',
                                          'background': True})
                    else:
                        # Startup/tool continuation has no response ID yet. The
                        # next response.created wakes this worker without polling.
                        break

    async def run(self) -> None:
        session = self.session
        if self.client is None and not os.getenv("OPENAI_API_KEY"):
            self.fail_pending()
            session.publish({"type": "error", "code": "missing_key", "message": "Configure OPENAI_API_KEY on the backend to design with Astra."})
            session.set_status("error", "Astra is not configured")
            return
        client = self.client or AsyncOpenAI(timeout=60, max_retries=0)
        try:
            async with client.responses.connect(websocket_connection_options={"ssl": astra_tls_context()}) as connection:
                self.connection = connection
                session.set_status("working", "Connecting your brief to Astra")
                async with asyncio.TaskGroup() as group:
                    group.create_task(self.read_events())
                    group.create_task(self.read_inputs())
                    group.create_task(self.read_background())
        except asyncio.CancelledError:
            self.save_background()
            session.set_status("idle", "Design paused; your room is preserved")
            raise
        except Exception as exc:
            self.fail_pending()
            cause = exc
            while isinstance(cause, BaseExceptionGroup):
                cause = cause.exceptions[0]
            logging.getLogger(__name__).error("Astra failure (%s)", type(cause).__name__)
            # Do not forward exception bodies: upstream errors can contain headers or input.
            message = ("Astra reached the configured work limit and paused. Your room is saved; send a message to continue."
                       if isinstance(cause, WorkLimitReached) else
                       "The backend could not verify OpenAI's TLS certificate. Check the backend certificate configuration."
                       if isinstance(cause, ssl.SSLCertVerificationError)
                       else "Astra's connection was interrupted. Your room and feedback are saved. Send a message to retry.")
            code = 'astra_work_limit' if isinstance(cause, WorkLimitReached) else 'astra_unavailable'
            upstream_code = getattr(cause, 'code', None)
            upstream_type = getattr(cause, 'type', None)
            status = getattr(cause, 'status_code', None) or getattr(getattr(cause, 'response', None), 'status_code', None)
            if upstream_type == 'insufficient_quota' or upstream_code in {
                'insufficient_quota', 'billing_hard_limit_reached',
                'project_spend_limit_exceeded', 'organization_spend_limit_exceeded',
            }:
                code = 'astra_credits_exhausted'
            elif upstream_code in {'rate_limit_exceeded', 'rate_limit_error'} or upstream_type == 'rate_limit_error':
                code = 'astra_rate_limited'
            elif status in {429, '429'}:
                code = 'astra_usage_limited'
            message = LIMIT_MESSAGES.get(code, message)
            session.publish({"type": "error", "code": code, "message": message})
            session.set_status("error", 'OpenAI credits exhausted' if code == 'astra_credits_exhausted' else
                               'OpenAI usage limit reached' if code in LIMIT_MESSAGES else 'Astra could not continue')
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
                if self.generation != self.session.generation:
                    self.ack(request, 'saved' if request.get('background') else 'failed')
                    continue
                if not self.active:
                    # A queued edit may arrive just after the design finishes. The
                    # next brief already includes it in state; don't start a reply.
                    if request.get('background'):
                        self.ack(request, 'saved')
                        continue
                    self.voice_turn = request["requestId"].startswith("voice-")
                    self.turns = 0
                    self.run_output_tokens = 0
                    self.steer_count = 0
                    self.run_id = secrets.token_hex(8)
                    self.continued.clear()
                    # Recover from authoritative state and saved user-facing conversation.
                    history_messages = [m for m in self.session.messages[-20:] if m["role"] in {"user", "assistant"} and m["text"] and m['id'] != request['requestId'] and not m.get('internal')]
                    history = [{"role": m["role"], "content": m["text"] + ("\nReferenced objects: " + json.dumps(m['references']) if m.get('references') else '')} for m in history_messages]
                    references = next((m.get('references') for m in self.session.messages if m['id'] == request['requestId']), None)
                    request = self.with_background(request)
                    self.creating_request = request
                    state = model_state(self.session.snapshot(), exclude_request_ids={request['requestId'], *(m['id'] for m in history_messages)})
                    await self.create([*history,
                                       {"role": "user", "content": "Current authoritative design state:\n" + model_json(state)},
                                       {"role": "user", "content": request["text"] + ('\nReferenced objects: ' + json.dumps(references) if references else '')}])
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
        if self.turns > self.max_turns or self.run_output_tokens >= self.max_run_output_tokens:
            raise WorkLimitReached()
        self.active = True
        self.active_id = None
        params: dict = {"model": "gpt-6-astra", "instructions": (self.session.design_instructions if self.session.planning else INSTRUCTIONS + self.session.design_instructions) + ("\nYou are the task backend for a voice conversation. Return a concise factual result in at most 60 words. Do not narrate progress or greet the user; the voice assistant handles conversation." if self.voice_turn else ""),
                        "tools": [] if self.session.planning else TOOLS, "input": input, "parallel_tool_calls": False,
                        "reasoning": {"effort": self.reasoning_effort},
                        "max_output_tokens": min(self.max_output_tokens, self.max_run_output_tokens - self.run_output_tokens)}
        if parent:
            params["previous_response_id"] = parent
        await self.connection.response.create(**params)
        self.session.set_status("working", "Astra is developing your concept")

    async def steer(self, request: dict) -> None:
        request = self.with_background(request)
        request = {**request, "parent": self.active_id}
        self.sent_steers.append(request)
        await self.connection.response.steer(previous_response_id=self.active_id,
            input=request["text"] + "\nLatest authoritative state:\n" + model_json(model_state(
                self.session.snapshot(), exclude_request_ids=set(request.get('requestIds') or [request['requestId']]))))
        self.steer_count += 1
        self.ack(request, "sent")

    def ack(self, request: dict, stage: str) -> None:
        for request_id in dict.fromkeys(request.get('requestIds') or [request['requestId']]):
            self.session.publish({"type": "feedback.ack", "requestId": request_id, "stage": stage})

    def fail_pending(self) -> None:
        """End outstanding delivery indicators when the designer cannot connect."""
        self.save_background()
        pending = [*self.waiting, *self.sent_steers, *self.accepted.values()]
        if self.creating_request:
            pending.append(self.creating_request)
        while not self.inbox.empty():
            pending.append(self.inbox.get_nowait())
        for request in {r['requestId']: r for r in pending}.values():
            self.ack(request, 'failed')
        self.waiting.clear()
        self.sent_steers.clear()
        self.accepted.clear()
        self.creating_request = None

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
        if kind in {'response.completed', 'response.incomplete', 'response.failed'}:
            response = event.get('response') or {}
            response_id = response.get('id')
            if response_id and response_id not in self.logged_responses:
                self.logged_responses[response_id] = None
                if len(self.logged_responses) > 500:
                    del self.logged_responses[next(iter(self.logged_responses))]
                usage = token_usage(response)
                self.run_output_tokens += usage['output_tokens'] or 0
                record_usage({'session': session_label(session.id), 'run': self.run_id,
                              'response': response_id, 'event': kind, 'model': 'gpt-6-astra',
                              'mode': 'idea' if session.variant_source is not None else 'planning' if session.planning else 'voice' if self.voice_turn else 'design',
                              'steers_sent': self.steer_count, 'run_output_tokens': self.run_output_tokens, **usage})
        if kind == "response.created":
            response = event["response"]
            self.active_id = response["id"]
            self.active = True
            self.background_changed.set()
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
            session.delta(event["item_id"], event["delta"], internal=self.voice_turn)
        elif kind == "response.output_item.added" and event["item"].get("type") == "function_call":
            activities = {"search_catalog": "Comparing catalog options", "get_design_state": "Reviewing your room and preferences", "update_concept": "Establishing the whole-room concept", "apply_design_patch": "Checking a coordinated furniture group", "edit_room": "Applying your requested room changes"}
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
            session.publish({"type": "error", "code": "steering_failed", **({'requestId': request['requestId']} if request else {}), "message": "Astra could not apply that update yet. The backend has preserved your locks and feedback. Send a follow-up to retry."})
        elif kind == "response.steer.pending":
            parent = event["steer"]["previous_response_id"]
            results = []
            for stub in event.get("required_input", []):
                call_id = stub.get("call_id")
                if call_id not in session.tool_results:
                    raise RuntimeError("Missing saved tool result")
                results.append({"type": "function_call_output", "call_id": call_id, "output": model_json(session.tool_results[call_id])})
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
                if (response.get('incomplete_details') or {}).get('reason') == 'max_output_tokens':
                    raise WorkLimitReached()
                raise RuntimeError("Incomplete model response")
            results = self.outputs.pop(id, [])
            if self.run_output_tokens >= self.max_run_output_tokens and (results or steered or self.accepted or self.sent_steers):
                raise WorkLimitReached()
            if results:
                await self.create(results, id)
            elif steered or self.accepted or self.sent_steers:
                # Wait for the automatic successor, not another independently-created response.
                self.active = True
            elif id not in self.continued:
                self.active = False
                self.save_background()
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
            # Responses streaming errors put code/message at the top level;
            # failed responses and some transports instead nest an error object.
            error = event.get('error') or (event.get('response') or {}).get('error') or event
            raise UpstreamError(error.get('code'), error.get('status_code') or event.get('status_code'), error.get('type'))

    async def complete_tool(self, response_id: str, item: dict) -> None:
        result = await execute_tool(self.session, item["call_id"], item["name"], item["arguments"], self.generation)
        outputs = self.outputs.setdefault(response_id, [])
        if not any(o["call_id"] == item["call_id"] for o in outputs):
            outputs.append({"type": "function_call_output", "call_id": item["call_id"], "output": model_json(result)})


class WorkLimitReached(RuntimeError):
    """A recoverable application limit, not an upstream connection failure."""


class UpstreamError(RuntimeError):
    def __init__(self, code: str | None, status_code: int | None = None, error_type: str | None = None) -> None:
        super().__init__('Upstream request failed')
        self.code = code
        self.status_code = status_code
        self.type = error_type
