# Nimi release 1.19.5 — Source Runtime support for Catalog Apps

Updates the frozen public npm dependency to Kit/native 0.19.2. The installed App keeps its published native carrier and can connect to a source-development Runtime when launched through Home. Native peer identity checks and Runtime-owned installed-source, session and App Access admission remain mandatory. Production Runtime trust remains unchanged; invalid source Runtime observations fail closed without fallback. SDK 0.21.0, App Tools 0.12.0 and the existing App business workflows are retained.

# Nimi release 1.19.4

SillyTavern now consumes the published Nimi SDK 0.21.0, Kit 0.19.0, App Tools 0.12.0 and Nimi Coding 0.6.5 with frozen public npm dependencies. Retrieval distinguishes document and query embeddings. Supported media jobs retain their original Job and use the shared public observer while preserving the full terminal result. Speech synthesis and saved chat restoration were exercised through the Desktop-supervised App.

The macOS packager bounds signing discovery to avoid file-handle exhaustion and retains strict signature verification. This release declares macOS arm64; Windows interactive use is not verified.
