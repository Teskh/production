# Tech Stack Proposal (Shop-Floor, On-Prem, 150 Users)

This project runs in a closed production environment with kiosk tablets and a QR-based login.
We want a reliable, low-ops stack without unnecessary complexity.

## 1) Chosen stack (balanced SPA + API)

1. **Frontend (Worker UI):** React + Vite (SPA)
2. **Backend API:** FastAPI (Python)
3. **Database:** PostgreSQL
4. **Auth + Sessions:** HTTP-only cookies; station context + worker session stored server-side
5. **Realtime updates:** WebSockets (FastAPI) for station queues and task state
6. **QR login camera access:** HTTP origin + Chrome policy/flag `InsecureOriginsTreatedAsSecure`

Why this stack:
- SPA keeps full-screen kiosk mode stable (no full-page reloads).
- FastAPI is lightweight, fast to iterate, and good for structured APIs.
- PostgreSQL is the simplest reliable choice for this data model and reporting needs.
- WebSockets cover live station updates without extra infrastructure.

## 2) Operational constraints (explicitly accepted)

1. **HTTP only for kiosk tablets**
   - Use Chrome `InsecureOriginsTreatedAsSecure` for camera access.
   - Accepts the operational risk of relying on a browser flag.
2. **Stable origin**
   - Fixed IP + port (or stable local hostname) so camera permission persists.
3. **Kiosk mode**
   - Tablets launch into a single SPA URL; routing stays in-app.
