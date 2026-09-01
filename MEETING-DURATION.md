# Timed Meetings (Teams-style auto-end with grace buffer)

A meeting can be given a **scheduled end**. When it's reached, the meeting does
**not** close immediately — a **5-minute grace buffer** kicks in, during which
participants see a "time is up" toast and a live countdown. The meeting **ends
for everyone** when the buffer elapses (i.e. at `scheduledEnd + 5 min`).

The feature is **completely inert** unless one of its config values is set, so
existing deployments are unaffected.

---

## What the user sees

When the **scheduled end** is reached:

1. **Warning toast** — "Meeting time is up — The scheduled time is over. This
   meeting will close in 5 minutes." appears once, at the scheduled end.
2. **Live countdown banner** — an amber "Meeting closes in `mm:ss`" pill at the
   top-centre, counting down the **5-minute grace buffer**. Stays up even when
   the toolbar auto-hides.
3. **Auto-end** — when the buffer hits 0:
   - the **moderator's** client calls `endConference()`, removing everyone at
     once (one clean end), **and**
   - **non-moderators** `hangup()` (leave locally) as a fallback, so the room
     still empties even with **no moderator present**.

So nothing happens *before* the scheduled time; the toast + countdown appear the
moment the scheduled end passes and run for the grace buffer, then every
participant is dropped on the deadline.

---

## Configuration

One config value (optional, whitelisted in `configOverwrite` / URL / JWT):

| Key | Unit | Meaning |
|---|---|---|
| `maxMeetingEndTime` | **epoch seconds, UTC** | Absolute wall-clock end (the booked end). Immune to room restarts. Matches the JWT `exp` convention. Unset = no limit. |

### How the end is computed

```
effectiveEnd = maxMeetingEndTime + 5 min     // grace buffer (MEETING_END_BUFFER_MS)
```

The meeting closes at the booked end **plus** a fixed 5-minute grace. The
toast/countdown window equals the buffer, so they appear exactly at
`maxMeetingEndTime` and tick down the 5 minutes.

There is **no** duration / start-time input — the end is a single absolute
instant. That makes it restart-proof and means it can never be "already past on
join" during a live session (it's only past once the booked session + grace is
genuinely over), which is what keeps every client safe to leave on the deadline.

### Worked example — a 3:30–4:00 PM slot

| Scenario | `maxMeetingEndTime` | Toast + countdown appear | Closes at |
|---|---|---|---|
| Any join during the slot | 4:00 PM | 4:00 PM | **4:05 PM** |
| Room emptied & restarted at 3:50 | 4:00 PM | 4:00 PM | **4:05 PM** (absolute, restart-proof) |
| Join after 4:05 (session over) | 4:00 PM | — | leaves immediately (session already ended) |

---

## How to set it

Precedence: **URL hash > `configOverwrite` > server `config.js`**.

### 1. Per session via `configOverwrite` (recommended)

The embedding host passes the values when creating the iframe:

```js
const api = new JitsiMeetExternalAPI(domain, {
  roomName: 'session-1234',
  configOverwrite: {
    maxMeetingEndTime: 1780808400    // booked end, epoch seconds UTC
  }
});
```

Convert a date to epoch seconds safely (explicit offset avoids timezone bugs):

```js
maxMeetingEndTime: Math.floor(new Date('2026-06-07T16:00:00+05:30').getTime() / 1000)
```

### 2. Globally via server `config.js`

```js
// rarely useful globally — normally set per-session via configOverwrite
config.maxMeetingEndTime = 1780808400;
```

### 3. URL hash (testing only — participant-visible)

```
https://your-domain/room#config.maxMeetingEndTime=1780808400
```

### 4. Signed JWT (tamper-proof)

For values a participant must not be able to alter, put the end time in the JWT
the backend signs and read it on the client. Use this when client config can't
be trusted.

---

## AAuti marketplace integration

In the React app (`aautimpwebapplicationreactjs`), the meeting embed derives the
end from the booked session and passes it through `configOverwrite`:

**File:** `src/components/calendar/join_class/Jitsi/index.js`

```js
const endMs = localEvent?.endTime ? Date.parse(localEvent.endTime) : NaN;
if (Number.isFinite(endMs)) {
  maxMeetingEndTime = Math.floor(endMs / 1000);   // booked end → epoch seconds
}
// ...added into configOverwrite only when present
```

So `session.endTime` → `maxMeetingEndTime`. The fork adds the 5-minute grace
buffer on top, so the session closes for everyone at `endTime + 5 min`.

`configOverwrite` is baked when the iframe is created, so **re-join** after a
config change to pick up new values.

---

## Implementation (Jitsi fork)

Feature module: `react/features/meeting-duration/`

| File | Responsibility |
|---|---|
| `functions.ts` | `getScheduledEndTimestamp()` = `maxMeetingEndTime × 1000`; `getMeetingEndTimestamp()` = `scheduledEnd + MEETING_END_BUFFER_MS` (the effective close), the single source of truth all other parts read. |
| `middleware.web.ts` | Schedules the warning + auto-end on join; at the effective end the moderator calls `endConference()` (ends for all at once) and non-moderators `hangup()` (fallback so a moderator-less room still empties). |
| `components/web/MeetingCountdown.tsx` | The live countdown banner during the grace buffer. |
| `constants.ts` | `MEETING_END_BUFFER_MS` (grace buffer), `MEETING_END_WARNING_MS` (= buffer, the countdown window), notification id. |

Wiring: middleware registered in `react/features/app/middlewares.web.ts`;
banner rendered in `react/features/conference/components/web/Conference.tsx`.
Config keys declared in `react/features/base/config/configType.ts` and allowed
through in `configWhitelist.ts`. Strings live under `meetingDuration.*` in
`lang/main.json`.

### Maintainer note

Every client leaves on the deadline (no moderator gating). This is only safe
because the end is an **absolute** `maxMeetingEndTime` (+ grace), **not** derived
from the conference-created timestamp — so it can never be "already past" on join
during a live session (the cause of an earlier self-disconnect bug). If you ever
reintroduce a *duration-from-start* input, do **not** let clients self-`hangup()`
on it, or that bug returns.

---

## Behaviour notes / edge cases

- **Restart-proof.** `maxMeetingEndTime` is an absolute instant, so emptying and
  recreating the room never moves the end.
- **Late joiner inside the window** → warning + countdown show immediately.
- **Joins after the limit** → leaves immediately on join (the session is over).
- **Clock skew** → with a moderator present, `endConference()` ends everyone at
  once on the moderator's clock (no per-client skew). With no moderator, each
  non-moderator leaves on its own clock (a fast one early, a slow one lingers
  briefly alone). For a single authoritative end regardless, enforce it
  server-side (reservation).
- **Background-tab throttling** → the end is a timer; an active call is exempt
  from intensive throttling, but a closed/slept tab won't fire. Server-side
  enforcement removes this dependency.
- **Toast text is static "5 minutes"** even for a late joiner with less time
  left; the live banner is the accurate one.
- **`reducedUI` mode** doesn't render the banner (auto-end still works).
