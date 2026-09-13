"""Shared illustrative bulb profiles and atomic lighting transactions."""
import json
from pathlib import Path
from typing import Literal

from pydantic import Field
from backend.design import LightSettings, Model, require, validate_layout

DEFINITIONS = json.loads((Path(__file__).parents[1] / 'data/bulb-profiles.json').read_text())
PROFILES = DEFINITIONS['profiles']
PRESETS = DEFINITIONS['presets']


class LightingEdit(Model):
    requestId: str
    baseRevision: int = Field(ge=0)
    preset: Literal['daytime', 'cozy', 'focus']


def preset_settings(state, products, preset):
    definition = PRESETS[preset]
    fixtures = {}
    for id, slot in state.slots.items():
        lighting = products.get(slot.catalogId, {}).get('lighting')
        if not lighting:
            continue
        settings = slot.light.model_copy(deep=True) if slot.light else LightSettings()
        settings.on = definition['on']
        profile = definition['profile']
        if profile and lighting['colorMode'] != 'fixed':
            settings.color = PROFILES[profile]['color']
            settings.bulbProfile = profile if lighting['colorMode'] == 'bulb-dependent' else None
        fixtures[id] = settings
    return definition['sunHour'], fixtures


def apply_lighting(state, products, sun_hour, fixtures):
    require(sun_hour is not None, 'sun_time', 'Supply the lighting preview time.')
    result = state.model_copy(deep=True)
    result.room.sunHour = sun_hour
    require(len(fixtures) <= 8, 'fixture_limit', 'A room supports eight fixtures.')
    for id, settings in fixtures.items():
        require(id in result.slots and products.get(result.slots[id].catalogId, {}).get('lighting'),
                'not_fixture', 'Choose an existing light fixture.')
        result.slots[id].light = settings
    validate_layout(result, products, check_budget=False)
    return result


def edit_lighting(session, raw):
    command = LightingEdit.model_validate(raw)
    require(command.baseRevision == session.state.revision, 'stale_revision', 'Read the current room first.')
    grants = session.room_permissions.get(command.requestId, [])
    grant = next((g for g in grants if g.get('operation') == 'lighting.apply' and g.get('preset') == command.preset), None)
    require(grant is not None, 'architecture_permission', 'A named lighting preset needs an explicit user request.')
    hour, fixtures = preset_settings(session.state, session.products, command.preset)
    state = apply_lighting(session.state, session.products, hour, fixtures)
    grants.remove(grant)
    if state != session.state:
        state.revision += 1
        session.accept(state)
        session.broadcast_state()
    return {'ok': True, 'state': session.snapshot()}
