# MiniMax Music adapter

After `prepare` and the creator’s explicit confirmation through `confirm`, call `creative_produce_run` with the prepared `job_id` and matching adapter. Do not replace the job with stdin or extra arguments:

```json
{"entry":"drama","adapter":"minimax-music","job_id":"<prepared and confirmed job_id>","workdir":"<project>"}
```

Environment names below describe the adapter process. DSH resolves credentials and provider settings from the production profile and credential store; do not export keys or place them in tool arguments or project files.

Required environment: `MINIMAX_API_KEY`. `MINIMAX_BASE_URL` optionally overrides the default
`https://api.minimax.io/v1` and must remain HTTPS.

The job uses the suite's `music` modality and must have exactly one output. The production prompt becomes the
music style/mood prompt. Supported public parameters are `lyrics`, `is_instrumental`, `sample_rate`,
`bitrate`, and `format`. Vocal jobs require exact accepted lyrics. The requested format must match the target extension
and be `mp3` or `wav`.

For this confirmed-production profile, `lyrics_optimizer` is rejected even when `true` is requested: supplier-authored lyrics would not have
appeared in the preview and cannot satisfy creator ownership or licensing. A vocal job therefore requires the exact
accepted lyrics; an instrumental job carries neither lyrics nor an optimizer request.

The request always uses model `music-3.0`, non-streaming `output_format: hex`, and
`POST /music_generation`. The adapter validates `base_resp.status_code`, decodes `data.audio` as hexadecimal bytes,
and writes it to a private temporary file.

Protocol reference: [MiniMax Music Generation](https://platform.minimax.io/docs/api-reference/music-generation).
