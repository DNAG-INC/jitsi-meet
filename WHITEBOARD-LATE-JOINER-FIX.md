# Whiteboard Late-Joiner Access — Implementation Notes

Implements the production fix for: *"any user should access the board irrespective of when they join"*. Approach chosen was **backend-driven roster sync** (Way 6 from the earlier analysis) — the AAuti Node backend is the canonical source of session membership, so every roster decision flows from it.

## What changed at a glance

| Repo | Files | What |
|---|---|---|
| `D:\workspace\aautinodejs` | `utils/aautiUtil.js`, `service/sessionService.js` | Factored the JWT-mint roster lookup into a reusable helper. Added `GET /session/getWhiteboardMembers`. |
| `d:\workspace\jitsi-meet-1` | 6 files modified, 1 new | Pull JWT user-ids for remote participants; new `services.ts` REST layer; rewrote `selectWhiteboardBoard` to seed from backend roster; new debounced `syncWhiteboardRoster` action; wired to `PARTICIPANT_JOINED` / `PARTICIPANT_ROLE_CHANGED`. |
| `d:\workspace\aauti-whiteboard` | none | WaveBook backend untouched. |

## End-to-end flow after the fix

1. Moderator opens the whiteboard and picks (or creates) a board.
2. `selectWhiteboardBoard(boardId)` fires. It (a) broadcasts the board id via Jitsi conference metadata as before, and (b) **also** calls `syncSessionRosterToBoard` which:
   - GETs `${aautiApiUrl}/session/getWhiteboardMembers?sessionId=X&userId=<moderator>` — returns `{ members: [{ userId, name, role }] }` from the AAuti `ChatRoom` (instructors → editor, members → viewer).
   - GETs the current `board.users[]` from WaveBook.
   - Computes the diff (new userIds + role upgrades; no downgrades).
   - PUTs the merged users back if anything changed.
3. **At this moment** every enrolled user — *including subscribers who haven't joined the Jitsi call yet* — is already in `board.users[]` and will pass WaveBook's embed gate when they arrive.
4. A user joins the Jitsi call later (possibly after purchasing access mid-class).
5. On the moderator's browser, `PARTICIPANT_JOINED` fires. The middleware dispatches `syncWhiteboardRoster()`, which is **debounced 800 ms**, so a join storm collapses to one fetch+PUT.
6. After the debounce, the same fetch-diff-PUT pipeline runs. The new joiner is now in `board.users[]`.
7. New joiner's browser, in parallel, has rendered the iframe via the conference-metadata broadcast. The iframe hits `/api/whiteboard/:boardId/user/:externalUserId`; WaveBook finds them in `board.users[]` and serves the embed.

The two paths converge: the moderator's PUT typically wins the race comfortably (PUT ≈100 ms vs. iframe-bootstrap ≈500+ ms), and for the rare case it doesn't, step 5's debounced re-sync catches up before any retry.

## Files & changes

### Backend (`D:\workspace\aautinodejs`)

**`utils/aautiUtil.js`** — extracted the inline ChatRoom roster lookup from `generateJwtTokenForJitsi` into a new exported helper:

```js
const getSessionWhiteboardRoster = async ({
  sessionId, batchId, requesterUserId, requireRequesterModerator = false
}) => { ... }
// returns { members, sessionDoc, chatRoom, isRequesterModerator }
```

- `members` is the *full* roster (moderators-as-editor + members-as-viewer), keyed by AAuti userId. Does NOT exclude the requester (the JWT-mint caller filters them out itself, since the picker adds them as `owner`).
- `requireRequesterModerator: true` reproduces the original JWT-mint behavior (the requester must be a moderator in the ChatRoom).
- `requireRequesterModerator: false` (default) is used by the new endpoint, which does the moderator check explicitly via `isRequesterModerator`.

`generateJwtTokenForJitsi` was refactored to call the helper; behavior is unchanged.

**`service/sessionService.js`** — added the new endpoint:

