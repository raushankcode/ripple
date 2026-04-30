# ripple — Ripple Workflow
*Copy this to your project root as CLAUDE.md (Claude Code) or .cursorrules (Cursor)*
*After copying: one-line prompts work safely. No repeated instructions needed.*

---

## YOUR AUTOMATIC PROTOCOL

You MUST run this protocol before every task — automatically, without being asked:

**Step 1:** Identify the file(s) involved in the task
**Step 2:** For each file, compute its focus path:
  - Formula: `.ripple/focus/{grandparent}-{parent}-{filename-no-extension}.json`
  - Example: `packages/features/auth/lib/authService.ts` → `.ripple/focus/auth-lib-authService.json`
  - Always verify using `availableFocusFiles` in context.json — exact keys are listed there
  - Full list: `.ripple/context.json` → `availableFocusFiles`
**Step 3:** Read the focus file (~200 tokens total)
**Step 4:** Check `modificationRisk`:
  - `"safe"` → proceed
  - `"caution"` → note callers, proceed carefully  
  - `"dangerous"` → STOP. Tell user: "This file has [N] importers. I recommend confirming the approach. Shall I proceed?"
**Step 5:** For every symbol you will modify, check its `calledBy` list. Every caller must still work.
**Step 6:** Check the symbol's `layer`. Only touch the layer the user asked for.

If task involves multiple files or you cannot identify the file → read `.ripple/context.json` first.

**MULTI-FILE CHANGES — follow this order:**
1. Read ALL relevant focus files before touching anything
2. Find shared types — modify types files FIRST
3. Modify core logic files SECOND
4. Modify UI and handler files LAST
5. Verify every `calledBy` caller works after each file change

---

## PLANNING FOR COMPLEX TASKS

For any task touching more than one file, run this planning algorithm BEFORE writing any code:

**Step 1 — Find the starting file.**
Identify the most central file for the task (e.g. for "update auth flow" → start with `authService.ts`).
Read its focus file from `availableFocusFiles` in context.json.

**Step 2 — Chain exploration (1-2 levels deep).**
Look at the `imports` and `importedBy` arrays in that focus file.
Read focus files for the most relevant dependencies and dependents.
Stop after 2 levels — this gives you the full blast surface without noise.

**Step 3 — Formulate the plan BEFORE touching any code.**
State to the user exactly which files you will change and in what order.

Example plan format:
```
To implement [task], I will make the following changes:
1. types/auth.ts       — add PasskeyCredential type  [caution, 3 importers]
2. lib/authService.ts  — update login() logic         [dangerous, 7 importers]
3. components/LoginButton.tsx — update UI handler     [safe, 0 importers]

Shall I proceed in this order?
```

**Step 4 — Wait for user confirmation before writing any code.**

**Why this matters:** An agent that starts coding a complex refactor before mapping the full surface will miss files, create inconsistencies, and produce broken changes at scale. The plan step uses your graph data — not guesswork — to map the real scope of the change.

---

## THIS PROJECT

**What this project does:** See exactly what your code change will break before you make it. Ripple shows caller count, dependency graph, and blast radius instantly — plus generates AI-ready context for tools like Copilot and Cursor.
**Files tracked:** 6
**Framework:** Unknown — check build config
**Import style:** Use relative imports
**Entry points:** /src/extension.ts
**State management:** useState
**Styling:** see context.files.json
**Testing:** none detected
**New files go in:** 

---

## FOCUS FILES IN THIS PROJECT

- types.ts [safe] → .ripple/focus/ripple-src-types.json
- normalizer.ts [caution] → .ripple/focus/ripple-src-normalizer.json
- graph.ts [safe] → .ripple/focus/ripple-src-graph.json
- extension.ts [safe] → .ripple/focus/ripple-src-extension.json

---

## ONE-LINE PROMPT EXAMPLES

After you copy this file, these one-line prompts work safely:

| User says | What you do |
|-----------|-------------|
| "Update the login logic" | Find login file → read focus → check calledBy → modify layer:logic only |
| "Fix the button styling" | Find button file → read focus → modify layer:ui only |
| "Add a new API endpoint" | Read context.json → check entryPoints + safeToCreateIn → create file |
| "Debug why auth is broken" | Read context.json → check lastChangeGroup → trace with context.symbols.json |
| "Add email validation" | Find form file → read focus → check if validator exists in orphanedSymbols |

---

## LAYER TARGETING

Every symbol has a `layer` field in its focus file:

| Layer | What it means | When to touch |
|-------|---------------|---------------|
| `logic` | Pure computation | "change the logic/algorithm/calculation" |
| `ui` | JSX rendering | "update the UI/design/layout" |
| `handler` | Event handlers | "change what happens on click/submit" |
| `state` | React state | "update the state management" |
| `data` | API/fetch calls | "change the data fetching" |
| `mixed` | Multiple layers | ASK user before touching |
| `unknown` | Unclassified | Read carefully before touching |

---

## ABSOLUTE RULES

1. Never modify `.ripple/` files
2. Never change a function signature without checking ALL calledBy callers
3. Never create files outside: 
4. Never introduce Redux, Zustand, or Jotai without user confirmation
5. Always use existing styling approach for new UI

---
*Auto-generated by Ripple v1.0.0 — updates on every file save*
*This file reflects your actual codebase. It is always current.*
