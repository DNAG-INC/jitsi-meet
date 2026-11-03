# Live Events (Webinar) — Implementation Plan

**This file is the source of truth.** Update it on every change and add a row to
the change log (§12). If something here contradicts a Slack thread or an older
doc, this file wins.

Status: **infra side built, not deployed.** Visitor mode is built on
`DNAG-PlatformEngineering/aauti-jitsi` branch `aauti-jitsi-sandbox` (commit
`75c4b9e`), switched on by `webinar.enabled: true` in `values-sandbox.yaml`
only — prod and devvideo render byte-identical to `main`. Sandbox ArgoCD still
targets `main`; deploying means repointing it at the branch.

Booking half built on `aauti-platform` branch `feature/adhoc-live-events`
(unmerged, **149 behind main**, no automated tests).

**Two app changes left: the webinar room name and the seat cap.** Everything
else infra originally asked us for is either already satisfied by the current
token or has been withdrawn — see §5.

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
5. `mod_webinar_visitors` recognises the prefix and sets room **metadata** `visitorsEnabled` and `participantsSoftLimit = 30`
6. Jicofo places the first 30 arrivals in the main room and redirects the rest to a visitor node
7. `mod_fmuc` mirrors presenter presence to the visitor node; **visitor presence is never broadcast** — this is what makes it scale
8. Media still flows through JVB. Visitor nodes carry **no** audio or video
9. Raise hand → request forwarded to the main room → presenter approves → visitor moved in with send capability
10. Jibri stays in the main room via the ignore list and records normally

Three behaviours from infra's response that shape everything downstream:

- **Presenters are pinned.** The plugin copies presenter IDs from the JWT into the room's `moderators` list, and Jicofo keeps those users in the main room whenever they arrive. Arrival order stops mattering.
- **Freed slots never reopen.** Once the first visitor exists, every later joiner is a visitor even if a main-room participant leaves. The only way back is promotion.
- **Promotion ignores the limit.** Approving a raised hand can take the main room above 30. Nothing in our accounting may hardcode 30.

---

## 4. What DevOps is building

Four pieces do not exist in Jitsi or our deployment. Infra own all of them.

| Piece | What it does |
|---|---|
| `mod_webinar_visitors` (new, ~40 lines) | Flags only `[webinar]` rooms, sets `participantsSoftLimit = 30`, copies presenter IDs into `moderators`. Other rooms never match |
| `mod_token_moderation` (update) | Today reads only the top-level `moderator`; will also accept `context.user.moderator` |
| Visitor-node JWT auth | Visitor nodes are anonymous today, so paid seats are unenforced. This is why every attendee needs a token |
| Visitor prosody deployment + routing | Helm StatefulSet, service, cert, s2s link, nginx routes for visitor websockets and `/conference-request/v1` |

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
| 0 | A reliable marker distinguishing webinars from classes | Blocked | `bookingMode` on a branch 149 behind main |
| 1 | Booking mode at join, room naming, moderator claim | Not started | Phase 0, for room naming only |
| 2 | Short-lived attendee tokens, slimmer token payload | Not started | Phase 1 |
| 3 | Server-side seat cap, buyer-facing copy | Blocked | Infra load test, their week 2–3 |
| 4 | Visitor flag, participant count, `channelLastN` | Not started | Nothing |

### Phase 0 — Mark a webinar session

We cannot name a room `webinar/<id>` until we can tell a webinar from a class,
and the field that does that is stranded. No code to write; the most leverage.

`Schedule.bookingMode` exists on `feature/adhoc-live-events` and nowhere else.
That branch carries 3 commits of its own and is **149 behind `main`** — it was
93 behind in early October, so the gap is widening, and there is no database
with data to walk it against.

**Decided 3 Nov: the branch has to land. There is no shortcut.**

Reusing an existing field (`typeTag`, `subType`, `classTypes`) looked like a way
to unblock room naming today. It isn't. The branch is not where the marker
lives — it is the whole live-events product, and without it there is no webinar
to put in a webinar room.

What the two relevant commits actually carry:

| `f136cd6bc` — backend | `d33d87198` — studio + marketplace |
|---|---|
| `bookingMode` + `seatPrice` migration | ~20 new event components: reserve card, seat picker, date strip, sold-out / live / ended cards, mobile CTA |
| New `adhoc-event-lock` domain module | `_event-container.tsx`, 390 lines |
| Event pricing (`adhoc-card-price`, `adhoc-line-price`) | Event detail routes and purchase gates |
| Cart, order, enrollment, package and refund changes | |
| `schedule.service.ts`, 459 lines | |

A third commit on the branch, `dea53a829` (course batch tabs), is unrelated to
live events and should not come with it.

Two things worth knowing before the rebase:

`seatPrice` already exists there — "the fixed price of one seat on one date" —
so Phase 3's seat cap has a price model waiting rather than needing one
invented.

The event UI on that branch predates visitor mode, so its buyer-facing copy
still describes a group session. The Phase 3 copy work applies to those new
components, not to the old `event-facts.ts`.

- [ ] Agree who owns the rebase of `f136cd6bc` and `d33d87198` onto `main`
- [ ] Leave `dea53a829` behind, or land it separately on its own merits

### Phase 1 — Unblock DevOps testing

Three changes, almost all in
`aauti-platform/services/api/src/modules/session/providers/video-conference.service.ts`.
Infra mark the first two as blocking their scenarios 1–8.