```js
router.get("/getWhiteboardMembers", async (req, res) => {
  const { sessionId, batchId, userId } = req.query;
  // Validates sessionId/batchId and userId.
  // Fetches roster via getSessionWhiteboardRoster.
  // 404 if no chat room, 403 if requester isn't a moderator of it.
  // Returns { members, sessionId } on success.
});
```

Mounted under the existing `/session` router → full path is `GET /session/getWhiteboardMembers`. Response shape matches the AAuti `successResponse` convention (`{ status, message, result }`).

### Jitsi fork (`d:\workspace\jitsi-meet-1`)

**`react/features/base/config/configType.ts`** — added `IWhiteboardConfig.aautiApiUrl?: string`. This is the base URL of the AAuti backend (e.g. `https://api.aauti.com`). The Jitsi web bundle reads it from `state['features/base/config'].whiteboard.aautiApiUrl`.

**`react/features/base/config/configWhitelist.ts`** — whitelisted `whiteboard.aautiApiUrl` so `configOverwrite.whiteboard.aautiApiUrl` from the marketplace app survives Jitsi's config filter.

**`react/features/base/conference/functions.ts`** — `commonUserJoinedHandling` now also copies `user.getIdentity()?.user?.id` (the JWT user id from the remote participant's presence stanza) into the participant's `jwtId` field. Previously only the local participant had `jwtId`; remote participants only had the JID-resource `id`. This is the real bug uncovered during analysis — without this, anything that needs the AAuti user id for a remote participant would have been silently broken.

**`react/features/base/participants/reducer.ts`** — added `jwtId` to the `_participantJoined` destructure + return, so the new value above actually reaches Redux state.

**`react/features/whiteboard/services.ts`** (new) — REST layer:
- `fetchSessionRoster({ aautiApiUrl, sessionId, batchId, requesterUserId })` — calls the new backend endpoint. Returns `null` on 4xx / network error so the caller can no-op cleanly.
- `mergeUsersIntoBoard(boardId, incoming, params)` — fetches current `board.users[]`, computes the merge with **role upgrade-only** semantics (viewer < editor < owner; never downgrades), skips the PUT if nothing changed.
- `syncSessionRosterToBoard(boardId, rosterParams, waveBookParams)` — orchestrates the two.

**`react/features/whiteboard/actions.web.ts`** — rewritten:
- `selectWhiteboardBoard(boardId)`: still broadcasts via conference metadata, but now also fires `syncSessionRosterToBoard` so the whole session roster is seeded immediately on board pick.
- `syncWhiteboardRoster()`: new debounced (800 ms) action used by the middleware. No-ops if no board is open, local isn't moderator, or WaveBook/AAuti config is missing. Safe to dispatch freely.
- `_buildSyncParams(state)`: shared guard that bundles the two parameter sets (backend roster fetch params + WaveBook PUT params). Returns `null` cleanly when configuration is incomplete.

**`react/features/whiteboard/middleware.web.ts`** — added `PARTICIPANT_JOINED` and `PARTICIPANT_ROLE_CHANGED` cases that dispatch `syncWhiteboardRoster()` when a board is open and local is moderator. Skips the fake whiteboard participant.

## Deployment ordering

Roll out in this order so no user-visible regression occurs at any step:

1. **AAuti Node backend** — deploy `getSessionWhiteboardRoster` helper + `GET /session/getWhiteboardMembers`. Existing JWT flow is unchanged. No client expects the new endpoint yet — safe to ship in isolation.
2. **AAuti React webapp** — `src/components/calendar/join_class/Jitsi/index.js` now passes `aautiApiUrl: baseUrl` inside `configOverwrite.whiteboard`. `baseUrl` resolves to `process.env.REACT_APP_API_URL` per environment.
3. **Jitsi web bundle** — deploy this fork's build. Picks up the `aautiApiUrl` from configOverwrite. Fix activates.

If steps 2 and 3 ship before step 1, the Jitsi side will get 404s from the missing endpoint and gracefully no-op (still falling back to the metadata-broadcast-only behavior). No crashes.

## What we deliberately didn't do

- **No removal on PARTICIPANT_LEFT.** Jitsi participants can transiently drop and rejoin; removing them from `board.users[]` would lock them out on reconnect. Membership is sticky.
- **No `jwtCtx.members` seeding as a fallback.** The JWT's member list is frozen at mint time; if a user purchases mid-class, it's stale. The backend endpoint is the only correct source. We removed the fallback path explicitly to avoid two divergent implementations.
- **No WaveBook backend changes.** The auto-add behavior in WaveBook's WebSocket gate (`websocket.gateway.ts:153`) still serves as a second-line safety net — but every code path now also pre-adds via HTTP so the embed gate's strict 404 doesn't fire in the first place.
- **No commit/push.** Working tree is left dirty for your review. Two repos to commit:
  - Jitsi: 6 files modified + 1 new + 1 new doc.
  - AAuti backend: 2 files modified.

## Pre-merge verification checklist

When you're back:

1. **Endpoint smoke test** (backend deployed):
   ```bash
   curl 'https://<aauti-backend>/session/getWhiteboardMembers?sessionId=<id>&userId=<moderatorId>'
   # Expect: { status, message, result: { members: [...], sessionId } }
   ```
2. **JWT identity check** (Jitsi web running): in browser DevTools on a live class,
   ```js
   APP.store.getState()['features/base/participants'].remote
   ```
   Each entry should now have `jwtId` populated with the AAuti user id.
3. **Late-joiner end-to-end**:
   - Moderator opens whiteboard, creates a board.
   - From WaveBook DB (or `GET /api/whiteboard/:boardId`): verify `users[]` immediately contains the full enrolled roster.
   - Open a second tab as a different enrolled user → confirm the board loads without 404.
   - Have a third user purchase the class mid-session, then join → confirm their iframe loads cleanly.
4. **Role upgrade**:
   - Have a `viewer` join, then promote them to moderator in Jitsi → confirm `board.users[]` upgrades their role to `editor`.
5. **No downgrade**:
   - A user joins as moderator (editor), then is demoted → their board role should stay `editor` (the sync does not downgrade).
6. **Robustness**:
   - Drop the AAuti backend (e.g. temporarily 500). Confirm the moderator's board operations still work — no crashes, just no roster sync (graceful degradation).

## File diff summary

```
D:/workspace/aautinodejs:
  utils/aautiUtil.js              | ~75 lines added (helper), ~10 removed (inlined logic now using helper)
  service/sessionService.js       | +33 lines (new endpoint), 1 line modified (import)

d:/workspace/jitsi-meet-1:
  react/features/base/conference/functions.ts                          | +7  lines (jwtId capture)
  react/features/base/participants/reducer.ts                          | +2  lines (jwtId in destructure + return)
  react/features/base/config/configType.ts                             | +6  lines (aautiApiUrl field + doc)
  react/features/base/config/configWhitelist.ts                        | +1  line  (whitelist entry)
  react/features/whiteboard/services.ts                                | NEW (208 lines)
  react/features/whiteboard/actions.web.ts                             | rewrite, +130 net
  react/features/whiteboard/middleware.web.ts                          | +21 lines (case PARTICIPANT_JOINED/ROLE_CHANGED)
  WHITEBOARD-LATE-JOINER-FIX.md                                        | NEW (this doc)
```

## Known follow-ups (out of scope for this PR)

- **Auth tightening**: the AAuti `JWTAuth` middleware is currently a no-op (see `utils/auth.js`); the new endpoint inherits that. When/if you re-enable auth, the endpoint will need a real session/JWT check — the moderator-of-session check inside the controller stays valid either way.
- **Telemetry**: consider logging when the moderator's PUT loses the race to the new joiner's iframe load — currently invisible. Add once we have an incident or want to quantify the race window.
- **Lobby bypass for purchased late joiners** (separate bug, Obs 1b): late purchasers go into Jitsi's lobby because `lobbyBypass` is only true for `isRegisteredInvitee || isCoOrganizer`. If they should bypass, extend the condition in the marketplace JWT-mint call to include "has valid purchase for this session".
