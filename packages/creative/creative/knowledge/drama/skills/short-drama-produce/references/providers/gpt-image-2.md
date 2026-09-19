# GPT Image 2 adapter

After `prepare` and the creator’s explicit confirmation through `confirm`, call `creative_produce_run` with the prepared `job_id` and matching adapter. Do not replace the job with stdin or extra arguments:

```json
{"entry":"drama","adapter":"gpt-image-2","job_id":"<prepared and confirmed job_id>","workdir":"<project>"}
```

Environment names below describe the adapter process. DSH resolves credentials and provider settings from the production profile and credential store; do not export keys or place them in tool arguments or project files.

Required environment: `OPENAI_API_KEY`. `OPENAI_BASE_URL` optionally overrides the default
`https://api.openai.com/v1` and must remain HTTPS.

The job must have modality `image` and exactly one output. With no references, the adapter sends JSON to
`POST /images/generations`. With one to sixteen references, it sends an `image[]` multipart edit to
`POST /images/edits`. The model is always `gpt-image-2`, `n` is always one, and the single returned `b64_json` image is
written to a private temporary file.

Supported public parameters are `width` plus `height` (compiled to `size`), or `size`, and `quality`, `background`, and
`moderation`. References use GPT Image 2's high-fidelity behavior without sending the older `input_fidelity` field.
Transparent backgrounds are rejected because GPT Image 2 does not support them. The output extension selects `png`,
`jpeg`, or `webp`.

Protocol references: [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2),
[image generation](https://developers.openai.com/api/reference/resources/images/methods/generate), and
[image edits](https://developers.openai.com/api/reference/resources/images/methods/edit).