**1. Resolve booking mode at join.** `bookingMode` lives on `Schedule` and the
join path never looks it up. `session.metadata` already carries
`{ scheduleId, seriesId }`, denormalised by design, so this is one lookup — or
write the mode into `session.metadata` at generation, which is the pattern that
field exists for. *Needs Phase 0.*

**2. Room naming.** `generateRoomId()` returns `${session.id}-aauti-${roomEnv}`
today, no prefix. Webinar sessions gain the `webinar/` tenant prefix. Decide
whether the prefix rides the iframe `roomName` or the `/webinar/<roomId>` URL —
we embed, so `roomName`, but `getJoinUrl()` builds from the same value and must
agree. *Needs Phase 0.*

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

- [ ] Booking mode resolved at join
- [ ] Room naming with the `webinar/` prefix on `roomName` only

### Phase 2 — Attendee join path

Visitor nodes reject anyone without a token, so every attendee needs one. We
already mint a token per caller in `getJoinInfo`, so the work is shape and size,
not a new flow.

**~~Short-lived attendee tokens.~~ Withdrawn 3 Nov.** The 30 Oct response asked
for event length plus 30 minutes; the 3 Nov doc marks attendee tokens *"Already
done — every join gets a token, valid 24 h"* and lists `exp` as OK. The only
requirement now is that the token **outlasts** the event, which 24 h does. No
change.

**Slim the token payload.** `getJoinInfo` builds `context.metadata.members[]`
from the SP, co-instructors and **every enrolment**, uncapped, and the token
travels in a URL query string. At 100+ seats this exceeds practical URL length;
at 500 it is hopeless. Presenters only for webinars, or drop the pre-seed and
let the board fetch its own roster. A large ordinary class already trips this,
so it is worth fixing regardless.

- [ ] Cap or drop `context.metadata.members[]` for webinar tokens
- [ ] Check token length against a 500-seat webinar before testing

### Also ours, from the 3 Nov doc

**Bump `BASE_TAG`.** `docker-build/Dockerfile:21` still pins
`stable-11146-2` while the client is 11248, so the image template set and the
client disagree. Infra flag it as "when convenient", but it is ours and it is
one line.

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

**Read the visitor flag.** `videoConferenceJoined` carries `visitor` and
`external_api.js` exposes `isVisitor()`;
`apps/studio/src/components/sessions/jitsi-room.tsx` discards the payload.

**Participant count from our own data.** `live-session-overlay.tsx` counts Jitsi
`participantJoined` events. Visitors are not in the main room's roster, so a
presenter would see 3 while 500 watch.

**Set `channelLastN`.** Unset means unlimited — every client subscribes to every
other. One value in `configOverwrite`. Infra's costing puts "forward only one or
two speakers" among the largest savings on a webinar running $27–38/hour, almost
all of it bandwidth, so this is a money item.

- [ ] Keep the `videoConferenceJoined` payload and read `visitor`
- [ ] Replace the Jitsi-derived participant count for webinars
- [ ] Set `channelLastN` in `configOverwrite`

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
| Rebase `bookingMode` onto `main`, or use an existing `Schedule` field | Us | Phase 1 room naming, and infra's scenario 9 |
| ~~Room-name form~~ — **answered 3 Nov**: prefix on the iframe `roomName`, JWT `room` claim unprefixed | — | — |
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
| 2026-11-03 | **Phase 0 decided: the live-events branch has to land, there is no shortcut.** Reusing an existing `Schedule` field was investigated and rejected | The branch is not where the marker lives — it carries the whole product: `seatPrice`, the event-lock module, event pricing, cart/order/refund changes and ~20 marketplace components. Without it nothing can create or sell a webinar |
| 2026-11-03 | **Three items withdrawn** against infra's 3 Nov *Infra Changes* doc: the `context.user.moderator` claim, short-lived attendee tokens, and the room-name form question. Added the exact room-name spec, the `BASE_TAG` bump, and our answer on visitor chat | Their plugin accepts the top-level claim we already send, 24 h tokens are now explicitly OK, and they specified the room name outright. Only room name and seat cap are left on us |
| 2026-11-03 | Recorded the cause of the 2 Nov sandbox outage: random passwords in the chart restart prosody and jicofo on every sync, and jicofo lost the race | Confirms it was the redeploy, not our commits and not the values-file switch. Infra own the fix (fixed passwords + a jicofo liveness probe) |
| 2026-11-03 | Added infra's full nine-row change table, their five-step rollout schedule and the rollback procedure. Added "who triggers the JVB scale-up" as an unclaimed decision | Re-checked our plan against their doc; these were in theirs and missing from ours. Their week 2 is when Phase 1 must be done |
| 2026-11-03 | Rewritten against infra's 30 Oct response. Moderator claim changed from "move" to "send in both places"; `sub` change and doors-open gating dropped; scoping plugin corrected from disco field to room metadata | Their `mod_token_moderation` reads only the top-level claim, `enable_domain_verification` is off, and Jicofo 1189 stopped reading the disco field |
| 2026-11-03 | Phase 0 added as a blocker in its own right | `bookingMode` sits on a branch 149 commits behind `main`, up from 93 — room naming cannot be written without a webinar marker |
| 2026-11-03 | Added §4 (what DevOps builds), §9 (test plan), §10 (open decisions), §12 (this log) | Infra's response gave us their scope, their scenarios and their timeline |
