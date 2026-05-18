# AAuti WaveBook Integration

This fork replaces Jitsi's built-in Excalidraw whiteboard with the AAuti WaveBook embed. The integration is end-to-end: identity flows through Jitsi's existing JWT token, environment-specific WaveBook URLs flow through `JitsiMeetExternalAPI.configOverwrite`, and whiteboard selection broadcasts to all participants via Jitsi's conference metadata.

## Branching

- **Base branch:** `dnag/custom/10741-whiteboard` (DNAG-INC organization fork, pinned to ~stable_10741)
- **Working branch:** `aauti/wavebook-whiteboard-dnag` (local) → pushes to `custom/10741-whiteboard` on DNAG-INC

To resume work:

```bash
cd D:\workspace\jitsi-meet-aauti
git checkout aauti/wavebook-whiteboard-dnag
git status                         # → up to date with 'dnag/custom/10741-whiteboard'
```

To push commits to the org branch:

```bash
git push dnag HEAD:custom/10741-whiteboard
```

(Requires GitHub `Write` access on `DNAG-INC/jitsi-meet`.)

## What changed (fork web)

All changes are in `react/features/` and `css/`. They are additive — no upstream behavior is broken when the JWT lacks WaveBook claims.

| File | Purpose |
|---|---|
| `react/features/base/config/configType.ts` | `IWhiteboardConfig` gains `apiUrl` and `apiKey` fields |
| `react/features/base/config/configWhitelist.ts` | Whitelists `whiteboard.apiUrl`, `whiteboard.apiKey`, `whiteboard.collabServerBaseUrl` so AAuti React's `configOverwrite` values are honored (default Jitsi whitelist drops everything under `whiteboard.*` except `enabled`) |
| `react/features/whiteboard/functions.ts` | New `getWaveBookJwtContext()` selector decodes JWT and exposes `context.metadata.{sessionId,category,subCategory,instituteId,userRole,members}` + `context.user.{id,name}`. `isWhiteboardButtonVisible` gated to moderators only |
| `react/features/whiteboard/middleware.web.ts` | `setNewWhiteboardOpen()` dispatches `setupWhiteboard` with empty collab details so the reducer flips `isOpen=true` and the picker can render. Removed Excalidraw-only `generateCollaborationLinkData` call. `SET_WHITEBOARD_OPEN` close path no longer re-pins the participant |
| `react/features/whiteboard/actions.web.ts` | New `selectWhiteboardBoard(boardId)` action: dispatches `setupWhiteboard` locally **and** broadcasts to other participants via `conference.getMetadataHandler().setMetadata(WHITEBOARD_ID, ...)`. All participants converge to the moderator's selection |
| `react/features/whiteboard/components/web/Whiteboard.tsx` | In-meeting whiteboard. Renders WaveBook iframe when `collabDetails.roomId` is set; renders `WhiteboardPicker` when empty. Iframe view has a `←` back button that returns to the picker (moderator only) |
| `react/features/whiteboard/components/web/WhiteboardWrapper.tsx` | Standalone whiteboard page (used by mobile / external API). Same WaveBook iframe swap |
| `react/features/whiteboard/components/web/WhiteboardPicker.tsx` (NEW) | Board picker UI: fetches WaveBook boards via REST (`getAll?meta=sessionId:<id>`), renders a grid + "Add Whiteboard" card. Create flow posts to `/api/whiteboard/create` with the full payload shape used by AAuti's `useWaveBookSession.handleWbCreateSubmit` (title, description, users[owner+members], metadata{type, sessionId, category, subCategory, instituteId}) |
| `css/modals/_whiteboard.scss` | `.whiteboard-container .excalidraw-wrapper { height/width: 100%, pointer-events: auto }` — sizing + interactivity fix for the iframe inside the meeting layout |

## What changes outside the fork

These live in their own repos and must ship in coordination.

### AAuti React app (`aautimpwebapplicationreactjs`)

