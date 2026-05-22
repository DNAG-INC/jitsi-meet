# Whiteboard Changes — Analysis

Analysis of all custom whiteboard modifications on branch `custom/10741-whiteboard` versus upstream Jitsi's default Excalidraw-based whiteboard. The fork replaces Excalidraw with the **AAuti WaveBook** embed, gates whiteboard access to moderators, and coordinates board selection across participants through conference metadata.

> A more deployment-oriented doc already exists at [AAUTI-WAVEBOOK-INTEGRATION.md](AAUTI-WAVEBOOK-INTEGRATION.md). This file is the *code-level analysis* — what files changed, what each change does, and how they fit together.

## Sibling repos (local checkouts)

The Jitsi fork is one of four repos that ship the WaveBook whiteboard feature together. All four are checked out locally on this machine:

| Repo | Local path | Role |
|---|---|---|
| `jitsi-meet` (this fork) | `d:\workspace\jitsi-meet-1` | The embedding shell. Renders the WaveBook iframe in place of Excalidraw, broadcasts board selection via conference metadata |
| `aautimpwebapplicationreactjs` | `D:\workspace\aautimpwebapplicationreactjs` | AAuti React webapp. Embeds Jitsi via `JitsiMeetExternalAPI`, passes `configOverwrite.whiteboard.{apiUrl,apiKey,collabServerBaseUrl}` |
| `aautinodejs` | `D:\workspace\aautinodejs` | AAuti Node backend. Mints the JWT (`utils/aautiUtil.js` → `generateJwtTokenForJitsi`) with `context.user` + `context.metadata.{sessionId, category, subCategory, instituteId, members}` |
| `aauti-whiteboard` | `d:\workspace\aauti-whiteboard` | WaveBook backend. The whiteboard service Jitsi iframes; exposes REST + WebSocket. Tenant table's `whitelistedOrigins` must include the Jitsi domain |

---

## 1. Commit history (fork-only)

| Commit | Author | Scope |
|---|---|---|
| `21bef9490` | Prashanth Ch | `aauti whiteboard changes` — the big bang: introduces WaveBook integration (14 files, +1072/−127) |
| `d835c8934` | Vamshikrishna | `fix(whiteboard): same-board reselect + broadcast hide to all participants` (6 files, +56/−7) |
| **uncommitted** | — | Moderator board switch now merges participants into board's `users[]`; new [services.ts](react/features/whiteboard/services.ts) helper |

---

## 2. File-by-file map

### Configuration plumbing

| File | Change |
|---|---|
| [react/features/base/config/configType.ts](react/features/base/config/configType.ts) | `IWhiteboardConfig` gains `apiUrl` and `apiKey` fields so the AAuti React app can pass WaveBook credentials via `configOverwrite.whiteboard` |
| [react/features/base/config/configWhitelist.ts](react/features/base/config/configWhitelist.ts) | Whitelists `whiteboard.apiUrl`, `whiteboard.apiKey`, `whiteboard.collabServerBaseUrl`. Default Jitsi whitelist drops everything under `whiteboard.*` except `enabled`, so without this `configOverwrite` values are silently discarded |

### Selectors and shared functions

[react/features/whiteboard/functions.ts](react/features/whiteboard/functions.ts)

- **New: `getWaveBookJwtContext(state)`** — decodes the JWT in `state['features/base/jwt']` and pulls AAuti's custom claims: `context.user.{id,name}` and `context.metadata.{sessionId, userRole, category, subCategory, instituteId, members}`. Returns `null` on missing/invalid JWT.
- **New types:** `IWaveBookMember`, `IWaveBookJwtContext`.
- **Policy change: `isWhiteboardButtonVisible`** — gated to moderators only (`isWhiteboardEnabled && isLocalParticipantModerator`). Non-moderators never see the toggle; they receive the whiteboard automatically when a moderator opens one.

### Actions ([react/features/whiteboard/actions.web.ts](react/features/whiteboard/actions.web.ts))

