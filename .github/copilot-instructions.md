# 🌱 AGENTS.md — Leaflet Engineering Standards

## 🎯 Purpose
This document defines the **non-negotiable engineering standards** for all contributors and AI agents working on Leaflet.

Leaflet is a **privacy-first, self-hosted system**. Code must be **secure, predictable, and maintainable**.

---

## 🧱 Core Principles

### 1. Type Safety (Strict)
- **TypeScript is mandatory**
- `strict: true` must never be disabled
- No `any` unless explicitly justified with a comment
- All API inputs/outputs must be **fully typed**

---

### 2. Testing Strategy (Priority Order)

Tests are required for all non-trivial logic.

**Priority:**
1. **Integration tests (PRIMARY)**
2. **End-to-End tests**
3. **Unit tests (LOWEST priority)**

#### Rules:
- Test real behavior over implementation details
- Prefer testing via HTTP/API boundaries
- Avoid over-mocking
- Every bug fix must include a test

---

### 3. API-First Design
- Backend is the **single source of truth**
- CLI and frontend must use the API only (no internal access)
- OpenAPI spec must stay **accurate and in sync**

---

### 4. Security & Privacy
- No tracking, analytics, or fingerprinting
- Validate and sanitize all inputs
- Rate limiting must never be bypassable
- Admin routes must be protected
- Never log sensitive data

---

### 5. Simplicity Over Cleverness
- Prefer **clear, explicit code** over abstraction
- Avoid premature optimization
- Keep functions small and composable

---

### 6. Error Handling
- Errors must be:
  - Descriptive
  - User-safe
  - Consistent
- API errors must follow a standard format:
```json
{
  "success": false,
  "error": "Message",
  "hint": "Actionable suggestion"
}
```

---

### 7. CLI Standards
- Must remain **stateless**
- Must support `--json` for all commands
- Errors must include **hints and examples**
- Never silently fail

---

### 8. Code Quality
- Linting and formatting are enforced
- No dead code
- No commented-out blocks
- Naming must be explicit and meaningful

---

## 🚫 Anti-Patterns (Disallowed)

- Using `any` without justification
- Skipping tests for “simple” logic
- Tight coupling between services
- Hidden side effects
- Direct DB access from CLI/frontend

---

## ✅ Definition of Done

A change is complete only if:

- [ ] Fully typed (no unsafe types)
- [ ] Integration tests added/updated
- [ ] API contract respected
- [ ] Errors handled properly
- [ ] No impact on privacy guarantees
- [ ] Code is readable and maintainable

---

## 🧠 Guiding Philosophy

> Build systems that are **easy to reason about**, not just easy to write.

Clarity > Cleverness  
Correctness > Speed  
Privacy > Convenience