`src/components/calendar/join_class/Jitsi/index.js`

- Passes WaveBook URLs via `options.configOverwrite.whiteboard = { enabled, apiKey, apiUrl, collabServerBaseUrl }`, all sourced from `process.env.REACT_APP_WAVEBOOK_*`. Per-environment routing is owned by AAuti's `.env`

`src/components/calendar/join_class/container.js`

- `generateJWT` data body always includes `sessionId: selected?.sessionId` (matches the existing `handleAttendanceService` convention). Course flows now send both `sessionId` and `batchId` — the backend uses them appropriately

### AAuti Node backend (`aautinodejs`)

`utils/aautiUtil.js` → `generateJwtTokenForJitsi()`

- Imports `SessionModel`
- ChatRoom moderator query: `if (batchId) ... else if (sessionId) ...` — exclusive lookup, courses keep matching by `batchId` even when `sessionId` is also in body
- Session metadata lookup: `findOne({_id: sessionId})` preferred (deterministic); fallback `findOne({"batch._id": batchId, endTime >= now}).sort({startTime:1})` for legacy callers
- JWT payload gains `context.metadata.{sessionId, category, subCategory, instituteId, userRole, members}` where `members` is `[{userId, name, role}]` from ChatRoom moderators (role:`editor`) + members (role:`viewer`), excluding the requester (added later as `owner` by the picker create flow)

### WaveBook backend (`aauti-whiteboard`)

No code change. Per-environment tenant must have the Jitsi domain in `whitelistedOrigins`:

```sql
UPDATE "Tenant"
   SET "whitelistedOrigins" = ARRAY['localhost', 'https://localhost:8443', '<your jitsi domain>']
 WHERE "apiKey" = '<env api key>';
```

For local dev, bare `localhost` matches any port.

## How it flows at runtime

```
AAuti user joins a class
    ↓
AAuti backend mints JWT:
    context.user.{id, name}
    context.metadata.{sessionId, category, subCategory, instituteId, userRole, members}
    moderator: <bool>
    ↓
AAuti React → JitsiMeetExternalAPI with
    options.configOverwrite.whiteboard.{enabled, apiKey, apiUrl, collabServerBaseUrl}
    ?jwt=<token> in URL
    ↓
Jitsi web bundle (this fork):
    JWT decoded → state['features/base/jwt']
    configOverwrite merged into config.whiteboard (now via extended CONFIG_WHITELIST)
    ↓
User clicks "Show whiteboard" (only moderator sees it):
    middleware.web.ts → setNewWhiteboardOpen → setupWhiteboard with empty collab
    reducer: isOpen = true
    ↓
<Whiteboard /> renders → no boardId yet → <WhiteboardPicker />
    Picker fetches GET {apiUrl}/api/whiteboard/getAll?meta=sessionId:<id>
    Picker shows existing boards + "Add Whiteboard" card
    ↓
Moderator picks/creates a board:
    selectWhiteboardBoard(boardId) dispatched
    → setupWhiteboard with real boardId locally
    → conference.getMetadataHandler().setMetadata(WHITEBOARD_ID, {collabDetails:{roomId:boardId}, ...})
    ↓
XMPP broadcasts the metadata change to every participant in the conference
    ↓
Each participant's middleware.any.ts intercepts UPDATE_CONFERENCE_METADATA:
    dispatches setupWhiteboard locally + setWhiteboardOpen(true)
    ↓
Every browser now has collabDetails.roomId set → iframe renders pointing at:
    {collabServerBaseUrl}/embed/{boardId}?userId={jwt.user.id}&userName={jwt.user.name}&apiKey={apiKey}
    ↓
WaveBook's own real-time backend (WebSocket) syncs drawing strokes across users
```

## Building

The fork compiles with `make`, which calls webpack. Because Jitsi's build is Linux-first, we run it in Docker on Windows.

### One-time: build the builder image

