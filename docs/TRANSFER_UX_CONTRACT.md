# Transfer UX Contract

This file is the entry point for product behavior shared by the iPhone app,
browser uploader, Windows app, and C++ server. Surface-specific UX specifications are separate so
a mobile interaction does not accidentally become a Windows rule, and a
Windows server policy does not appear as a second iPhone setting.

- [Shared transfer behavior](ux/SHARED_TRANSFER_BEHAVIOR.md)
- [iPhone transfer UX](ux/IOS_TRANSFER_UX.md)
- [Web transfer UX](ux/WEB_TRANSFER_UX.md)
- [Windows transfer UX](ux/WINDOWS_TRANSFER_UX.md)

The shared document owns protocol meaning, setting ownership, and cross-device
state transitions. The iPhone, Web, and Windows documents own only what each
user can see and do on that surface.

When behavior changes, update the shared contract only if the cross-device
meaning changed. Update the relevant surface document for copy, layout, user
actions, accessibility, or local recovery behavior. Update tests, the local
private engineering notes when present, and the task's sanitized
development-session record at the same review boundary.

The versioned native Windows security and upload wire contract is specified in
[Native Windows Transfer Protocol v1](NATIVE_WINDOWS_PROTOCOL.md).
