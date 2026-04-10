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
- [ ] Run the relevant tests/builds/lints for every touched area and record any commands that could not be run.

## Required Implementation Scope

- [ ] Make backend-side short links canonical at `https://leaflet.lair.nntin.xyz/s/<code>`.
- [ ] Keep backend redirects as real HTTP redirects so non-browser clients do not depend on GitHub Pages or browser JavaScript.
- [ ] Split backend URL configuration as described in `Plan.md`, including CORS, CSRF, short-link base, OpenAPI server origin, OAuth return targets, and required production secrets.
- [ ] Update frontend URL handling so both the Docker/subdomain frontend and the GitHub Pages frontend call the backend correctly.
- [ ] Remove the frontend Nginx backend proxy dependency and keep frontend networking limited to the shared edge network.
- [ ] Make GitHub Pages deployment changes in the Leaflet repository, not the parent repository.

## GitHub Pages Pipeline Stop Point

- [ ] Create a frontend deployment pipeline that builds the Vite frontend and publishes the generated `dist` output to an orphaned GitHub Pages branch, for example `gh-pages`.
- [ ] Ensure the orphaned Pages branch contains only generated publishable frontend assets and no source or secrets.
- [ ] After the pipeline and orphaned branch setup are created, stop and ask the operator to enable GitHub Pages in GitHub settings for the chosen Pages branch.
- [ ] Do not continue Pages validation until the operator confirms GitHub Pages has been enabled.
- [ ] After confirmation, resume the plan and validate the GitHub Pages deployment paths in `Plan.md`.

## Validation Expectations

- [ ] Run backend tests after backend/auth/CSRF/redirect changes.
- [ ] Run frontend build/lint after frontend URL/base-path changes.
- [ ] Run Docker Compose config validation after Compose changes.
- [ ] Validate backend short-link behavior with HTTP redirect checks where the environment allows it.
- [ ] Validate GitHub Pages behavior only after the operator confirms the Pages branch has been enabled.
