# Timed Meetings (Teams-style auto-end)

A meeting can be given an **allotted time**. Participants see a live on-screen
countdown and a warning before the limit, and the meeting **ends for everyone**
when time is up — like Microsoft Teams / Zoom scheduled meetings.

The feature is **completely inert** unless one of its config values is set, so
existing deployments are unaffected.

---

## What the user sees

1. **Live countdown banner** — an amber "Meeting ends in `mm:ss`" pill at the
   top-centre, visible during the final **5 minutes**. Stays up even when the
   toolbar auto-hides.
2. **Warning toast** — "Meeting ending soon — This meeting will end in 5 minutes."
   appears once when the 5-minute window opens.
3. **Auto-end** — at the limit the **moderator's** client ends the conference
   for everyone (`endConference()`). Non-moderators leave locally as a fallback
   if no moderator is present.

The countdown/warning are shown to **all** participants so everyone gets the
heads-up. Only the moderator can actually end the meeting for others.

---

## Configuration

Two independent config values (both optional, both whitelisted in
`configOverwrite` / URL / JWT):

| Key | Unit | Meaning |
|---|---|---|
| `maxMeetingDuration` | **minutes** | Length cap, measured from when the conference actually starts. Resets if the room fully empties and is recreated. |
| `maxMeetingEndTime` | **epoch seconds, UTC** | Absolute wall-clock end. Immune to restarts. Matches the JWT `exp` convention. |

### How they combine

The meeting ends at **whichever limit comes first**:

```
effectiveEnd = min( conferenceStart + maxMeetingDuration , maxMeetingEndTime )
```

- Only `maxMeetingDuration` set → "N minutes from start" (restartable).
- Only `maxMeetingEndTime` set → "ends at this clock time, no matter what".
- **Both set** → capped by length **and** never past the absolute end. This is
  the recommended setup for paid/scheduled sessions: a normal start ends at the
  booked end time, while an early start can't run longer than the booked length.

### Worked example — a 3:30–4:00 PM slot

| Scenario | `maxMeetingDuration` | `maxMeetingEndTime` | Ends at |
|---|---|---|---|
| Normal join at 3:30 | 30 | 4:00 PM | **4:00 PM** |
| Early start at 3:00 | 30 | 4:00 PM | **3:30** (duration cap wins) |
| Room emptied & restarted at 3:50 | 30 | 4:00 PM | **4:00 PM** (absolute end wins) |

---

## How to set it

Precedence: **URL hash > `configOverwrite` > server `config.js`**.

### 1. Per session via `configOverwrite` (recommended)

The embedding host passes the values when creating the iframe:

```js
const api = new JitsiMeetExternalAPI(domain, {
  roomName: 'session-1234',
  configOverwrite: {
    maxMeetingEndTime: 1780808400,   // booked end, epoch seconds UTC
    maxMeetingDuration: 30           // booked slot length, minutes (optional)
  }
});
```

Convert a date to epoch seconds safely (explicit offset avoids timezone bugs):

```js
maxMeetingEndTime: Math.floor(new Date('2026-06-07T16:00:00+05:30').getTime() / 1000)
```

### 2. Globally via server `config.js`

```js
// applies to every room on this deployment
config.maxMeetingDuration = 60;
// config.maxMeetingEndTime = 1780808400;  // rarely useful globally
```

### 3. URL hash (testing only — participant-visible)

```
https://your-domain/room#config.maxMeetingDuration=1
https://your-domain/room#config.maxMeetingEndTime=1780808400
```

### 4. Signed JWT (tamper-proof)

For values a participant must not be able to alter, put the end time in the JWT
the backend signs and read it on the client. Use this when client config can't
be trusted.

---

## AAuti marketplace integration

In the React app (`aautimpwebapplicationreactjs`), the meeting embed derives
both values from the booked session and passes them through `configOverwrite`:

**File:** `src/components/calendar/join_class/Jitsi/index.js`

```js
const startMs = localEvent?.startTime ? Date.parse(localEvent.startTime) : NaN;
const endMs   = localEvent?.endTime   ? Date.parse(localEvent.endTime)   : NaN;

if (Number.isFinite(endMs)) {
  maxMeetingEndTime = Math.floor(endMs / 1000);             // absolute end
}
if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
  maxMeetingDuration = Math.round((endMs - startMs) / 60000); // slot length
}
// ...added into configOverwrite only when present
```

So `session.endTime` → `maxMeetingEndTime`, and `session.endTime − session.startTime`
→ `maxMeetingDuration`. The meeting ends at the scheduled end, capped at the
booked length.

`configOverwrite` is baked when the iframe is created, so **re-join** after a
config change to pick up new values.

---

## Implementation (Jitsi fork)

Feature module: `react/features/meeting-duration/`

| File | Responsibility |
|---|---|
| `functions.ts` | `getMeetingEndTimestamp()` = `min(start+duration, endTime)`; the single source of truth all other parts read. |
| `middleware.web.ts` | Schedules the warning + auto-end on join; ends for everyone (moderator) or leaves (fallback) at the limit. |
| `components/web/MeetingCountdown.tsx` | The live countdown banner (final 5 min). |
| `constants.ts` | 5-minute warning window, notification id. |

Wiring: middleware registered in `react/features/app/middlewares.web.ts`;
banner rendered in `react/features/conference/components/web/Conference.tsx`.
Config keys declared in `react/features/base/config/configType.ts` and allowed
through in `configWhitelist.ts`. Strings live under `meetingDuration.*` in
`lang/main.json`.

### Maintainer note

`conferenceTimestamp` is typed `number` but lib-jitsi-meet delivers it as a
**string** at runtime. `functions.ts` coerces with `Number()` before arithmetic
— without it, `start + duration` string-concatenates into a garbage value and
the feature silently does nothing. Keep the coercion.

---

## Behaviour notes / edge cases

- **Restart resets duration, not end-time.** `maxMeetingDuration` is measured
  from conference creation, so if the room fully empties and a new one is
  created the clock restarts. `maxMeetingEndTime` is absolute and immune to
  this — use it (or both) for paid sessions.
- **Late joiner inside the window** → warning + countdown show immediately.
- **Joins after the limit** → ends immediately on join.
- **Moderator promoted mid-meeting** → role is re-checked at end time, so a
  promoted moderator correctly ends for everyone.
- **Background-tab throttling** → the end uses a one-shot timer; a minimised
  moderator tab can fire slightly late. Acceptable for now.
- **Toast text is static "5 minutes"** even for a late joiner with less time
  left; the live banner is the accurate one.
- **`reducedUI` mode** doesn't render the banner (auto-end still works).
