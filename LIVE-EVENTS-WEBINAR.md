# Live Events (Webinar) — Implementation Plan

**This file is the source of truth.** Update it on every change and add a row to
the change log (§12). If something here contradicts a Slack thread or an older
doc, this file wins.

Status as of 10 Nov: **app side built and pushed; infra side built, not
deployed.**

Visitor mode is built on `DNAG-PlatformEngineering/aauti-jitsi` branch
`aauti-jitsi-sandbox` (commit `75c4b9e`), switched on by `webinar.enabled: true`
in `values-sandbox.yaml` only — prod and devvideo render byte-identical to
`main`. Sandbox ArgoCD still targets `main`; deploying means repointing it at
the branch.

Our work is on `aauti-platform` branch `feature/adhoc-live-events`, commit
**`961527fbe`** (4 Nov), pushed to `origin`. Phases 1, 2 and 4 are all in that
one commit. The branch also carries `d33d87198` (Prashanth Ch, 27 Oct), which
built the live-event product itself — booking mode in the adhoc wizard, event
pages, reserve flow, cart and checkout lines, schema.org Event. **Our work
lands on that branch**, never on `main`.

**One app change left: the seat cap (Phase 3), blocked on infra's load test.**
Everything else infra originally asked for is either satisfied by the current
token or has been withdrawn — see §5.

Nothing has been tested against a running webinar, because nothing is deployed.
Every "Done" below means written, typechecked and pushed, not verified.

Related:
- `aauti-platform/docs/adhoc-live-events.md` — the booking design (Prashanth Ch, Oct 2026)
- [`JITSI-JWT-FLOW.md`](JITSI-JWT-FLOW.md) — the token contract this builds on
- *Jitsi Webinars (Visitor Mode): Infra Response to Dev Brief* — Sai Krishna, 30 Oct 2026

---

## 1. What a Live Event is

An instructor publishes a live event: fixed date, fixed price, learners buy a
seat. At the appointed time the instructor presents and the audience watches.
An attendee raises a hand, the instructor lets them speak, then puts them back.

**"Live event" and "webinar" are the same thing** — the former is what the
product and the code call it, the latter is what people call it. There is no
separate webinar feature to add; there is a live event whose room half was
never built.

Today an event opens the identical Jitsi room as a 1:1 tutoring session, with
every attendee a full participant. The only room-adjacent change on the branch
is a `lockedSelection` field written at session generation.

## 2. Approach

Jitsi's **visitor mode**. The audience connects to separate signalling nodes
where they receive but are never announced; the main room holds only
presenters. Attendees raise a hand and are promoted into the main room on
approval.

Chosen over an AV-moderated single room because that caps out around 50–75
(signalling, not media) and we need materially more. See §11.

