# ANINA Booking System

A full booking platform for the studio: **clients** book classes, **instructors**
accept bookings and confirm classes once enough people join, and **ANINA Admin**
owns the rooms and monitors every schedule.

- **Backend:** Node + Express + MongoDB (Mongoose), in [`server/`](./server)
- **Frontend:** React + Vite, calendar-first UI (Google-Calendar weekly view), in [`app/`](./app)
- **Auth:** Google sign-in (primary) + a local dev-login for testing without Google
- The marketing site at the repo root is untouched.

## Prerequisites (already set up on this machine)
- Node ≥ 18
- MongoDB 7 (Homebrew, native arm64): `brew services start mongodb-community@7.0`
  - Data lives at `mongodb://127.0.0.1:27017/anina`

## Run it locally

```bash
# 1. API
cd server
cp .env.example .env          # already done; fill GOOGLE_CLIENT_ID when ready
npm install
npm run seed                  # sample rooms, users, and a week of classes
npm start                     # → http://localhost:4000

# 2. Frontend (new terminal)
cd app
cp .env.example .env          # already done
npm install
npm run dev                   # → http://localhost:5173
```

Open http://localhost:5173. With `VITE_ALLOW_DEV_LOGIN=true` you can sign in as any
seeded user (Admin / Instructor / Client) without Google.

## Seeded accounts (dev-login)
| Role | Email |
|---|---|
| Admin | patrick.ong.wong@gmail.com |
| Instructor | joycee@aninasanctuary.ph · maya@aninasanctuary.ph |
| Client | client1..4@example.com |

Rooms: **Studio A** (12), **Studio B** (8), **Private Room** (2).

## Turning on real Google sign-in
1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID → Web application**.
2. Add `http://localhost:5173` as an **Authorized JavaScript origin**.
3. Paste the Client ID into **both**:
   - `server/.env` → `GOOGLE_CLIENT_ID=...`
   - `app/.env` → `VITE_GOOGLE_CLIENT_ID=...`
4. Restart both servers. The Google button appears on the login screen.
   - Any email listed in `server/.env` `ADMIN_EMAILS` becomes **admin** on first login.
   - Everyone else starts as **client**; admin promotes people to **instructor** under **People**.

## Going live later
Only the API needs a host. Point `server/.env` `MONGO_URI` at a hosted database
(e.g. MongoDB Atlas) and deploy the Node server — no code changes. Set `app/.env`
`VITE_API_BASE` to the deployed API URL and rebuild the frontend.

## Core rules enforced by the API
- **Room conflicts:** two non-cancelled sessions can't overlap in the same room
  (or for the same instructor) — rejected with `409`.
- **Capacity:** a session's capacity can't exceed the room's admin-set max. Seats are
  claimed atomically on accept, so the last seat can't be oversold; overflow → waitlist.
- **Min to run:** an instructor can only **Confirm** a class once `accepted ≥ minToRun`.
- **Roles:** clients never see drafts; only instructors/admin create sessions; only
  admin manages rooms and roles.

## Memberships & subscriptions (Xendit)

Clients subscribe to an admin-defined **membership tier** (fixed-amount monthly
plan in PHP). **An active membership is required to book classes.** Billing runs
through [Xendit subscriptions](https://docs.xendit.co/recurring/fixed-amount-subscription).

- **Admin → Tiers**: create/edit membership plans (name, amount, interval, benefits).
- **Client → Membership**: subscribe, complete payment, see status, cancel.
- **Admin → Memberships**: monitor every client's subscription + billing status.

**Simulation mode (default, no keys needed).** With `XENDIT_SECRET_KEY` empty,
no external calls are made — a client subscribes and taps **“Complete payment
(simulated)”** to activate. This exercises the full state machine locally.
Set `XENDIT_SIMULATION=true` to force simulation even when a key is saved.

**Going live with Xendit:**
1. Create a Xendit account; activate at least one MIT-capable payment channel.
2. Put a development key in `server/.env` → `XENDIT_SECRET_KEY=xnd_development_...`
   and set `XENDIT_WEBHOOK_TOKEN` to a secret.
3. In the Xendit dashboard, point the subscription webhook at
   `https://<public-host>/api/webhooks/xendit` with that same token. Locally,
   expose it with a tunnel (ngrok/cloudflared).
4. Subscribing now redirects the client to Xendit's hosted checkout; webhooks
   (`recurring.plan.activation`, `recurring.cycle.succeeded/failed`,
   `recurring.plan.inactivated`) drive the membership status automatically.

Membership status → booking: `active` (in-period) can book; `pending`,
`past_due`, `cancelled`, `inactive` cannot (API returns `402`).

## API surface (all under `/api`)
- `POST /auth/login` · `POST /auth/google` · `POST /auth/dev-login` (dev) · `GET /auth/me`
- `GET/POST /rooms` · `PATCH/DELETE /rooms/:id` (admin)
- `GET/POST /sessions` · `PATCH /sessions/:id` · `POST /sessions/:id/{publish,confirm,cancel}` · `GET /sessions/:id/bookings`
- `POST /bookings` · `GET /bookings/mine` · `POST /bookings/:id/{accept,decline,waitlist,cancel}`
- `GET /users` · `GET /users/instructors` · `PATCH /users/:id/role` · `PATCH /users/:id/active` · `POST /users` · `DELETE /users/:id`
- `GET/POST /tiers` · `PATCH/DELETE /tiers/:id` (admin)
- `GET /memberships/mine` · `POST /memberships/subscribe` · `POST /memberships/:id/cancel` · `GET /memberships` (admin) · `POST /memberships/:id/simulate` (dev)
- `POST /webhooks/xendit` (public, token-verified)
