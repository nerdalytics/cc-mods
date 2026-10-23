---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document that summarises the current conversation, so a fresh agent can continue the work. Save it at the project's root (the repository's top level, or the current directory outside a repository) as `HANDOFF-<YYYY-MM-DD-HHMM>.md`, the local date and time it was written, and print the path. The user starts the next session by pointing an agent at that file, so it has to be somewhere they can find it.

Include a "suggested skills" section in the document that names the skills the next agent should call the Skill tool for.

Include an `## Open issues` section when the session noticed problems it did not act on: a bug seen in passing, a request that came up, a piece of work that belongs to a different change. Write one bullet per issue, and make each bullet self-contained enough to become its own file. Omit the section when there is nothing in it.

Content already captured in other artifacts, such as specs, plans, ADRs, issues, commits, and diffs, appears in the document only as a reference by path or URL.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on, and tailor the document to that focus.
