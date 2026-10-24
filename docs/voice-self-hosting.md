# Optional voice-model hosting

Voice models stay on the device for inference. By default, Transformers.js downloads the model files from Hugging Face and stores them in the browser cache. Leave `VITE_VOICE_MODEL_HOST` empty unless you have a concrete reason to serve the files yourself.

## Configure a custom host

Set `VITE_VOICE_MODEL_HOST` in the frontend build environment to the HTTPS origin that serves the model folders, with or without a trailing slash. For Cloudflare Pages, configure it for both Production and Preview. This is a public URL, not a secret. After changing it, rebuild and redeploy because Vite embeds `VITE_` values into the browser bundle.

The worker sets the documented Transformers.js options `env.remoteHost` and `env.remotePathTemplate = '{model}/{file}'`. The host therefore needs this layout:

```text
<host>/onnx-community/moonshine-tiny-ONNX/config.json
<host>/onnx-community/moonshine-tiny-ONNX/onnx/encoder_model_quantized.onnx
<host>/onnx-community/moonshine-tiny-ONNX/onnx/decoder_model_merged_quantized.onnx
<host>/onnx-community/whisper-base.en/config.json
<host>/onnx-community/whisper-base.en/onnx/encoder_model.onnx
<host>/onnx-community/whisper-base.en/onnx/decoder_model_merged.onnx
```

For Moonshine Tiny (`q8` on WASM), the files requested from the ONNX directory are `encoder_model_quantized.onnx` (7.94 MB) and `decoder_model_merged_quantized.onnx` (20.2 MB). For Whisper Base English on WebGPU with the default dtype, Transformers.js selects fp32: `encoder_model.onnx` (82.5 MB) and `decoder_model_merged.onnx` (209 MB). It also loads the model config, tokenizer, and processor metadata from each model's root. Mirror the full root metadata and matching tokenizer files from the source model repositories rather than copying only the ONNX weights:

- [Moonshine Tiny model files](https://huggingface.co/onnx-community/moonshine-tiny-ONNX/tree/main)
- [Moonshine Tiny ONNX file tree](https://huggingface.co/onnx-community/moonshine-tiny-ONNX/tree/main/onnx)
- [Whisper Base English model files](https://huggingface.co/onnx-community/whisper-base.en/tree/main)
- [Whisper Base English ONNX file tree](https://huggingface.co/onnx-community/whisper-base.en/tree/main/onnx)

## Cloudflare hosting note

Cloudflare Pages limits each individual static asset to 25 MiB, so it cannot serve the 82.5 MB and 209 MB Whisper Base files. Use the Hugging Face default, or store the model files in a public Cloudflare R2 bucket attached to a custom domain. R2 supports much larger objects. If you put the model host on a different origin from Taskflow, configure CORS to allow `GET` requests from the exact production and preview Taskflow origins. [Pages file limits](https://developers.cloudflare.com/pages/platform/limits/), [R2 object limits](https://developers.cloudflare.com/r2/platform/limits/), and [R2 CORS setup](https://developers.cloudflare.com/r2/buckets/cors/) are documented by Cloudflare.

Do not download or commit model weights into this repository. If this project is ever moved back to Netlify, its model downloads count toward bandwidth usage, so keep the Hugging Face default unless there is a clear reason to self-host.