- **New action: `selectWhiteboardBoard(boardId)`** — the central mechanism that propagates a board selection to every participant:
  1. Builds `collabData = { collabDetails: { roomId: boardId, roomKey: '' }, collabServerUrl }`.
  2. Locally dispatches `setupWhiteboard(collabData)`.
  3. Calls `conference.getMetadataHandler().setMetadata(WHITEBOARD_ID, collabData)` so the change rides Jitsi's existing conference-metadata channel to every other browser.
  4. **(uncommitted)** If moderator and `apiUrl`/`apiKey` are configured: collects all remote participants, maps `moderator → editor` / others → `viewer`, and fires `mergeUsersIntoBoard(boardId, users, params)` from [services.ts](react/features/whiteboard/services.ts). This handles the "moderator switches boards mid-call" case so the newly-shown board has the current roster in its `users[]`.
- `restrictWhiteboard` / `toggleWhiteboard` kept from upstream.

### Services ([react/features/whiteboard/services.ts](react/features/whiteboard/services.ts)) — new, uncommitted

WaveBook REST helpers used by [actions.web.ts](react/features/whiteboard/actions.web.ts):

- `fetchBoard(boardId, params)` — `GET /api/whiteboard/:id`, tolerant of multiple response shapes (`json.data.board | json.board | json.data | json`).
- `updateBoardUsers(boardId, users, params)` — `PUT /api/whiteboard/update` with `{ id, users }`.
- `mergeUsersIntoBoard(boardId, users, params)` — fetch existing users, set-diff by `userId`, only PUT if there's something to add. Idempotent.
- Shared `buildHeaders` puts `x-api-key`, `x-user-id`, `x-user-name`, `Content-Type: application/json`.

### Middleware

[react/features/whiteboard/middleware.web.ts](react/features/whiteboard/middleware.web.ts)

- `setNewWhiteboardOpen` rewritten: dispatches `setupWhiteboard` with **empty** `collabDetails` so the reducer flips `isOpen=true` and the picker can render. The original Excalidraw `generateCollaborationLinkData` call is gone.
- **(commit `d835c8934`)** On hide (the moderator closes the panel), if `existingCollabDetails?.roomId && isLocalParticipantModerator`, broadcast `{ closed: true }` via `conference.getMetadataHandler().setMetadata(WHITEBOARD_ID, ...)`. The guard prevents a re-broadcast loop when the listener path comes back through `resetWhiteboard` + `setWhiteboardOpen(false)`.
- `SET_WHITEBOARD_OPEN` close path no longer re-pins the participant.

[react/features/whiteboard/middleware.any.ts](react/features/whiteboard/middleware.any.ts)

- **(commit `d835c8934`)** Inbound `UPDATE_CONFERENCE_METADATA` listener now branches on the payload:
  - `wb.closed === true` → `resetWhiteboard()` + `setWhiteboardOpen(false)`.
  - `wb.collabDetails?.roomId` → `setupWhiteboard(...)` + `setWhiteboardOpen(true)`. The `roomId` check is more defensive than the previous "any `collabDetails`" check — guards against malformed metadata.

### Components ([react/features/whiteboard/components/web/](react/features/whiteboard/components/web/))

[Whiteboard.tsx](react/features/whiteboard/components/web/Whiteboard.tsx)

- Renders the **WaveBook iframe** at `${collabServerBaseUrl}/embed/{boardId}?userId&userName&apiKey` when `collabDetails.roomId` is set; renders `<WhiteboardPicker />` (moderator-only) or a "Waiting for the host…" placeholder (non-moderators) otherwise.
- Iframe view has a `←` back button (moderator-only) that flips local `forcePicker=true` to return to the picker without affecting other participants.
- **(commit `d835c8934`)** A `useEffect` on `[ boardId ]` resets `forcePicker` whenever a new board id arrives, *plus* the picker now calls back via the new `onSelect` prop. The combination handles the **re-select-same-board** case: if `boardId` doesn't change between selections, the `[boardId]` effect alone can't detect it, so the explicit callback is what flips the view back.
- All identity/labels prefer `jwtCtx?.userName/userId` over `localParticipant.{name,id}`.

