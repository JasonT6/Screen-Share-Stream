# Contributor instructions

Read [ARCHITECTURE.md](ARCHITECTURE.md), [RULES.md](RULES.md), [MILESTONE.md](MILESTONE.md), and the root [README.md](../README.md) before changing the project.

The current product contract supersedes the old LiveKit implementation: static browser app, direct peer-to-peer video with shared audio, password-protected invitations, automatic attendee connection, no accounts/lobby/voice/backend operated by the user.

Before coding, inspect the affected source and avoid overwriting unrelated work. Follow the user's current requirements over historical milestones. Keep capture, authentication, and media lifecycle concerns explicit. Do not reintroduce an SFU, TURN, database, or server routes to solve unrequested scalability concerns.

After changes, run appropriate checks, update architecture and setup documentation, and record completed versus unverified work in MILESTONE.md. Never carry old successful test claims forward as evidence for new code. Cross-network and actual screen/audio capture tests require real devices; automated synthetic media tests must be labeled accordingly.

Keep tasks focused; delegation is optional and does not change these requirements. Do not create a server deployment or publish the project unless requested or otherwise authorized in the session.
