const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ideaMessageId } = require('../src/ideaMessage.ts')

test('idea results remain attached to their request after follow-ups and duplicate briefs', () => {
  const messages = [{ id: 'ideas', role: 'user', text: '/ideas Calm room' }, { id: 'later', role: 'user', text: 'Change the desk' }, { id: 'repeat', role: 'user', text: '/ideas Calm room' }]
  assert.equal(ideaMessageId({ requestMessageId: 'ideas', request: 'Calm room' }, messages), 'ideas')
  assert.equal(ideaMessageId({ requestMessageId: 'gone', request: 'Calm room' }, messages), null)
  assert.equal(ideaMessageId({ request: 'Calm room' }, messages), 'repeat')
  assert.equal(ideaMessageId(null, messages), null)
})
