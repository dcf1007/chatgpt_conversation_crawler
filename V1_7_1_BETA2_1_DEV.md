# v1.7.1-beta2.1-dev

This development diagnostic prerelease retains the complete `v1.7.1-beta2-dev` crawler and diagnostic implementation and corrects one Windows setup-launcher defect. It does not change crawler traversal, remounting, disclosure expansion, hydration reconciliation, archive integrity, static output, or MHTML recorder behavior.

## Windows setup correction

`setup-windows.bat` correctly found Node.js and could invoke it directly when the executable was installed at a path such as:

```text
C:\Program Files\nodejs\node.exe
```

However, the Node-major-version check embedded that quoted executable inside `FOR /F ('command')`. Windows `cmd.exe` reparses that nested command, and the executable path could lose the quoting needed around `C:\Program Files\...`. The observed failure was:

```text
Using Node: "C:\Program Files\nodejs\node.exe"
v26.7.0
'C:\Program' is not recognized as an internal or external command,
operable program or batch file.

Could not determine the active Node.js version.
```

`v1.7.1-beta2.1-dev` removes the resolved Node executable from `FOR /F` command substitution entirely. The setup script now:

1. resolves the active Node executable exactly as before;
2. invokes `"%NODE_EXE%"` directly with the executable path quoted;
3. writes the numeric Node major version to a temporary file;
4. reads the value with `set /p`;
5. deletes the temporary file;
6. continues with the existing Node >=20, npm, dependency, and Playwright Chromium setup checks.

This avoids the secondary `cmd.exe` command parser that caused `C:\Program` to be treated as the executable.

## Regression coverage

`tests/launcher-smoke.mjs` now explicitly verifies that:

- `setup-windows.bat` does not execute `%NODE_EXE%` through `FOR /F` command substitution;
- the Node major version is queried through a directly quoted `"%NODE_EXE%" -p ...` invocation;
- the result is read without nested command execution.

The existing launcher parity and Node >=20 assertions remain in place.

## Unchanged from v1.7.1-beta2-dev

All beta2 behavior remains unchanged, including:

- truthful upcoming manual-target metadata during diagnostic remounting;
- shared logical retained-turn navigation;
- turn-first whole-turn processing and scoped disclosure convergence;
- targeted retained-disclosure reconciliation;
- canonical real hydration generations plus accumulated semantic evidence;
- MHTML recorder behavior and metadata schema;
- no `Page.bringToFront()` or native window-activation recovery;
- exact `setTop()` versus assisted `navigateTop()` semantics.

## Scope

This version remains a development diagnostic prerelease. Clean `main` is not promoted or modified by this patch.
