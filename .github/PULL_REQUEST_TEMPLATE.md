## Summary

Explain the user-visible change and why it is needed.

## Validation

- [ ] `npm run build`
- [ ] Relevant `npm run test:*` checks
- [ ] `cargo test --locked` when native code changed
- [ ] Help, CLI/MCP guides, and translations updated when needed

## Safety checklist

- [ ] No API key, token, password, private file, or personal path is included
- [ ] Output handling does not overwrite source files or bypass path validation
- [ ] Desktop, CLI, and MCP behavior remain aligned where applicable
- [ ] This pull request is focused and does not include unrelated formatting changes

## Related issue

Fixes #
