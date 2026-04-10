# Leaflet Implementation Handoff

You are implementing `projects/leaflet/Plan.md` end to end. `projects/leaflet` is a git submodule for `https://github.com/NNTin/leaflet`; make Leaflet application changes inside the submodule, and only touch the parent `lair.nntin.xyz` repository when the plan explicitly requires parent-repo integration.

## Operating Rules

- [ ] Read `projects/leaflet/Plan.md` before making changes.
- [ ] Treat `projects/leaflet/.env` as the source for required local/deployment secrets, including the Cloudflare token if it becomes necessary. Do not print, copy into chat, commit, or otherwise expose secret values.
- [ ] Implement the complete plan unless a blocker requires user input.
- [ ] Check off each checkbox in `projects/leaflet/Plan.md` as soon as that task is actually solved and validated.
- [ ] Commit regularly after coherent, tested units of work. Do not commit `.env` or generated secret material.
- [ ] If using subagents, spawn them sequentially only: one subagent at a time, wait for it to finish, review/integrate its work, then decide whether to spawn the next one.
- [ ] Traefik/DNS live validation is not required for this pass. Do not block completion on live DNS propagation or certificate issuance checks.
- [ ] Still implement the Traefik/Compose configuration required by the plan; skip only the live Traefik/DNS validation steps.
- [ ] GitHub Pages is already deployed. Continue from the current `main` branch deployment setup; do not stop for a Pages branch enablement step.
- [ ] Run the relevant tests/builds/lints for every touched area and record any commands that could not be run.

## Required Implementation Scope

- [ ] Make backend-side short links canonical at `https://leaflet.lair.nntin.xyz/s/<code>`.
- [ ] Keep backend redirects as real HTTP redirects so non-browser clients do not depend on GitHub Pages or browser JavaScript.
- [ ] Split backend URL configuration as described in `Plan.md`, including CORS, CSRF, short-link base, OpenAPI server origin, OAuth return targets, and required production secrets.
- [ ] Update frontend URL handling so both the Docker/subdomain frontend and the GitHub Pages frontend call the backend correctly.
- [ ] Remove the frontend Nginx backend proxy dependency and keep frontend networking limited to the shared edge network.
- [ ] Maintain GitHub Pages deployment changes in the Leaflet repository, not the parent repository.

## GitHub Pages Deployment Status

- [ ] Treat GitHub Pages as already deployed at `https://nntin.xyz/leaflet/`.
- [ ] Continue working on `main`; the operator confirmed that commits pushed to `main` update the frontend deployment.
- [ ] Do not create a new Pages stop point or ask the operator to enable Pages again unless a later deployment change actually breaks Pages settings.
- [ ] Validate `https://nntin.xyz/leaflet/` after frontend changes.
- [ ] Validate direct browser reloads for `/leaflet/developer` and `/leaflet/admin`. GitHub Pages can return an HTTP `404` status for nested SPA fallback routes while still serving the generated `404.html` body, so browser-level validation is more useful than `curl -I` alone.

## Validation Expectations

- [ ] Run backend tests after backend/auth/CSRF/redirect changes.
- [ ] Run frontend build/lint after frontend URL/base-path changes.
- [ ] Run Docker Compose config validation after Compose changes.
- [ ] Validate backend short-link behavior with HTTP redirect checks where the environment allows it.
- [ ] Validate GitHub Pages behavior after each frontend deployment-relevant change.
- [ ] Treat `leaflet.lair.nntin.xyz` live checks as DNS/deployment checks. Cloudflare now has a DNS-only CNAME for `leaflet.lair.nntin.xyz` pointing at the same target as `lair.nntin.xyz`, and public resolvers return the CNAME plus `84.60.76.145`. The local WSL resolver at `10.255.255.254` may still have a stale not-found result; use public resolver checks or wait for local cache propagation before concluding DNS is still broken.