```powershell
cd D:\workspace\jitsi-meet-aauti
docker build -f Dockerfile.build -t jitsi-meet-builder .
```

`Dockerfile.build` is just `node:24-bookworm + make + python3 + git`. Takes ~30 seconds.

### Each build

```powershell
docker run --rm `
    -v "${PWD}:/app" `
    -v "jitsi-meet-node-modules:/app/node_modules" `
    -w /app `
    --memory=6g `
    jitsi-meet-builder `
    bash -c "make"
```

Or use the convenience script:

```powershell
.\docker-build.ps1
```

### What the build produces

After ~10 minutes:

```
D:\workspace\jitsi-meet-aauti\
  libs\         ← app.bundle.min.js, lib-jitsi-meet.min.js, ... (~25 MB)
  css\          ← all.css
  static\       ← whiteboard.html and other static pages
  index.html    ← entry page
```

These four are the **deployable artifacts**.

### Build gotchas

- **`node_modules` MUST live in a named Docker volume** (`jitsi-meet-node-modules`). Windows-installed node binaries are not Linux-runnable; mounting your Windows `node_modules` into the Linux container will fail
- **`--memory=6g`** prevents OOM during TerserPlugin (Jitsi's web bundle is large; default Docker memory caps cause silent failure at ~98% sealing)
- After every build, **restart the dev Jitsi web container** (`docker compose restart web` in `D:\workspace\docker-jitsi-meet`) — Docker Desktop's bind-mount loses the inode when `make clean` deletes/recreates files

## Local testing

Local Jitsi backend runs from `D:\workspace\docker-jitsi-meet` (the official Jitsi Docker stack: web + prosody + jicofo + jvb). The web container bind-mounts our built artifacts.

### One-time setup

```powershell
cd D:\workspace\docker-jitsi-meet
docker compose up -d
```

`.env` has `HTTP_PORT=8001` (port 8000 is taken by `aauti-copilot-api`).

`docker-compose.override.yml` bind-mounts our fork's `libs/css/static/index.html` into the web container.

`~/.jitsi-meet-cfg/web/custom-config.js` provides fallback `apiKey/apiUrl/collabServerBaseUrl` for direct-Jitsi access (when no AAuti is in the loop).

### Test through AAuti

1. In AAuti React `.env`, set `REACT_APP_JITSI_DOMAIN=localhost:8443`
2. Visit `https://localhost:8443` once in browser, accept the self-signed cert
3. Start AAuti React + AAuti Node backend
4. Login, join a class → Jitsi loads from local
5. Click "Show whiteboard" (moderator only) → picker → select/create → iframe

### Verifying the JWT and configs

In the Jitsi iframe DevTools console (switch frame context to `localhost:8443`):

```js
// JWT custom claims
JSON.parse(atob(APP.store.getState()['features/base/jwt'].jwt.split('.')[1])).context

// WaveBook config flowing in
APP.store.getState()['features/base/config'].whiteboard

// Iframe URL when board open
document.querySelector('.whiteboard-container iframe')?.src
```

Backend JWT log line confirms session resolution:

```
sessionQuery: <sessionId> <batchId>
generated jwt token for jitsi room: <room>
```

## Deploying

For each environment (dev / sandbox / prod):

### 1. WaveBook DB — whitelist the Jitsi domain

```sql
UPDATE "Tenant"
   SET "whitelistedOrigins" = array_append("whitelistedOrigins", '<your jitsi domain>')
 WHERE "apiKey" = '<env api key>';
```

### 2. AAuti Node backend

```bash
git pull origin <release branch>
pm2 restart aauti-api    # or your process manager
```

### 3. Jitsi server

Two options depending on your infra:

**A. Native install (Jitsi installed via apt)**

```bash
# On the Jitsi server
sudo tar -czf /root/jitsi-backup-$(date +%Y%m%d).tar.gz \
  -C /usr/share/jitsi-meet libs css static index.html

# From your laptop
scp jitsi-aauti-build.tar.gz user@<jitsi-host>:/tmp/

# Back on the server
cd /tmp && sudo tar -xzf jitsi-aauti-build.tar.gz
sudo cp -r libs/* css/* static/* /usr/share/jitsi-meet/
sudo cp index.html /usr/share/jitsi-meet/
sudo chown -R www-data:www-data /usr/share/jitsi-meet/

# Add the WaveBook config (only needed once per server)
sudo tee -a /etc/jitsi/meet/<domain>-config.js > /dev/null <<'EOF'

config.whiteboard = { enabled: true };
EOF

sudo systemctl reload nginx
```

**B. docker-jitsi-meet based**

Either bind-mount the built `libs/css/static/index.html` into the running `web` container, or build a derived image:

```dockerfile
# Dockerfile.deploy (add this to the fork when needed)
FROM jitsi/web:stable

COPY libs        /usr/share/jitsi-meet/libs/
COPY css         /usr/share/jitsi-meet/css/
COPY static      /usr/share/jitsi-meet/static/
COPY index.html  /usr/share/jitsi-meet/
```

```bash
docker build -f Dockerfile.deploy -t dnag/jitsi-web:1.0.0 .
docker push dnag/jitsi-web:1.0.0
# Then on the Jitsi host, update docker-compose.yml's web.image and:
docker compose up -d web
```

### 4. Smoke test

- Open Jitsi domain in browser
- Create a test meeting
- Click whiteboard → picker appears
- Create a board → iframe loads
- Decode JWT, confirm `context.metadata.sessionId` matches expectations

### 5. Rollback (always rehearse this first)

```bash
sudo rm -rf /usr/share/jitsi-meet/{libs,css,static,index.html}
sudo tar -xzf /root/jitsi-backup-YYYYMMDD.tar.gz -C /usr/share/jitsi-meet/
sudo systemctl reload nginx
```

~30 seconds to fully revert.

## Order of deploy

Doing the deploys in this order keeps users uninterrupted at every step:

1. **WaveBook DB** — whitelist Jitsi origin (no user impact yet)
2. **AAuti Node backend** — JWT now carries metadata, but old Jitsi web ignores it (no breakage)
3. **Jitsi web** — the actual cutover (users now see WaveBook picker)

## Known limitations / next steps

- **Multi-environment whitelisting** — each env's WaveBook tenant has its own `whitelistedOrigins`. Must be updated per env, not just once
- **Late joiners after `endTime`** — backend's session-by-batch fallback uses `endTime >= now`. Users joining a long-overrun session get `metadata.sessionId` undefined → picker shows all their boards. If this matters operationally, widen the time window or fall back to the most recent past session
- **Members in the JWT for very large classes** — current encoding is `[{userId, name, role}]` per member. ~50 chars × N members. Fine up to ~1000 members. Beyond that, consider trimming `name` or resolving members server-side at create time
- **Test artifacts in working tree** — `build.log`, `static/local-test/whiteboard.html` are dev-only and should NOT be committed. Add to `.gitignore` before committing the integration

## Quick reference

| Need | Command |
|---|---|
| Switch to working branch | `git checkout aauti/wavebook-whiteboard-dnag` |
| Rebuild after edit | `docker run --rm -v ${PWD}:/app -v jitsi-meet-node-modules:/app/node_modules -w /app --memory=6g jitsi-meet-builder bash -c "make"` |
| Refresh local Jitsi to pick up new bundle | `cd D:\workspace\docker-jitsi-meet && docker compose restart web` |
| Push to org repo | `git push dnag HEAD:custom/10741-whiteboard` |
| Decode current JWT in browser | `JSON.parse(atob(APP.store.getState()['features/base/jwt'].jwt.split('.')[1])).context` |
| List boards being fetched | DevTools → Network tab → filter `getAll` |