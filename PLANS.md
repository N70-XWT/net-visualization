# PLANS.md

## Project execution plan
This document translates the development specification into phased implementation work for the current repository.

---

## Phase 0 - Repository audit and baseline alignment
### Goal
Understand the current repository and measure the gap between the current implementation and the target system.

### Tasks
- inspect frontend structure
- inspect backend structure
- inspect current topology rendering flow
- inspect current data flow and state handling
- inspect current real-time communication capability
- identify completed / partially completed / missing items against the specification

### Deliverables
- repository audit summary
- gap analysis report
- list of risky or ambiguous areas
- baseline development checklist

### Acceptance
- current repo architecture is clearly summarized
- known gaps are classified by priority
- next phase implementation scope is clear

---

## Phase 1 - Unified modeling and static visualization
### Goal
Establish the unified 3-layer network model and deliver a static but structured topology visualization prototype.

### Scope
- unified frontend/backend data model draft
- static topology rendering
- node and link rendering
- basic layer distinction: backbone / ad hoc / access
- cross-layer relation visualization
- basic map interaction: zoom, pan, click
- basic filter and search entry points

### Recommended tasks
- define Node, Link, CrossLayerRelation, NetworkEvent, SituationSnapshot, MetricSeries types
- add mock topology dataset
- normalize topology loading flow
- refactor map rendering into modular components if needed
- implement node detail panel
- implement link detail panel
- implement layer control UI
- implement basic search/filter UI

### Deliverables
- typed data model definitions
- mock data for static demo
- static topology analysis page
- click-to-view details
- layer-based rendering and filtering

### Acceptance
- user can see 3-layer topology
- user can distinguish nodes/links by layer and status
- user can click node/link to inspect details
- user can filter/search basic targets
- project still runs without regression

---

## Phase 2 - Backend services and data integration
### Goal
Build the backend service foundation and connect frontend to real APIs.

### Scope
- Node.js service setup/refinement
- REST API minimal set
- basic persistence design
- topology query support
- node/link detail query support
- current situation summary query support
- event query support

### Recommended tasks
- implement GET /api/topology
- implement GET /api/nodes/:id
- implement GET /api/links/:id
- implement GET /api/situation/current
- implement GET /api/events
- define API response contracts
- provide mock-backed or lightweight persisted backend
- connect frontend service layer to REST APIs

### Deliverables
- runnable backend service
- frontend-backend integration for core views
- API contracts and example payloads

### Acceptance
- frontend reads topology from backend, not only local mock files
- node/link detail panel can fetch server data
- current situation summary can be displayed
- APIs are stable enough for further realtime integration

---

## Phase 3 - Dynamic perception and realtime updates
### Goal
Enable event-driven updates and real-time visualization refresh.

### Scope
- event model implementation
- incremental topology/state update path
- WebSocket connection
- frontend partial refresh
- alarm and snapshot update support
- reconnect and compensation basics

### Recommended tasks
- implement WebSocket channels:
  - topology:update
  - metric:update
  - alarm:update
  - snapshot:update
- define standard message envelope
- implement event injection endpoint for testing
- update frontend store/state handling for incremental patches
- add WebSocket connection status indicator
- handle reconnect and missed-message compensation strategy

### Deliverables
- realtime data push pipeline
- dynamic node/link state updates
- live alarm/snapshot updates
- event simulation flow for demo

### Acceptance
- simulated events can change frontend state in near real-time
- topology view updates without full page reload
- WebSocket state is visible to the user
- reconnect behavior is at least basically handled

---

## Phase 4 - Historical storage, replay, and trend analysis
### Goal
Add replay and historical analysis capabilities for project acceptance and demo depth.

### Scope
- historical snapshot/query support
- time-series organization
- replay timeline UI
- event list and playback controls
- trend charts for nodes/links/situation

### Recommended tasks
- implement GET /api/situation/history
- organize historical snapshot format
- store and query MetricSeries
- build replay timeline component
- implement play/pause/seek controls
- build node/link trend charts
- support before/after comparison for replay scenarios

### Deliverables
- historical replay page
- trend chart panel
- event timeline and controls
- replay-ready mock or stored dataset

### Acceptance
- user can replay a time range
- user can inspect trend changes for node/link metrics
- historical events and snapshots are visibly connected to replay controls

---

## Phase 5 - System integration, test, and optimization
### Goal
Improve stability, usability, and acceptance readiness.

### Scope
- integration cleanup
- performance tuning
- interaction polishing
- documentation
- validation scenarios
- final demo preparation

### Recommended tasks
- optimize rendering performance for medium-scale topology
- reduce unnecessary rerenders
- improve incremental update efficiency
- validate FPS and interaction smoothness
- add deployment documentation
- add API and model documentation
- add scenario-based test notes
- prepare acceptance/demo script

### Deliverables
- integrated stable prototype
- deployment instructions
- API/model documentation
- test and validation notes
- demo checklist

### Acceptance
- system can run end-to-end
- major demo scenarios are stable
- documentation is sufficient for handoff, acceptance, and reporting

---

## Priority rules
### Must-have
- unified data modeling
- static + dynamic topology visualization
- REST + WebSocket path
- node/link details
- search/filter basics
- historical replay basic version

### Should-have
- multi-layer overlays
- situation score
- alarm linkage
- trend analysis panels

### Nice-to-have
- prediction
- root-cause analysis
- digital twin
- autonomous optimization

---

## Suggested task breakdown format for each development request
For every implementation task, follow this sequence:
1. understand the requirement
2. inspect related files/modules
3. propose a minimal implementation plan
4. implement with scoped changes
5. verify manually
6. summarize changes, risks, and next steps

---

## Recommended immediate next actions
1. complete repository audit
2. align current repo with Phase 1 scope
3. define the shared topology data model
4. make static visualization fully consistent with the unified model
5. then begin backend integration

---

## Demo-first principle
This is a student innovation project prototype.
Prefer:
- visible functionality
- stable demo flow
- clear engineering structure
- easy acceptance explanation

Do not prioritize:
- over-engineering
- production-scale infrastructure
- advanced capabilities that do not directly improve acceptance/demo value