[WhiteboardPicker.tsx](react/features/whiteboard/components/web/WhiteboardPicker.tsx) — new in `21bef9490`

- Board grid + "Add Whiteboard" card.
- `loadBoards()` → `GET /api/whiteboard/getAll?meta=sessionId:<id>`. Tolerant of `json.data.boards | json.data | json.boards`.
- `handleCreate()` → `POST /api/whiteboard/create` with payload mirroring AAuti React's `useWaveBookSession.handleWbCreateSubmit`:
  ```
  { title, description: '',
    users: [ { userId, name, role: 'owner' }, ...members ],
    metadata: { type: 'blank', sessionId?, category?, subCategory?, instituteId? } }
  ```
  Members from JWT (`jwt.context.metadata.members`) already exclude the requester server-side, so prepending the creator as `owner` won't duplicate.
- **Title validation:** minimum 5 characters (matches the backend constraint).
- **(commit `d835c8934`)** Accepts an `onSelect?: () => void` prop and fires it after both pick and create. Parent uses it to clear the `forcePicker` override (see Whiteboard.tsx above).
- **(uncommitted)** A `console.log('WhiteboardPicker context', { ... })` was added for debugging — should be removed before commit.

[WhiteboardWrapper.tsx](react/features/whiteboard/components/web/WhiteboardWrapper.tsx)

- Standalone whiteboard page (mobile / external-API use). Same WaveBook iframe swap as the in-meeting component.

### Styles ([css/modals/_whiteboard.scss](css/modals/_whiteboard.scss))

- `21bef9490`: `.whiteboard-container .excalidraw-wrapper { height/width: 100%; pointer-events: auto }` so the iframe fills the meeting layout.
- `d835c8934`: explicit `100vh/100vw` rules on the *standalone* `.whiteboard` page because that page now renders the iframe directly (no inner `.excalidraw-wrapper`), and without the parent dimensions the iframe collapses to 0.

### Build / infra (not React code, but part of the same change set)

- `.dockerignore`, `Dockerfile`, `Dockerfile.build`, `docker-build.ps1` — Linux-in-Docker build pipeline used on Windows hosts.
- `.gitignore` — `d835c8934` adds `build.log`, `build-css.log`, `static/local-test/`.
- `docker-watch.ps1` (uncommitted, untracked) — local dev convenience.

---

## 3. Runtime flow

```
Moderator clicks "Show whiteboard"
   │
   ▼
toggleWhiteboard → setWhiteboardOpen(true)
   │
   ▼
middleware.web.ts: setNewWhiteboardOpen
   → setupWhiteboard({ collabDetails: { roomId:'', roomKey:'' }, collabServerUrl:'' })
   → reducer: isOpen=true, collabDetails empty
   │
   ▼
<Whiteboard /> renders. No boardId → <WhiteboardPicker />
   │
   ▼
Picker: GET {apiUrl}/api/whiteboard/getAll?meta=sessionId:<id>
   → renders grid + "Add Whiteboard" card
   │
   ▼
Moderator picks (or creates) a board → selectWhiteboardBoard(boardId)
   ├─ local dispatch: setupWhiteboard with real boardId
   ├─ conference metadata broadcast: { collabDetails:{roomId, roomKey:''}, collabServerUrl }
   └─ (moderator-only) mergeUsersIntoBoard(boardId, currentRoster, params)
        — fire-and-forget HTTP merge of remote participants into board.users[]
   │
   ▼
Every other participant's middleware.any.ts intercepts
   UPDATE_CONFERENCE_METADATA[WHITEBOARD_ID]:
   → setupWhiteboard(...) + setWhiteboardOpen(true)
   │
   ▼
<Whiteboard /> renders iframe pointing at
   {collabServerBaseUrl}/embed/{boardId}?userId&userName&apiKey
   │
   ▼
WaveBook's own WebSocket backend syncs drawing strokes between users.
```

**Close path (moderator hides):**

