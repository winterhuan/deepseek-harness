---
description: "The creative production settings page on the dsh web client's Plugins page: six provider keys and the runtime profile they authorize."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-creative-produce

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Creative production** in the Official group to set the six provider keys and the runtime profile (models, endpoints, voice routing) they authorize. The page stages what is typed and writes it only on save; keys are written through the credentials domain rather than the settings document, so their literals never ride a response. The page exists while the Host serves the `creative-produce` namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Controls group by provider — OpenAI (image), Seedance video (Volcengine Ark), MiniMax (video and music), MiMo (video understanding and voice), Fish Audio (voice fallback), and Agnes (image and video) — so one provider's key, endpoint, and model sit together; voice routing closes the page. Each **API key** control starts blank on every load and reports only whether a key is configured; a blank draft keeps the stored key. **Manage keys in bulk** opens a dialog that stores a whole key pool as one write, one key per line. Profile fields render the effective value, carry an **Overridden** badge with **Reset to default** once overridden, and save as a reset when emptied. Nothing is written until **Save**; leaving the page drops the drafts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `creative-produce` namespace through `ctx.configForms.get` and keeps the staged form in `CreativeProduceCardController` over the shared `SettingsFormModel` of `ui-primitives`, with the six provider keys as the form's secret controls: each write goes to `remote.credentials.set` under the reference its section field names (the provider's default environment key when it names none), and success is read back from one batched `remote.credentials.describe` call. The controller re-reads the credentials when the scope changes and when the Host reports `credentials/reference-updated` for a watched reference, since a key written on another surface changes no settings section. The page registers `CreativeProduceCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [credentials](../../credentials/README.md) — the credential-reference seam the keys write through.
- [creative](../../creative/creative/README.md) — the production adapters that register the namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Namespace coverage** — the page edits the six provider keys and the runtime profile fields the production adapters declare; provider-specific capabilities outside that section are not surfaced here.
- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from the settings mirror and the credentials domain, and what it writes the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
