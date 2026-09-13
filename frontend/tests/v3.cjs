const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  module._compile(compiled.outputText, filename)
}
for (const file of ['placement', 'doors', 'alternatives', 'lighting', 'daylightTransport', 'wallFixtures']) require(`../src/${file}.test.ts`)
