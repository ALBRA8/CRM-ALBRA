# WhatsApp production readiness

This checklist covers the two existing WhatsApp transports in CRM ALBRA. **Choose one transport per business number for production**; do not enable Cloud API auto-replies and the Baileys daemon for the same inbound traffic unless an explicit routing policy prevents duplicate replies.

## Transport and secrets

### WhatsApp Web / Baileys daemon
- Run `bun run wa:daemon` as a supervised service, not as an interactive terminal process.
- Set a unique `INTERNAL_API_SECRET` of at least 24 characters in both the CRM server and daemon environment.
- Set `NEXT_APP_URL` to the private CRM origin reachable from the daemon.
- Persist `src/whatsapp-daemon/.wa-auth` on a private persistent volume. Do not commit session credentials or expose the daemon port publicly.
- Pair via the authenticated CRM UI; the session must be linked to exactly one organization.
- Keep the daemon behind a private network or reverse proxy with TLS and strict access control.

### WhatsApp Cloud API
- Configure `WHATSAPP_VERIFY_TOKEN` as a separate random value. It is not the Meta App Secret.
- Configure the Meta App Secret, WhatsApp Phone Number ID, and Cloud API access token in the organization's encrypted integration settings.
- Publish `/api/whatsapp/webhook` over HTTPS and subscribe the Meta app to messages.
- POST requests must carry a valid `X-Hub-Signature-256`; invalid signatures are rejected.
- Confirm the Meta phone-number ID matches the integration record before processing.

## Images and vision
- In **Configuración → Agente IA**, configure a provider/base URL/API key/model that supports OpenAI-compatible multimodal `chat/completions` with `image_url` data URLs. Text-only models will fail closed.
- Incoming images are limited to 8 MiB and JPEG, PNG, WebP, or GIF. The server checks the MIME declaration, binary signature, decoded format, and a 40-megapixel pixel limit before sending the image to the model.
- Captions are included as context. If download, validation, or vision analysis fails, the message is retained as a human-review item and the agent does not automatically invent an image description.

## Voice
- Inbound voice notes are downloaded with a 25 MiB cap. The CRM first attempts a dedicated OpenAI-compatible ASR endpoint when `ASR_API_KEY` is configured (`ASR_BASE_URL` defaults to `https://api.openai.com/v1`; model defaults to `whisper-1`, overridable with `ASR_MODEL`). Otherwise it attempts the organization's configured LLM endpoint, then falls back to the existing ZAI ASR adapter. A separate ASR key is recommended when the LLM provider does not expose speech transcription. A successful transcript is passed to the agent.
- If ASR is unavailable or returns no usable transcript, the message is surfaced for human review and no automatic reply is generated from invented transcript text.
- **Outbound spoken responses / TTS are not implemented by this change**; the agent currently replies with text.

## Required staging acceptance
- Text message: one inbound message, one stored inbound record, at most one automated reply.
- Image with caption: correct caption + visual description in context; no false claims about unreadable content.
- Corrupt, unsupported, oversized, or high-pixel image: rejected safely and routed to human review.
- Voice note: transcribed text is visible and the agent answers from the transcript; failed transcription is visible and does not trigger an automatic answer.
- Duplicate delivery: resend the same Baileys event and Cloud webhook; verify no duplicate AI reply or duplicate notification.
- Reconnect after network loss; verify status recovers and the daemon does not start duplicate sockets.
- Cross-organization request: verify one organization's secret/session cannot read or mutate another organization's conversations.
- Confirm logs redact tokens, message content, and image/audio bytes; rotate any secret that was previously pasted into chat or logs.

CI passing is necessary but not sufficient: QR pairing, Meta credentials, real ASR/vision provider behavior, outbound delivery, and reconnect behavior must be validated against staging/PC before calling the integration production-ready.

## Current integration boundary
The Baileys daemon still calls the CRM's `/api/chat` endpoint. It is not yet routed through the separate AGENTE-GENERAL runtime. Keep that agent-runtime integration as a separate migration after the general agent and channel contract are accepted.