**The entire browser side already exists in this fork** — `react/features/visitors/`,
the reduced toolbar at [`react/features/toolbox/constants.ts:210`](react/features/toolbox/constants.ts#L210),
the queue screen, promotion requests. It is dormant because no server activates
it. **No Jitsi client changes are required.**

## 3. The mechanism

Our backend adds a tenant prefix to the room name for webinars, so the address
becomes `.../webinar/<room>`. Prosody encodes that as
`[webinar]<room>@muc.<domain>`, and a plugin marks only those rooms as
visitor-enabled. Jicofo, required to check that marking, sends the audience to
a visitor node.

Rooms without the prefix cannot match, so tutoring, group classes and trials
are structurally untouched.

**End to end:**

1. Backend mints the room name with the `webinar` prefix
2. Backend mints the JWT — `moderator` at the root **and** in `context.user`; `sub` unchanged (see §5)
3. Browser opens `https://<host>/webinar/<room>?jwt=…`
4. Prosody verifies the token and grants presenter rights from either moderator claim
5. `mod_webinar_visitors` recognises the prefix and sets room **metadata** `visitorsEnabled` and `participantsSoftLimit = 0`
6. Jicofo keeps presenters in the main room and sends every other arrival to a visitor node
7. `mod_fmuc` mirrors presenter presence to the visitor node; **visitor presence is never broadcast** — this is what makes it scale
8. Media still flows through JVB. Visitor nodes carry **no** audio or video
9. Raise hand → request forwarded to the main room → presenter approves → visitor moved in with send capability
10. Jibri stays in the main room via the ignore list and records normally

Three behaviours from infra's response that shape everything downstream:

- **Presenters are pinned.** The plugin copies presenter IDs from the JWT into the room's `moderators` list, and Jicofo keeps those users in the main room whenever they arrive. Arrival order stops mattering.
- **Freed slots never reopen.** Once the first visitor exists, every later joiner is a visitor even if a main-room participant leaves. The only way back is promotion.
- **Promotion ignores the limit.** Approving a raised hand can take the main room above 30. Nothing in our accounting may hardcode 30.

### Who is a presenter, and how it is decided

Everybody opens the same address. The URL identifies the **room**; the token
identifies the **person**. Each client calls our join endpoint and gets a token
minted for that caller:

```
https://video-sandbox.aauti.com/webinar/<sessionId>-aauti-<env>?jwt=<per-user token>
```

`getJoinInfo` sets `isModerator: isHost || isSP`, where `isHost` is
`isSP || isCoOrg || isCoInstructor || isInstituteAdmin || isAautiStaffJoiner`.
That becomes the **top-level `moderator` claim**. Prosody's
`mod_token_moderation` reads it and grants moderator rights; a buyer matches
none of those roles and gets `moderator: false`. This logic predates the
webinar work and was deliberately left alone — a webinar grants rights exactly
as a class does.

The webinar plugin then copies the presenter `context.user.id`s into the room's
`moderators` list, which is what keeps them in the main room whatever the
arrival order.

**A join URL is a credential.** It carries that one person's identity and
rights, so an instructor forwarding their link hands over moderator powers.
Already true for ordinary classes; worth restating because "send everyone the
webinar link" is the natural thing to assume and it is wrong.

### The soft limit is not a presenter/attendee split

Easy to misread. It is **not** "presenters in the main room, all buyers as
visitors". Presenters are pinned, and then the first 30 *non*-presenters also
land in the main room as ordinary participants with camera and mic available.
Only arrival 31 onward becomes a visitor.

So a live event with 25 buyers never enters visitor mode at all — the prefix is
there, the plugin flags the room, nobody is routed anywhere. It behaves exactly
like a normal group call.

Infra's own scenario 2 states this ("35 users join → 30 in main room, 5
visitors"), so it is their design rather than a defect. But if the product
expects an event attendee to be watch-only, 30 is not that, and the knob is
their `participantsSoftLimit`, not anything in our code. Raised with infra
10 Nov; see §10.

**Superseded 12 Nov — the cap is dropped.** `participantsSoftLimit = 0`, so an
attendee is a visitor from arrival one at any headcount. The section stays
because the misreading is easy to repeat: any soft limit above zero makes the
split a function of arrival order rather than of role.

---

## 4. What DevOps is building

Four pieces do not exist in Jitsi or our deployment. Infra own all of them.

| Piece | What it does |
|---|---|
| `mod_webinar_visitors` (new, ~40 lines) | Flags only `[webinar]` rooms, sets `participantsSoftLimit = 0`, copies presenter IDs into `moderators`. Other rooms never match |
| `mod_token_moderation` (update) | Today reads only the top-level `moderator`; will also accept `context.user.moderator` |
| Visitor-node JWT auth | Visitor nodes are anonymous today, so paid seats are unenforced. This is why every attendee needs a token |
| Visitor prosody deployment + routing | Helm StatefulSet, service, cert, s2s link, nginx routes for visitor websockets and `/conference-request/v1` |
| `room_metadata_component` on each visitor node | Nothing rebroadcasts room metadata on a vnode today, so a visitor's `conference.metadata` is `null` — absent, not empty. `mod_visitors` forwards the metadata from the main host and `mod_fmuc` receives it, but with no component listening on the vnode no client there is ever told. This is what keeps a presenter's whiteboard invisible to the audience |

Settings they change but do not code: `always_visitors_enabled = false`,
`auto_allow_visitor_promotion = false`, and on Jicofo `ENABLE_VISITORS=1`,
`VISITORS_XMPP_SERVER`, `VISITORS_MAX_VISITORS_PER_NODE=250`,
`JICOFO_VISITORS_REQUIRE_MUC_CONFIG=1`.

They are also changing nine infrastructure settings. The first four matter with
or without webinars — production has never hit them only because its busiest
moment in 15 days was four participants.

| Component | Live on prod today | Change |
|---|---|---|
| JVB memory | Heap 3 GB, pod limit 2Gi | Limit 4Gi, CPU 4 — pod is OOM-killed under load |
| Jicofo memory | Heap 3 GB, pod limit 512Mi | Heap 2 GB, limit 3Gi — same OOM risk |
| Jicofo bridge cap | `max-bridge-participants=30` | ~120; 500 viewers would otherwise need 17 bridges |
| Main prosody | CPU limit 500m | 1 vCPU, 1Gi — single-threaded, half a core throttles joins |
| Visitor prosody | None | 2–3 pods, 1 vCPU / 1Gi each, on the signalling node |
| JVB scaling | HPA on CPU, min 2 pods | 6 pods, 30 min before each webinar — HPA reacts too late to a join rush |
| JVB node pool | 1 node running, Terraform min 2 | Reconcile to min 2 (drift) |
| s2s | Disabled | Enabled on 5269, whitelisted to visitor domains only |
| Gateway / LB | GKE L7 Gateway to web pod | No change; routing is inside nginx |

The JVB scaling row is worth noting on our side: six pods have to be up **30
minutes before** a webinar starts, which means something has to know a webinar
is about to begin. That is a scheduling dependency nobody has claimed yet.

---

## 5. Corrections to the original brief

Infra's response overturned three items. Anyone working from the earlier
version of this file will build the wrong thing, and one of them breaks every
live class.

| We planned | What is actually true | What we do instead |
|---|---|---|
| Move `moderator` into `context.user`, since nothing reads it at the root | Their live `mod_token_moderation` reads **only** the top-level claim. Moving it removes moderator from every class, not just webinars | Send it in **both** places. They update the plugin to accept either |
| Room naming and token `sub` must ship together or every webinar join 403s | `enable_domain_verification = false` on prod, so `sub` is never checked | No `sub` change. Room naming ships on its own |
| Hold attendees out until a presenter is in, because Jicofo places by arrival order | True by default, but the plugin pins presenters via the `moderators` list | Drop it. Doors-open gating is optional |

The first is the dangerous one: described as a one-line fix, it would have
silently removed moderator from every tutoring session on the platform.

A fourth correction, to §5.3 of the earlier version: a plugin that only adds
the `muc#roominfo_visitorsEnabled` **disco field** would redirect nobody.
Jicofo 1.0-1189 stopped reading that field (removed upstream Oct 2025). The
plugin must set room **metadata** instead.

---

## 6. App side — phased plan

| Phase | Delivers | Status | Gated by |
|---|---|---|---|
| 0 | A reliable marker distinguishing webinars from classes | **Done 3 Nov** | — |
| 1 | Booking mode at join, room naming, moderator claim | **Done, pushed** in `961527fbe` — untested | Nothing |
| 2 | Short-lived attendee tokens, slimmer token payload | **Done, pushed** in `961527fbe` — untested | Nothing |
| 3 | Server-side seat cap, buyer-facing copy | Blocked | Infra load test, their week 2–3 |
| 4 | Visitor flag, participant count, `channelLastN` | **Done, pushed** in `961527fbe` — untested | Nothing |

### Phase 0 — Mark a webinar session — done 3 Nov

We cannot name a room `webinar/<id>` until we can tell a webinar from a class.
`Schedule.bookingMode` is the field that does that, and it lives on
`feature/adhoc-live-events` and nowhere else.

**The branch is no longer stranded.** `main` was merged into it on 3 Nov
(`5c5f0368e`), so it is **0 commits behind** — it was 149 behind that morning
and 93 in early October. Local and `origin` agree.

**Decided 3 Nov: we work on that branch.** Phase 1 and everything after it is
written on `feature/adhoc-live-events`. There is no rebase to own and no
cherry-pick to argue about — `bookingMode` is already in scope where we stand.

Reusing an existing field (`typeTag`, `subType`, `classTypes`) was investigated
first and rejected. The branch is not where the marker lives — it is the whole
live-events product, and without it there is no webinar to put in a webinar
room.

What the two relevant commits carry, all of it available to us now:

| `f136cd6bc` — backend | `d33d87198` — studio + marketplace |
|---|---|
| `bookingMode` + `seatPrice` migration | ~20 new event components: reserve card, seat picker, date strip, sold-out / live / ended cards, mobile CTA |
| New `adhoc-event-lock` domain module | `_event-container.tsx`, 390 lines |
| Event pricing (`adhoc-card-price`, `adhoc-line-price`) | Event detail routes and purchase gates |
| Cart, order, enrollment, package and refund changes | |
| `schedule.service.ts`, 459 lines | |

A third commit on the branch, `dea53a829` (course batch tabs), is unrelated to
live events. Working on the branch means it reaches `main` whenever the branch
does, so it has to be judged on its own merits rather than quietly ride along.

Two things worth knowing before Phase 1 starts:

`seatPrice` already exists there — "the fixed price of one seat on one date" —
so Phase 3's seat cap has a price model waiting rather than needing one
invented.

The event UI on that branch predates visitor mode, so its buyer-facing copy
still describes a group session. The Phase 3 copy work applies to those new
components, not to the old `event-facts.ts`.

- [ ] Decide whether `dea53a829` merges with the branch or comes off it first
- [ ] Keep merging `main` in as it moves, so the gap never reopens

### Phase 1 — Unblock DevOps testing

Three changes, almost all in
`aauti-platform/services/api/src/modules/session/providers/video-conference.service.ts`.
Infra mark the first two as blocking their scenarios 1–8. All of it is written
on `feature/adhoc-live-events`, where `bookingMode` already is.

**1. Resolve booking mode at join. Done.** `getJoinInfo` already calls
`attachSessionParents`, which walks session → series → schedule, so
`bookingMode` was added to that select and to the `SessionParents` type. No
extra query, and it reads correctly on sessions that already exist.
Denormalising the mode into `session.metadata` at generation was the
alternative; it would have needed a backfill for every event session already
minted, so it was not taken.

**2. Room naming. Done.** `generateRoomId()` is unchanged and still returns the
bare `${session.id}-aauti-${roomEnv}`. A new
`toClientRoomName(roomId, isWebinar)` puts the `webinar/` prefix on, and
`getJoinInfo` now keeps two values apart: the prefixed name is what it returns
to the client and what `getJoinUrl()` builds from, the bare id is what goes
into the JWT `room` claim.

**3. ~~Moderator claim in both places.~~ Withdrawn 3 Nov.** Their updated
`mod_token_moderation` accepts the top-level `moderator` claim we already send,
and their JWT checklist marks `context.user.moderator` as *"Not sent; not
needed"*. `context.user.id` is already a stable string from `config.userId`.
The presenter token is **done as it stands** — no change.

**Exact room-name spec**, from their 3 Nov doc:

| | Value |
|---|---|
| iframe `roomName` | `webinar/<sessionId>-aauti-<env>` |
| JWT `room` claim | `<sessionId>-aauti-<env>` — **no** prefix, or `*` |

Keep the `-aauti-<env>` suffix: **Jibri's auto-recording matches on it.** That
contradicts `JITSI-JWT-FLOW.md §2.2`, which calls the suffix a historical
artifact nothing reads. Infra's version is the live one; the flow doc is wrong
and should be corrected.

**Connection and token contract**, as sent to infra (Vidhyadhari Sai) on
10 Nov. This is what their plugin work is being written against.

| | Value |
|---|---|
| Domain | `video-sandbox.aauti.com` |
| Join URL | `https://<domain>/<roomName>?jwt=<token>` |
| Signing | HS256, `expiresIn: 24h` |
| `aud` | `my-app-id` (`JITSI_APP_AUD`) |
| `iss` | `JITSI_APP_ID` |
| `sub` | the domain — not the tenant; `enable_domain_verification` is off |

Presenter token for a live event, decoded:

```json
{
  "context": {
    "user": {
      "id": "<aauti user uuid>",
      "name": "Asha Rao",
      "email": "asha.rao@example.com",
      "avatar": "https://cdn.aauti.com/u/…",
      "lobby_bypass": true
    },
    "metadata": {
      "sessionId": "<session uuid>",
      "sessionTitle": "Intro to Quantum Computing — Live Event",
      "sessionOwnerId": "<sp uuid>",
      "sessionOwnerName": "Asha Rao",
      "category": "Technology",
      "instituteId": "<institute uuid>",
      "userRole": "instructor",
      "env": "sandbox",
      "members": []
    }
  },
  "aud": "my-app-id",
  "iss": "<JITSI_APP_ID>",
  "sub": "video-sandbox.aauti.com",
  "room": "<sessionId>-aauti-sandbox",
  "moderator": true
}
```

An attendee token is the same shape with `moderator: false`,
`userRole: "subscriber"` and **no `lobby_bypass` key at all** — it is omitted
rather than set false, and granted only to hosts, co-organisers and vetted
in-app invitees.

Three properties the plugin depends on:

- `moderator` is **top-level only**. `context.user.moderator` is not sent, per their 3 Nov checklist.
- `context.user.id` is the AAuti user UUID and is **stable across sessions, devices and rejoins** — the right key for presenter pinning. A presenter who drops and reconnects presents the same value, so they come back a presenter.
- `context.metadata.members[]` is **always empty on a webinar** (Phase 2). Ordinary classes still carry a populated roster.

Files changed, all on `feature/adhoc-live-events`:

| File | Change |
|---|---|
| `packages/domain/src/attach.ts` | `bookingMode` added to the schedule select and to `SessionParents` |
| `…/session/providers/video-conference.service.ts` | new `toClientRoomName()`; `JitsiRoomConfig.roomName` documented as the unprefixed claim |
| `…/session/session.service.ts` | `getJoinInfo` splits `roomId` from `roomName` |

`trial-join.service.ts` is deliberately untouched — a trial is never an event,
and it keeps calling `generateRoomId()` on its own.

- [x] Booking mode resolved at join
- [x] Room naming with the `webinar/` prefix on `roomName` only
- [ ] Verified against a real event session, once sandbox runs visitor mode

### Phase 2 — Attendee join path

Visitor nodes reject anyone without a token, so every attendee needs one. We
already mint a token per caller in `getJoinInfo`, so the work is shape and size,
not a new flow.

**~~Short-lived attendee tokens.~~ Withdrawn 3 Nov.** The 30 Oct response asked
for event length plus 30 minutes; the 3 Nov doc marks attendee tokens *"Already
done — every join gets a token, valid 24 h"* and lists `exp` as OK. The only
requirement now is that the token **outlasts** the event, which 24 h does. No
change.

**Slim the token payload. Done.** `getJoinInfo` built
`context.metadata.members[]` from the SP, co-instructors and **every
enrolment**, uncapped. An event now seeds the teaching side only — the
enrolment loop is skipped when `bookingMode === "event"`, so a webinar token
carries the SP and co-instructors and nothing else.

**The ceiling is lower than this plan first claimed.** Measured against our own
field shapes, the token is ~1 KB empty, 8 KB at 50 members without avatars,
13 KB with them, and 121 KB at 500. The token rides the join URL twice —
[`base/util/uri.ts:555-591`](react/features/base/util/uri.ts#L555-L591) writes
it into the query string *and* the hash — and only the query copy counts
against the server. `docker-build/rootfs` sets no
`large_client_header_buffers`, so nginx's default `4 8k` applies: an 8 KB cap
on the request line. **The break is around 30–50 members, not 100+**, and less
once the `config` and `userInfo` params sharing that URL are counted.

That means a large ordinary group class can already 414 today. This fix does
not cover it — only events skip the roster — so the general case is still open.

Left undone on purpose: a webinar still *runs* the enrolment query and throws
the rows away. Harmless per join, wasteful at 500 joiners.

- [x] Cap or drop `context.metadata.members[]` for webinar tokens
- [x] Check token length against a 500-seat webinar before testing
- [ ] Decide whether an ordinary class needs a cap too, or the pre-seed goes
      away in favour of the board fetching its own roster
- [ ] Skip the enrolment read itself for events

### Also ours, from the 3 Nov doc

**Bump `BASE_TAG`.** `docker-build/Dockerfile:21` still pins
`stable-11146-2` while the client is 11248, so the image template set and the
client disagree. Infra flag it as "when convenient", but it is ours and it is
one line.

Checked 10 Nov: `stable/jitsi-meet_11248` is the newest stable tag upstream —
there is nothing beyond it to target. The deployed sandbox web is confirmed to
be our own build, not a stock image: the live `/libs/lib-jitsi-meet.min.js`
is byte-identical to the `v2205.0.0+7d14f385` this repo pins.

**Confirmed fine, nothing to do:** `include /config/nginx-custom/*.conf;` is
present at `docker-build/rootfs/defaults/meet.conf:48`, and the stock visitor
client code is intact — `getVisitorOptions` at
[`base/conference/functions.ts:307`](react/features/base/conference/functions.ts#L307)
and `redirect` at
[`base/conference/actions.any.ts:1082`](react/features/base/conference/actions.any.ts#L1082).

**One answer infra need from us, with a caveat.** They ask us to confirm
nothing hides raise hand, the visitor notice or the promote/demote prompts.
Raise hand survives: studio's toolbar whitelist includes `raisehand`, and
Jitsi intersects it with `VISITORS_MODE_BUTTONS`. **Chat does not.** Studio
drops Jitsi's chat in favour of the Aauti session feed, and chat plus raise
hand are the only two things a visitor has. A webinar attendee would therefore
have one of the two. Whether that matters depends on whether the Aauti feed is
reachable for a visitor — a product call, not a bug.

- [ ] Bump `BASE_TAG` to `stable-11248`
- [ ] Decide whether a visitor needs Jitsi chat, or whether the Aauti feed covers it

### Phase 3 — Make it sellable

**Seat cap enforced server-side.** Jitsi has no per-webinar total, so the
ceiling is ours and must be enforced where attendee tokens are minted, not in
the form. `packages/web/src/lib/input-limits.ts` caps the form at
`MAX_GROUP_SIZE = 100`; the DTO validates `@IsNumber() @Min(1)` with no maximum
at all. Infra's scenario-9 load test supplies the number.

The number is awkward in two ways: the soft limit can overshoot by one or two
on simultaneous joins, and promotion ignores the limit entirely.

**Tell the buyer what they bought.**
`apps/marketplace/src/features/adhocs/[id]/_utils/event-facts.ts` renders
"Up to N — seats per date · group", which reads as joining a group session. A
webinar attendee watches with camera and mic off and can raise a hand. They must
know before paying. This is a refund-queue risk: the industry norm for a paid
webinar is no refund for a no-show, which is only defensible if the page said
what the seat was.

- [ ] Get the seat number from infra's load test
- [ ] Add a maximum to the DTO
- [ ] Rewrite the buyer-facing facts for webinar sessions

### Phase 4 — In-room correctness

Independent, unblocked, small. Last only because a webinar works without them —
it just works wrongly.

**Read the visitor flag. Done.** `jitsi-room.tsx` discarded the
`videoConferenceJoined` payload; it now passes `{ visitor }` to `onJoined`, and
the overlay keeps it as `isVisitor`.

**Participant count from our own data. Done.** The headcount badge took Jitsi
`participantJoined` events, which only see the main room — a presenter would
read 3 while hundreds watch.

Worth knowing: **Jitsi has a visitor count but does not expose it.**
`state['features/visitors'].count` and `getVisitorsCount` exist and feed the
participants pane, but nothing in `modules/API` forwards either one. The iframe
API carries `visitor` on the join event and `isVisitor()` — a flag about *you*,
never a number. So the count has to be ours.

`getJoinInfo` now returns `isWebinar` and `audienceSize`, the latter one indexed
`enrollment.count` taken only for an event. **It is registered seats, not live
attendance** — honest about the size of the event, not about who is watching
right now. A live figure needs an endpoint over the attendance rows `trackJoin`
already writes, which is more than this phase.

**`channelLastN` set. Done.** `WEBINAR_CHANNEL_LAST_N = 2` in
`jitsi-room.tsx`, applied through `configOverwrite` for events only; an
ordinary class keeps the unlimited default, where it is a quality win rather
than a cost.

Files changed, all in `aauti-platform`:

| File | Change |
|---|---|
| `…/session/session.service.ts` | returns `isWebinar` and `audienceSize` |
| `packages/web/src/stores/live-session.store.ts` | both fields on `JoinInfo`, defaulted in `buildJoinInfo` for an older API build |
| `…/sessions/jitsi-room.tsx` | `isWebinar` prop, `channelLastN`, `visitor` on `onJoined` |
| `…/sessions/live-session-overlay.tsx` | holds `isVisitor`, shows `audienceSize` on an event |

**The whiteboard reaches a visitor read-only. Client done, server blocked.**
The commit is in the Jitsi fork, not `aauti-platform`.
A presenter's board id travels in room metadata, the same channel as polls and
the lobby, so a visitor's client opens the embed on its own. They never get a
button of their own — `VISITORS_MODE_BUTTONS` carries no `whiteboard` — so they
only ever see what a presenter opens. It mounted as an `editor`, which would
have handed drawing rights to someone who cannot otherwise contribute; it now
mounts as a `viewer` (`64e8ef332`). Nothing is visible yet: the visitor node has
no `room_metadata_component`, so the board id never arrives — see §4 and §10.

- [x] Keep the `videoConferenceJoined` payload and read `visitor`
- [x] Replace the Jitsi-derived participant count for webinars
- [x] Set `channelLastN` in `configOverwrite`
- [x] Mount the whiteboard as `viewer` rather than `editor` for a visitor
- [ ] Decide whether the badge should show live attendance instead of
      registered seats, which needs an endpoint over the attendance rows

---

## 7. Dropped

**Doors-open gating.** The plugin pins presenters to the main room, so a
presenter arriving after 30 attendees is fine.

**Changing the token `sub` to the tenant.** `enable_domain_verification` is off;
`sub` is never checked.

One caveat on dropping the first: a presenter who drops and rejoins is protected
only by the `moderators` list, which is keyed on `context.user.id`. If that claim
is missing or unstable for a presenter they return as a visitor, with no way out
but another presenter promoting them. The stable `context.user.id` in Phase 1 is
load-bearing, not incidental.

---

## 8. Jitsi side — deployment only, DevOps-owned

Retained for context; infra's response supersedes the detail.

| Setting | Ships as | Effect of the default |
|---|---|---|
| `always_visitors_enabled` (prosody) | **true** | Marks **every room** visitor-enabled |
| `JICOFO_VISITORS_REQUIRE_MUC_CONFIG` | **0** | Jicofo **ignores** the per-room marking |

Enabling visitors without changing both changes behaviour for every call on the
server — a 40-person class would push its last learners into watch-only. Infra
are setting `always_visitors_enabled = false` and
`JICOFO_VISITORS_REQUIRE_MUC_CONFIG = 1`, which installs the feature dormant.

**Fail-safe direction:** if the plugin errors, is removed, or doesn't match, the
room is not marked and runs as an ordinary Jitsi room. There is no failure mode
that turns a normal class into a visitor room.

**Capacity.** Visitor mode fixes signalling, not bandwidth — the audience still
receives media through JVB. Infra size a visitor node at ~250 seats with two to
three pods per webinar, and put the real ceiling on the videobridge: ~2.5–3 Mbps
per viewer, 1.2–1.5 Gbps for 500, five to six JVB pods. They will not commit a
number before the load test.

**Verify before production:** Jibri records the real room rather than a viewer
feed; the lobby still behaves alongside visitors; `mod_token_affiliation` is
actually loaded.

---

## 9. Test plan and rollout

Infra's scenarios, run on nonprod `jitsi-sandbox`. Scenarios 1, 9 and 10 must
pass before production. Scenarios 1–8 need our Phase 1 tokens.

| # | Scenario | Passes when |
|---|---|---|
| 1 | 40 users join an ordinary room | All 40 in the main room, all can unmute. **The regression test that matters most** |
| 2 | 35 users join `/webinar/t1` | 30 in main room, 5 visitors (30–32 acceptable) |
| 3 | Presenter joins after 30 attendees | Presenter lands in the main room as moderator |
| 4 | Tokens: top-level only, `context.user` only, both, none | First three get moderator; the last does not |
| 5 | Visitor raises hand, presenter approves | Visitor moves to the main room and can unmute |
| 6 | Presenter demotes the promoted user | User returns to visitor view |
| 7 | Join a visitor node with no token, then an expired one | Both rejected |
| 8 | Record a webinar with 50 visitors | Recording shows presenters, not a viewer feed |
| 9 | 500 receive-only bots, 5 presenters, joining within 5 min | No OOM, prosody CPU under 70%, JVB stress under 0.8 |
| 10 | `helm rollback` | Classes work, visitor pods gone |

### Their schedule

Two to three weeks from start, staged so regular classes are protected at every
step. **Week 2 is the one that binds us** — that is when they run scenarios 1–8
against our tokens, so Phase 1 has to be done before it.

1. **Week 1** — prod-safe fixes: JVB and Jicofo memory, prosody CPU, node-pool drift. No webinar features yet
2. **Week 1–2** — build on nonprod: webinar plugin, moderator plugin update, visitor prosody, visitor-node token auth, nginx routes
3. **Week 2** — test scenarios 1–8 **with our new tokens**
4. **Week 2–3** — load test (scenario 9), then fix the seat number we sell
5. **Week 3** — prod, in a low-traffic window, scenario 1 run straight after

Our phases map onto that as: Phase 0 and Phase 1 before their week 2, Phase 2
alongside it, Phase 3 after their week-2–3 load test hands us a seat number,
Phase 4 any time.

**Sandbox deploy, as of 3 Nov:** point the sandbox ArgoCD app's Target Revision
at `aauti-jitsi-sandbox` (path `.`, values file `values-sandbox.yaml`) and sync.
Rolling back is the same switch back to `main`.

**Watch the sync.** Random passwords in the chart restart prosody and jicofo on
every deploy, and jicofo can lose that race — that is what caused the 2 Nov
sandbox outage we spent an evening on, surfacing to us as
`connection.conferenceRequestFailed` with no conference ever created. It can
recur on any sync until infra land fixed passwords and a jicofo liveness probe.
The check straight after a sync:

```
kubectl -n jitsi-sandbox logs deploy/sandbox-jitsi-meet-jicofo -c jitsi-meet \
  --since=10m | grep -E "Connected\.|conflict|closed on error"
```

`Connected.` with no `conflict` is good; a `conflict` needs an ArgoCD Restart on
the jicofo deployment alone.

**Prod rollback:** `helm rollback jitsi <previous revision>` — production is on
revision 13 today. That removes the visitor pods and turns s2s off; classes
return to today's behaviour and webinar rooms become ordinary rooms with no
visitor split. Nothing we ship needs reverting alongside it: a `webinar/`
prefixed room with no plugin behind it is just a room.

---

## 10. Open decisions

| Decision | Owner | Blocks |
|---|---|---|
| ~~Rebase `bookingMode` onto `main`~~ — **answered 3 Nov**: `main` was merged into `feature/adhoc-live-events` and we work on the branch | — | — |
| Does `dea53a829` (course batch tabs) merge with the branch, or come off it first? | Us | Nothing yet; it reaches `main` with the branch |
| ~~Room-name form~~ — **answered 3 Nov**: prefix on the iframe `roomName`, JWT `room` claim unprefixed | — | — |
| ~~Is `participantsSoftLimit` configurable per room, or fixed at 30 in the plugin?~~ — **answered 12 Nov: there is no seat cap.** `participantsSoftLimit = 0` on `[webinar]` rooms. Everyone without `moderator: true` is a visitor from arrival one; presenters hold the main room through the plugin's `moderators` list | — | — |
| ~~Should a small event (under 30 buyers) be watch-only at all?~~ — **answered 12 Nov: yes, at every headcount.** Watch-only is the product behaviour of an event, not a consequence of its size | — | — |
| `room_metadata_component` on each visitor node, and on the main host of `devvideo` | Infra | A presenter's whiteboard, and every other room-state feature, reaching the audience at all |
| Why a room routes students to visitor nodes while never advertising `muc#roominfo_visitorsEnabled` | Infra | "Move to viewer" in the presenter's participant menu — it is the only thing that flag reads |
| Does a visitor need Jitsi chat, or does the Aauti feed cover it? | Product | Infra's visitor-UI sign-off |
| Real audience size | Infra load test | Phase 3 seat cap |
| Who triggers the JVB scale-up 30 min before a webinar | Unclaimed | Nothing yet, but it breaks the first real webinar if nobody owns it |
| Workshops where attendees are meant to talk | Product | Nothing yet |

The audience size is worth pressing early even though it only gates Phase 3.
Infra's costing, their node counts and our seat cap all hang off it, and nobody
has stated a target — the 500 figure travelled from our own brief into their
capacity plan without ever being a requirement. Production's busiest moment in
the last 15 days was four participants.

---

## 11. Rejected alternatives

**AV-moderated single room.** Audience stays in the main MUC with unmute
blocked. Zero server work, and the host's approve flow already exists at
[`react/features/participants-pane/components/web/ParticipantQuickAction.tsx`](react/features/participants-pane/components/web/ParticipantQuickAction.tsx).
Rejected on capacity: every attendee remains a full MUC occupant, so presence
broadcast is the ceiling — realistically 50–75. Still the right fallback if
visitor-mode deployment stalls.

**Live streaming to a player in our app.** Jibri pushes RTMP; attendees watch an
embedded player. Rejected: 10–30s delay, no promotion path ever, one Jibri
occupied per stream (plus another to record), and per-viewer-minute delivery
cost. YouTube specifically also leaks the paywall — an unlisted video is
watchable by anyone with the id, and domain-locked embedding is partner-only.
If ever revisited, use a provider with signed playback (Cloudflare Stream, Mux,
AWS IVS), never YouTube.

Infra's own costing agrees: visitor mode at $27–38 per 500-viewer hour against
$30–32 for Cloudflare Stream or Mux and ~$48 for AWS IVS, with raise-hand built
in rather than an app-side build.

---

## 12. Change log

Newest first. Add a row whenever a phase moves, a decision closes, or infra's
answers change what we build.

| Date | Change | Why |
|---|---|---|
| 2026-11-13 | **A visitor mounts the whiteboard read-only, and the reason they see nothing at all is named.** `Whiteboard.tsx` passes `viewer` instead of `editor` when `iAmVisitor` (`64e8ef332`). Added the `room_metadata_component` row to §4, the whiteboard item to Phase 4, and two rows to §10 | Asked whether a visitor can see a presenter's board. They should: the board id rides room metadata like polls and the lobby, and `VISITORS_MODE_BUTTONS` already denies them a whiteboard button, so watching is the only thing they could do with it. Testing showed a black screen instead — `conference.metadata` is the full object on the presenter and `null` on the visitor. `mod_visitors` forwards it to the vnode and `mod_fmuc` stores it and fires `room-metadata-changed`, but `mod_fmuc`'s own comment says the rebroadcast is expected from "a room_metadata_component enabled on this host", and the vnodes have none. Separately, the presenter's "Move to viewer" is missing on sandbox because `features/visitors.supported` is false: the room routes students to visitor nodes and its metadata says `visitorsEnabled: true`, yet it never advertises `muc#roominfo_visitorsEnabled` in disco#info |
| 2026-11-12 | **The 30-seat soft limit is dropped.** `participantsSoftLimit = 0` on `[webinar]` rooms: everyone without `moderator: true` is a visitor from arrival one. Both §10 questions about the limit close; §2, §3 and §4 updated to match | The 30 was infra's number, carried from their 30 Oct response into the plugin they are writing, and it was only ever recorded here as an open question — so they kept building to the one figure on paper. A cap makes watch-only a function of arrival order; the product wants it to be a function of role. `always_visitors_enabled` is not this knob — it marks rooms visitor-capable, it does not place anyone |
| 2026-11-12 | **Webinar joins fail on sandbox at the token, not at routing.** An attendee gets `dialog.tokenAuthFailed` and a reconnect loop. Sandbox has `enable_domain_verification` on (prosody's default is `true`), so the `[webinar]` tenant is checked against `sub`, which carries the domain | §5 recorded the setting as off on prod and the token contract was written against that. Ordinary classes are unaffected because they carry no tenant prefix. Nothing to change on our side — with verification off, `verify_room` checks the room name only and already accepts `[webinar]<roomId>` against the unprefixed `room` claim |
| 2026-11-10 | **Phases 1, 2 and 4 confirmed committed and pushed** as `961527fbe` on `origin/feature/adhoc-live-events`. Added §3 "Who is a presenter" and "The soft limit is not a presenter/attendee split", and the connection + token contract in Phase 1. Two open decisions added about `participantsSoftLimit` | Infra (Vidhyadhari Sai) asked for sample connection details and a JWT payload to write the plugin against, so the contract is now written down rather than living in a Teams thread. Documenting roles surfaced the soft-limit misreading: it is not presenters-vs-buyers, and an event under 30 seats never enters visitor mode at all |
| 2026-11-04 | **Phase 4 written.** Visitor flag read from the join event, `channelLastN = 2` on events, and the headcount badge switched to `audienceSize` from our own data. `tsc` clean on api, studio and `packages/web` | Checked first whether Jitsi could supply the count: `getVisitorsCount` exists in the client but `modules/API` forwards neither it nor the visitor total, so the number had to come from us. The one sent is registered seats, not live attendance — noted as a follow-up rather than quietly passed off as live |
| 2026-11-04 | **Phase 2 written.** An event seeds only the SP and co-instructors into `context.metadata.members[]`. Measured the real ceiling and corrected this plan: the break is ~30–50 members against nginx's default 8 KB request line, not 100+ | The uncapped roster made a webinar token unjoinable long before 500 seats. The measurement also showed a big ordinary class is already at risk, which is now an open item rather than an assumption |
| 2026-11-03 | **Phase 1 written.** `bookingMode` reaches the join path through `attachSessionParents`, and `getJoinInfo` now mints a prefixed client room name beside an unprefixed JWT `room` claim. `tsc --noEmit` clean on `services/api` | Infra's scenarios 1–8 were blocked on these two. Resolving the mode through the existing parent walk avoided both a second query and a metadata backfill |
| 2026-11-03 | **Phase 0 closed. `main` merged into `feature/adhoc-live-events` (`5c5f0368e`), and Phase 1 onward is written on that branch** | The 149-commit gap is gone and `bookingMode` is in scope where we work, so there is no rebase to own and the open decision about it closes. `dea53a829` now needs a decision of its own, since it reaches `main` with the branch |
| 2026-11-03 | **Phase 0 decided: the live-events branch has to land, there is no shortcut.** Reusing an existing `Schedule` field was investigated and rejected | The branch is not where the marker lives — it carries the whole product: `seatPrice`, the event-lock module, event pricing, cart/order/refund changes and ~20 marketplace components. Without it nothing can create or sell a webinar |
| 2026-11-03 | **Three items withdrawn** against infra's 3 Nov *Infra Changes* doc: the `context.user.moderator` claim, short-lived attendee tokens, and the room-name form question. Added the exact room-name spec, the `BASE_TAG` bump, and our answer on visitor chat | Their plugin accepts the top-level claim we already send, 24 h tokens are now explicitly OK, and they specified the room name outright. Only room name and seat cap are left on us |
| 2026-11-03 | Recorded the cause of the 2 Nov sandbox outage: random passwords in the chart restart prosody and jicofo on every sync, and jicofo lost the race | Confirms it was the redeploy, not our commits and not the values-file switch. Infra own the fix (fixed passwords + a jicofo liveness probe) |
| 2026-11-03 | Added infra's full nine-row change table, their five-step rollout schedule and the rollback procedure. Added "who triggers the JVB scale-up" as an unclaimed decision | Re-checked our plan against their doc; these were in theirs and missing from ours. Their week 2 is when Phase 1 must be done |
| 2026-11-03 | Rewritten against infra's 30 Oct response. Moderator claim changed from "move" to "send in both places"; `sub` change and doors-open gating dropped; scoping plugin corrected from disco field to room metadata | Their `mod_token_moderation` reads only the top-level claim, `enable_domain_verification` is off, and Jicofo 1189 stopped reading the disco field |
| 2026-11-03 | Phase 0 added as a blocker in its own right | `bookingMode` sits on a branch 149 commits behind `main`, up from 93 — room naming cannot be written without a webinar marker |
| 2026-11-03 | Added §4 (what DevOps builds), §9 (test plan), §10 (open decisions), §12 (this log) | Infra's response gave us their scope, their scenarios and their timeline |
