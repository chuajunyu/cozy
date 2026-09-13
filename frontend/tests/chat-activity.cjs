const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ChatActivity = require('../src/ChatActivity.tsx').default
const reference = { slotId: 'desk', name: 'Oak desk', category: 'desk' }
const change = { key: 'item:desk', label: 'Rotated', actions: ['rotated'], reference, detail: null }
const message = changes => ({ id: 'first', role: 'system', kind: 'activity', text: 'Updated your room', activity: { changes, editCount: 3, latestRequestId: 'third', steering: true } })
const render = (changes, deliveries = {}, working = true) => renderToStaticMarkup(React.createElement(ChatActivity, { message: message(changes), deliveries, working, state: { slots: { desk: {} } }, onSelect: () => {} }))

test('one object stays inline and only the newest request can supply its receipt', () => {
  const html = render([change], { first: { stage: 'applied', kind: 'activity', owner: 'first' } })
  assert.ok(!html.includes('<details>'))
  assert.ok(html.includes('Oak desk') && html.includes('Saved to room'))
  assert.ok(!html.includes('Received by Astra'))
  assert.ok(render([change], { third: { stage: 'applied', kind: 'activity', owner: 'first' } }).includes('Received by Astra'))
})

test('multi-setting details expose individual settings rather than repeating the summary', () => {
  const html = render([{ key: 'room', label: 'Updated wall colors and sunlight', actions: ['wall colors', 'sunlight'], reference: null, detail: null }])
  assert.ok(html.includes('<details>') && html.includes('3 edits'))
  assert.ok(html.includes('Updated wall colors</div>'))
  assert.ok(html.includes('Updated sunlight</div>'))
})

test('multiple objects expand into one named summary per object', () => {
  const html = render([change, { ...change, key: 'item:chair', reference: { ...reference, slotId: 'chair', name: 'Chair' } }])
  assert.ok(html.includes('<details>') && html.includes('Oak desk') && html.includes('Chair'))
  assert.equal((html.match(/class="activity-change"/g) || []).length, 2)
})
