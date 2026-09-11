ChatGPT Conversation Crawler v1.7.1-beta2.1-dev

Development diagnostic prerelease.

This patch retains the full v1.7.1-beta2-dev crawler and diagnostic behavior and corrects one Windows setup defect: when Node.js is installed under a path containing spaces, such as C:\Program Files\nodejs\node.exe, setup-windows.bat no longer queries the Node major version through FOR /F command substitution.

The setup script now invokes the already-resolved Node executable directly with its path quoted, writes the numeric major version to a temporary file, reads that value with set /p, and removes the temporary file. This avoids cmd.exe reparsing the quoted executable path as C:\Program. No crawler traversal, remount, hydration, disclosure, archive, or diagnostic-recorder behavior changed from v1.7.1-beta2-dev.

Run setup-windows.bat again from this package, then use start-windows.bat. The development diagnostic wrapper remains enabled in this prerelease and must not be merged into clean main.
