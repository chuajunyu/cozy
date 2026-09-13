"""Tool schemas and exactly-once execution of completed calls."""

import json

from pydantic import ValidationError

from backend.catalog import search
from backend.design import ConceptUpdate, DesignError, DesignPatch, apply_patch, snapshot, update_concept
from backend.sessions import Session
from backend.architecture import RoomEdit, edit_room


TOOLS = [
    {'type': 'function', 'name': 'edit_room', 'description': 'Edit architecture only for an explicit current user request. Use the requestId and permitted operation from get_design_state roomEditPermissions. Broad design requests never allow architecture changes.', 'parameters': RoomEdit.model_json_schema(), 'strict': False},
    {"type": "function", "name": "get_design_state", "description": "Read authoritative room, concept, feedback, rejected candidates, locks and current revision. Always read after feedback or a rejected patch.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}, "strict": True},
    {"type": "function", "name": "search_catalog", "description": "Find available, locally renderable IKEA and demo products. IKEA prices are dated SGD offers; sample prices are illustrative. Query ranks complementary style/material preferences; dimensions and price filter results.",
     "parameters": {"type": "object", "properties": {"category": {"type": "string"}, "max_price": {"type": "number", "minimum": 0}, "max_width": {"type": "number", "minimum": 0}, "query": {"type": "string"}}, "additionalProperties": False}, "strict": False},
    {"type": "function", "name": "update_concept", "description": "Establish a cohesive whole-room concept and stable planned slots grouped by zone. Plan anchors and supports up front (typically 5-10 pieces); saves no furniture yet. Existing slots merge by ID; omission does not remove them. Budget is user-owned and not editable here.",
     "parameters": ConceptUpdate.model_json_schema(), "strict": False},
    {"type": "function", "name": "apply_design_patch", "description": "Atomically place a coordinated group or replace selected pieces. Coordinates are meters from ROOM CENTER, x right, z toward viewer, y floor=0. Elevation is base height; surface lamps may rest atop furniture, ceiling lamps below room height. Up to eight light fixtures are supported. Rotation 90/270 swaps width and depth. Solid footprints must not overlap; rugs can sit underneath solids. Locked product AND pose are immutable. Keep old candidates until a complete valid replacement. Use latest baseRevision.",
     "parameters": DesignPatch.model_json_schema(), "strict": False},
]

INSTRUCTIONS = """You are Cozy's interior designer, collaborating with the user on a shared 3D room.
Use brief -> cohesive concept -> anchor groups -> supporting groups -> whole-room review.
Stream brief user-facing explanations of your actual design choices and trade-offs. Do not expose
private reasoning or invent searches, measurements, comfort claims, availability, or product links.
Preserve doors, windows, room dimensions and sun settings unless roomEditPermissions explicitly permits a requested edit. Ambiguous requests such as make it brighter do not grant permission: clarify before changing architecture. Furniture patches cannot alter doors. Place mattresses only on verified decks and surface objects on compatible supports, using supportId. Read support metadata and reserve door swings. Use only search_catalog results. IKEA products carry dated SGD prices, availability, and source evidence. Demo/custom products are illustrative. Do not invent missing material or style facts.
Catalog categories are sofa, rug, coffee_table, bed, desk, chair, lamp, shelf, side_table, plant, dining_table, wardrobe, dresser, mattress, custom. Search to discover available products.
Infer routine preferences and explain assumptions. Ask one focused question only when necessary;
otherwise continue to a complete design without requiring approval for each group.
Read get_design_state first. The supplied current state overrides assumptions from earlier chat.
For a new room, use update_concept to declare the full concept and planned slots, reserving room and
budget for all zones. Typical designs contain 5-10 pieces, fewer if space/budget demands.
Use stable readable slot IDs (main-sofa, main-rug, workspace-desk). Present anchors together
(sofa + rug, bed + bedside table), then coordinated supporting groups using apply_design_patch.
Give each item a concise rationale and explain the group as a whole. Never fabricate a final schema
in chat: scene tools are the only way to change the room. Check tool results before saying an item
was placed. On validation rejection, read current state, correct the whole group, and try again.
Locked items are anchors: preserve exact product, position and rotation. Like is a soft preference.
Respect rejected product IDs and rejection reasons for each slot. A targeted reroll changes only
requested products; other unlocked pieces may move slightly (up to 0.5 m per axis) for fit.
Continue filling pending planned slots while rerolling; do not abandon the rest of the room.
Do not repeat the current product as a replacement. If no suitable alternative exists, explain the
constraint and ask which preference the user wants to relax. Never silently unlock or exceed budget.
Feedback may arrive while you work: acknowledge it naturally and adapt to the latest state.
Read get_design_state for a final whole-room review. Check every requested function and planned
slot, circulation, scale, visual cohesion, locked anchors and budget; finish missing groups first.
End with a short recap of actual accepted choices and any compromise. Do not claim physical comfort
or accurate clearance analysis beyond the supplied footprints. Ask follow-ups only if genuinely needed.
"""


async def execute_tool(session: Session, call_id: str, name: str, arguments: str, generation: int | None = None) -> dict:
    async with session.lock:
        if generation is not None and generation != session.generation:
            return {"ok": False, "code": "canceled_generation", "message": "This design run was canceled."}
        if call_id in session.tool_results:
            return session.tool_results[call_id]
        try:
            args = json.loads(arguments)
            if not isinstance(args, dict):
                raise ValueError("Tool arguments must be an object.")
            if name == "get_design_state":
                result = {"ok": True, "state": session.snapshot(), 'roomEditPermissions': session.room_permissions}
            elif name == 'edit_room':
                result = edit_room(session, args)
            elif name == "search_catalog":
                matches = search(**args, products=session.products)
                # Geometry and ingestion diagnostics belong in the renderer, not model context.
                fields = {"id", "name", "category", "width", "height", "depth", "price", "currency",
                          "color", "material", "style", "illustrative", "floorLayer", "lighting",
                          "productUrl", "fetchedAt", "availability", "features", "priceNote", 'placement', 'productType'}
                result = {"ok": True, "totalMatches": len(matches),
                          "products": [{k: v for k, v in p.items() if k in fields} for p in matches[:30]],
                          "hint": "Narrow category, price, width or query to explore other matches."}
            elif name == "update_concept":
                session.accept(update_concept(session.state, ConceptUpdate.model_validate(args), session.products))
                session.broadcast_state()
                result = {"ok": True, "state": session.snapshot()}
            elif name == "apply_design_patch":
                patch = DesignPatch.model_validate(args)
                session.accept(apply_patch(session.state, patch, session.products))
                session.broadcast_state()
                session.publish({"type": "design.group", "explanation": patch.explanation, "slotIds": [p.slotId for p in patch.placements]})
                result = {"ok": True, "state": session.snapshot()}
            else:
                result = {"ok": False, "code": "unknown_tool", "message": "Use one of the provided design tools."}
        except DesignError as exc:
            result = {"ok": False, "code": exc.code, "message": str(exc), "state": session.snapshot()}
        except ValidationError as exc:
            result = {"ok": False, "code": "invalid_arguments", "message": str(exc.errors(include_input=False, include_url=False))}
        except (ValueError, TypeError, RecursionError):
            result = {"ok": False, "code": "invalid_arguments", "message": "Supply valid JSON matching the tool schema."}
        session.tool_results[call_id] = result
        if len(session.tool_results) > 500:
            del session.tool_results[next(iter(session.tool_results))]
        return result
