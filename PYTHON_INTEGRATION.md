# Python Integration Guide

This project now supports a minimal Python-to-frontend data flow with no major frontend refactor.

## What was integrated

- Python exports in `Project-001/` are now consumed by the Node backend adapter.
- Existing frontend API calls remain unchanged:
  - `GET /api/topology`
  - `GET /api/nodes/:id`
  - `GET /api/links/:id`
  - `GET /api/situation/current`
  - `GET /api/events`
  - `POST /api/topology/events`
  - `POST /api/python/commands` (node add/remove/update queue)

## Data flow

1. Python script generates JSON files:
   - `Project-001/snapshot.json`
   - `Project-001/metrics.json`
   - `Project-001/event_node_update.json`
   - `Project-001/event_link_update.json`
2. Node backend reads these files and maps fields to the frontend contract.
3. React frontend keeps using existing REST APIs and renders mapped data.
4. Frontend control panel can send minimal Python commands to Node.
5. Node appends commands into `Project-001/command_queue.jsonl`.
6. Python loop reads command queue and applies node add/remove/update.

## Run order (important)

1. Generate Python data

```bash
npm run generate:python
```

2. Start backend (reads Python JSON and serves REST)

```bash
npm run start:server
```

Or run both step 1 and 2 with one command:

```bash
npm run start:server:python
```

For quasi-realtime demo data (node/link add-remove-update), run Python in loop mode in another terminal:

```bash
npm run generate:python:loop
```

This loop rewrites:

- `snapshot.json`
- `metrics.json`
- `event_node_update.json`
- `event_link_update.json`
- `event_node_add.json`
- `event_node_remove.json`
- `event_link_add.json`
- `event_link_remove.json`

3. Start frontend

```bash
npm start
```

The frontend now polls REST APIs (default every 5 seconds) and has a manual `Refresh` button in the top control panel.
You can change poll interval via:

```bash
set REACT_APP_TOPOLOGY_POLLING_MS=3000
npm start
```

## Optional backend environment variables

- `PYTHON_DATA_DIR`: override Python export directory.
  - Default: `<repo>/Project-001`
- `USE_PYTHON_EXPORTS=false`: disable Python adapter and use old in-memory seed backend.
- `EVENTS_FILE_PATH`: override runtime event storage file for `POST /api/topology/events`.
- `PYTHON_COMMANDS_FILE_PATH`: override Python command queue file path (default `Project-001/command_queue.jsonl`).

Example:

```bash
set PYTHON_DATA_DIR=C:\path\to\exports
set USE_PYTHON_EXPORTS=true
npm run start:server
```

## Notes

- Frontend fallback behavior is unchanged: if REST fails, frontend still falls back to local mock topology.
- The adapter normalizes Python fields for frontend compatibility (for example `adhoc_node -> mesh-node`, `adhoc -> mesh`, and health score mapping to `healthScore`).
