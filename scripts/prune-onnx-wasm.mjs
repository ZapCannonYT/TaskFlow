import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

const assetsDirectory = path.resolve('dist/assets')
const assetNames = await readdir(assetsDirectory)
const workerNames = assetNames.filter(name => /^whisper\.worker-.*\.js$/.test(name))

if (workerNames.length === 0) {
  throw new Error('Cannot confirm the voice worker CDN runtime configuration; keeping ONNX WASM assets.')
}

const workerSources = await Promise.all(workerNames.map(name => readFile(path.join(assetsDirectory, name), 'utf8')))
if (!workerSources.some(source => source.includes('cdn.jsdelivr.net/npm/onnxruntime-web@'))) {
  throw new Error('The voice worker no longer points ONNX Runtime WASM at its matching CDN build; keeping local WASM assets.')
}

const wasmAssets = assetNames.filter(name => /^ort-wasm-.*\.wasm$/.test(name))
for (const name of wasmAssets) {
  await rm(path.join(assetsDirectory, name))
}

console.log(`Removed ${wasmAssets.length} unused bundled ONNX WASM asset(s); the voice worker loads its version-matched runtime from jsDelivr.`)
