# Model directory

Place the GLiNER ONNX weights here before starting the proxy. Files are stored under
`<repo>/onnx/<variant>` — keeping the repo name and the original filename — so the
variant and source are unambiguous from the path.

1. Open the Hugging Face page: https://huggingface.co/onnx-community/gliner_medium-v2.1
2. Go into the `onnx/` directory and download a model file (e.g. `model_fp16.onnx`).
3. Drop it here, keeping the repo name and `onnx/` folder:

   ```
   model/gliner_medium-v2.1/onnx/model_fp16.onnx
   ```

This is the default path. Point `GLINER_MODEL_PATH` elsewhere to use a different
variant or location (e.g. `.../onnx/model_int8.onnx`).

The tokenizer files are fetched automatically from Hugging Face on first run (repo id
`GLINER_TOKENIZER`, default `onnx-community/gliner_medium-v2.1`) and cached under
`model/.cache/` (override with `GLINER_CACHE_DIR`) — kept here so the cache survives a
`node_modules` reinstall. Only the larger ONNX weights are loaded from the local file
above.
