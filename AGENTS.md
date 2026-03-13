# AGENTS.md

## Source of truth
The primary requirements source for this repository is the project proposal and the derived development specification.
When implementation details are ambiguous, prefer the most conservative interpretation that best supports demo, acceptance, and thesis/project defense goals.

## Project goal
Build a prototype system for network situation awareness and visualization for a 3-layer heterogeneous communication network:
- backbone network
- ad hoc network
- access network

The system should support:
- unified modeling of nodes, links, cross-layer relations, events, and snapshots
- multi-layer topology visualization
- real-time situation updates
- interactive analysis
- historical replay
- deployable and testable engineering prototype

## Core roles and scenarios
Primary target users:
- network operations personnel
- network planners
- security analysts
- system administrators

Primary usage scenarios:
- full-network inspection
- anomaly localization
- cross-layer tracing
- historical replay
- capacity observation

## Core functional scope
The implementation scope should prioritize:
1. topology modeling
2. situation collection and computation
3. event-driven updates
4. visualization rendering
5. interactive analysis
6. historical storage and replay
7. RESTful APIs and WebSocket channels
8. testing and validation support

## Current implementation priority
Must implement first:
- unified data modeling
- REST + WebSocket integration
- dynamic topology visualization
- basic interaction: zoom, click, filter, search, details
- basic historical replay

Should implement when time allows:
- multi-layer overlay
- situation scoring
- alarm linkage
- trend analysis panels

Future extension only:
- intelligent prediction
- root-cause analysis
- digital twin simulation
- autonomous optimization

## Out of scope
Do not implement these unless explicitly requested:
- production-grade zero-trust authentication
- fine-grained RBAC
- distributed HA / geo-disaster recovery
- billion-scale real-time data platform
- full digital twin simulation system
- online deep learning training/deployment pipeline
- fully automated closed-loop network control
- multi-tenant commercial admin platform

## Recommended architecture
Preferred stack and responsibilities:
- Frontend: React + Leaflet
- Backend: Node.js
- Communication: RESTful APIs + WebSocket
- Frontend handles rendering, interaction, local state updates, visual encoding
- Backend handles model persistence, collection adapters, event handling, situation computation, APIs, replay organization

Do not change the tech stack unless explicitly asked.

## Data model expectations
Keep the system centered around these entities:
- Node
- Link
- CrossLayerRelation
- NetworkEvent
- SituationSnapshot
- MetricSeries
- SecuritySituation (optional extension)

At minimum:
- Node must represent layer, geo position, status, resource metrics, and update time
- Link must represent source/target, medium, bandwidth, delay, loss, availability, signal quality, and status
- Cross-layer relations must be first-class modeled data, not implicit UI-only logic

## API expectations
Minimum REST support:
- GET /api/topology
- GET /api/nodes/:id
- GET /api/links/:id
- GET /api/situation/current
- GET /api/situation/history
- GET /api/events
- POST /api/topology/events

WebSocket channels should support:
- topology:update
- metric:update
- alarm:update
- snapshot:update

Use versioned message envelopes where possible:
- type
- version
- timestamp
- trace_id
- payload

## Realtime and performance targets
Prototype targets:
- end-to-end event visibility latency < 2s
- configurable metric refresh interval between 1s and 5s
- history query response < 3s under medium-scale data
- normal interactive views target >= 30 FPS

These are prototype goals, not strict production SLAs.

## Engineering rules
- Do not rewrite the whole project unless explicitly requested
- Prefer incremental refactors over large rewrites
- Preserve existing project structure where possible
- Keep components modular
- Keep map rendering logic separate from business logic
- Keep real-time update logic separate from pure UI components
- If backend features are incomplete, use mock data but preserve future API integration points
- Do not introduce unnecessary complexity for features not needed for demo/acceptance
- Avoid changing UI style drastically unless explicitly requested
- Keep code readable and maintainable for student project continuation

## Implementation behavior for Codex
Before coding:
1. summarize the task in engineering terms
2. identify affected modules/files
3. explain the implementation plan
4. mention assumptions and risks

During coding:
1. keep changes scoped to the requested task
2. avoid touching unrelated modules
3. preserve backward compatibility where reasonable
4. add lightweight comments only where necessary

After coding:
1. summarize modified files
2. explain what changed and why
3. explain how to run and verify
4. mention incomplete items, tradeoffs, or risks

## Testing and validation
For each meaningful feature:
- verify compile/build success
- verify core user flow manually
- verify no obvious regression in existing topology rendering
- verify real-time update path if touched
- verify history/replay path if touched

When possible, include:
- a reproducible mock scenario
- sample data
- acceptance checklist

## Time and consistency rules
- Use consistent timestamps and timezone handling across frontend and backend
- Prefer incremental updates over full reloads for realtime data
- After reconnect, support cursor-based or last-known-point compensation where practical
- Maintain state consistency between topology, metrics, alarms, and snapshots

## Delivery standard
The repository should gradually evolve toward:
- runnable prototype
- documented API contracts
- documented data models
- deployment instructions
- test/verification notes
- materials that can support project acceptance and final reporting