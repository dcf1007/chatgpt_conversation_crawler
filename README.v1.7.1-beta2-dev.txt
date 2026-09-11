ChatGPT Conversation Crawler v1.7.1-beta2-dev

Development diagnostic prerelease.

This build retains the full v1.7.1-beta-dev crawler behavior and corrects one development-diagnostic metadata defect found by the completed v1.7.0-beta3-dev MHTML audit: while a manual target is being remounted, MHTML metadata now identifies the upcoming target immediately instead of leaving manualTargetTurnId blank on the first remount or stale on the previous target during the second remount.

The fix publishes a non-interactive remount diagnostic state before shared logical turn navigation begins. That state carries the current step, target turn ID, and target reason, and is replaced by the normal interactive manual-inspection state only after the target mounts. Crawler traversal, retained-turn navigation, disclosure expansion, hydration reconciliation, archive integrity, and final static output are otherwise unchanged from v1.7.1-beta-dev.

Run the platform setup script once, then use the matching start script. The development diagnostic wrapper remains enabled in this prerelease and must not be merged into clean main.
