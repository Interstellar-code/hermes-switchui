---
title: Unraid deployment
description: Run Hermes Switch UI and the Hermes Agent gateway together in a single self-contained Unraid container.
---

# Unraid deployment: Hermes Switch UI self-contained image

This deployment uses one container that includes both Hermes Switch UI and the upstream Hermes Agent gateway. The UI talks to the bundled gateway over container-local loopback (`http://127.0.0.1:8642`).

## Recommended Unraid settings

| Setting | Value |
| --- | --- |
| Repository | `ghcr.io/interstellar-code/hermes-switchui:latest` |
| Network Type | `bridge` |
| WebUI | `http://[IP]:[PORT:3000]/` |
| Port | host `3000` → container `3000/tcp` |
| Appdata path | `/mnt/user/appdata/hermes-switchui` → `/opt/data` read/write |
| PUID / PGID | `99` / `100` on standard Unraid |
| Required env | `HERMES_PASSWORD=<strong secret>` |
| Extra Parameters | `--restart=unless-stopped --shm-size=1g` |
| Internal data env | `HERMES_HOME=/opt/data` |

Unraid's own Docker docs recommend bridge mode for most applications because only explicitly mapped ports are reachable, and they recommend keeping application data in appdata-style host paths so updates do not wipe state.

## Template import

Template file in this repo:

```text
deploy/unraid/hermes-switchui.xml
```

Copy it to the Unraid flash drive, commonly:

```text
/boot/config/plugins/dockerMan/templates-user/my-hermes-switchui.xml
```

Then open **Docker → Add Container** and select the template.

## First start checklist

1. Set `HERMES_PASSWORD`.
2. Add one provider key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, etc.) or configure a local provider during onboarding.
3. Keep container port `3000` unchanged; only change the host port if needed.
4. Keep `HERMES_HOME=/opt/data`; it must match the appdata mount target.
5. Keep `PUID=99` and `PGID=100` unless your Unraid appdata ownership policy differs.
6. Start the container.
7. Open `http://<unraid-ip>:3000/`.
8. Check logs if startup fails:

```bash
docker logs hermes-switchui
```

## Optional agent API exposure

The bundled Hermes Agent gateway listens on `127.0.0.1:8642` inside the container by default. Do not publish it unless another host process needs direct API access. If you expose it, set a strong `API_SERVER_KEY` and set `HERMES_API_TOKEN` to the same value.

## Advanced logging

Set `HERMES_LOG_LEVEL=DEBUG` only while troubleshooting Hermes Agent runtime issues such as platform adapters, Matrix E2EE, or MCP startup. Leave it blank for normal INFO-level logs.

## Runtime test command

On an Unraid shell after creating the container:

```bash
docker ps --filter name=hermes-switchui
docker logs --tail 100 hermes-switchui
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo "Switch UI HTTP OK"
```
