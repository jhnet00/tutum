# Work Plan: Admin Monitoring Operational Follow-ups

> Created: 2026-03-17
> Scope: `/admin` monitoring dashboard
> Branch target: `develop`

## 1. Why this plan exists

The current admin page is already useful for one-screen monitoring:

- cluster overview, infra, pipeline, data, backup, logs, and traces are available in one place
- logs and traces are already connected to Loki and Tempo
- AI-based diagnosis exists per tab

The next gap is operator usability during real incidents.
The page still needs clearer ownership, runbook guidance, and operational context on top of raw metrics.

## 2. Goals

Turn `/admin` from a good dashboard into a more actionable operator console.

## 3. Priority backlog

### P0 - This turn

- [x] Add owner metadata to `/api/v1/admin/action-needed`
- [x] Add signal/source metadata to `/api/v1/admin/action-needed`
- [x] Add runbook reference text to `/api/v1/admin/action-needed`
- [x] Render the new metadata in the Pipeline tab action cards
- [x] Replace garbled alert copy in the action-needed backend response

### P1 - Next

- [ ] Add deploy/change markers on Overview charts
- [ ] Add runbook links or deep links to the relevant investigation screen
- [ ] Add alert acknowledgement or mute state for known noise
- [ ] Expand trace search beyond `tutum-backend` so auth/workers are included
- [ ] Add a synthetic check section for `tutum.my`, login, and core APIs

### P2 - Later

- [ ] Add service-level SLO and burn-rate cards
- [ ] Add incident timeline/history view
- [ ] Add release version correlation to logs and traces

## 4. Decision note on Kibana

Kibana is useful for Elasticsearch document inspection, mapping checks, and search relevance debugging.
It is not the primary missing piece for day-to-day ops on `/admin`.
For normal monitoring and incident response, the higher priority remains:

- action context
- runbook guidance
- trace/log correlation
- synthetic checks
- SLO visibility

## 5. Files expected in this turn

- `backend/app/routers/admin.py`
- `frontend/app/admin/page.tsx`

## 6. Acceptance criteria

- `/api/v1/admin/action-needed` returns actionable metadata beyond `level/category/message/action`
- Pipeline tab shows owner, signal/source, and runbook context per alert
- Alert copy is readable and not mojibake
- Backend compile and frontend lint pass