```
SET_WHITEBOARD_OPEN with isOpen=false
   │
   ▼
middleware.web.ts (moderator + existing roomId guard):
   → conference metadata broadcast: { closed: true }
   │
   ▼
Every participant's middleware.any.ts:
   → resetWhiteboard() + setWhiteboardOpen(false)
   → whiteboard panel is dismissed for everyone
```

---

## 4. Notable design decisions

1. **Conference metadata as the sync channel.** WaveBook has its own real-time backend for stroke sync, but Jitsi needs to agree on *which board* everyone is in. Reusing the existing XMPP-backed metadata handler avoids adding a new transport.
2. **Moderator-only picker.** Reflected in `isWhiteboardButtonVisible` (functions.ts), the picker render gate (Whiteboard.tsx), and the broadcast guards in middleware.web.ts. Non-moderators are passive subscribers.
3. **Re-broadcast loop avoidance.** Both the open-broadcast and close-broadcast paths guard with `roomId` checks so the inbound metadata-listener path (which dispatches the same actions locally) doesn't fire another broadcast.
4. **Same-board re-select.** The `[boardId]` effect alone can't detect "the user picked the same board they had before," so the picker explicitly calls `onSelect()` to nudge the parent. This was the motivating bug for commit `d835c8934`.
5. **User roster sync on switch (uncommitted).** When a moderator switches to a different board mid-call, that board's `users[]` won't include the current attendees unless somebody adds them. The `mergeUsersIntoBoard` call handles that. Late joiners are covered separately by the embed page's session-pass fallback (gated on `metadata.sessionId`).
6. **Title validation in picker.** Mirrors backend constraint (`>= 5 chars`) so the user sees the error inline instead of after a failed POST.
7. **JWT-first identity.** Everywhere identity is needed, JWT context wins over `localParticipant` so the names/IDs match what the WaveBook backend expects.

---

## 5. Outstanding items in the working tree

- [actions.web.ts](react/features/whiteboard/actions.web.ts) — moderator-roster merge on board select. Solid; no obvious issues.
- [services.ts](react/features/whiteboard/services.ts) — new, untracked. Pure helpers, no surprises.
- [WhiteboardPicker.tsx](react/features/whiteboard/components/web/WhiteboardPicker.tsx) — `console.log('WhiteboardPicker context', ...)` at line 63 should be removed before commit (also fails the lint policy implied by `npm run lint:ci`).
- `docker-watch.ps1` — local dev script, decide whether to commit or `.gitignore` it.

---

## 6. Quick file reference

| Area | File |
|---|---|
| WaveBook config plumbing | [base/config/configType.ts](react/features/base/config/configType.ts), [base/config/configWhitelist.ts](react/features/base/config/configWhitelist.ts) |
| Selectors / JWT decode | [whiteboard/functions.ts](react/features/whiteboard/functions.ts) |
| Actions (board pick, broadcast, roster merge) | [whiteboard/actions.web.ts](react/features/whiteboard/actions.web.ts) |
| REST helpers | [whiteboard/services.ts](react/features/whiteboard/services.ts) |
| Open/close middleware | [whiteboard/middleware.web.ts](react/features/whiteboard/middleware.web.ts), [whiteboard/middleware.any.ts](react/features/whiteboard/middleware.any.ts) |
| In-meeting iframe + picker host | [whiteboard/components/web/Whiteboard.tsx](react/features/whiteboard/components/web/Whiteboard.tsx) |
| Board picker UI | [whiteboard/components/web/WhiteboardPicker.tsx](react/features/whiteboard/components/web/WhiteboardPicker.tsx) |
| Standalone (mobile/external) wrapper | [whiteboard/components/web/WhiteboardWrapper.tsx](react/features/whiteboard/components/web/WhiteboardWrapper.tsx) |
| Iframe sizing | [css/modals/_whiteboard.scss](css/modals/_whiteboard.scss) |
| Deployment doc | [AAUTI-WAVEBOOK-INTEGRATION.md](AAUTI-WAVEBOOK-INTEGRATION.md) |
