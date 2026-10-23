# Titan (experimental)

Titan is an experimental startup orchestration profile available alongside UV and Scramjet. It reuses both existing engines rather than copying or modifying their rewrite implementations:

1. Try to initialize Ultraviolet and start the target navigation.
2. If UV fails during initialization, try to initialize Scramjet for that target.
3. If both initializations fail, report both errors through an `AggregateError`.

The fallback applies only to initialization failures before navigation starts. It cannot detect a target page that loads but later fails because of a framework bug, blocked API, DRM, authentication requirement, or server-side restriction. It does not switch engines after a target has begun loading.

Choose **Titan (experimental)** in Settings to opt in. UV remains the default for existing users and for invalid or unknown stored engine values.

This conservative design keeps the proxy libraries as the owners of their respective service workers and rewrite pipelines. A future independent Titan rewrite engine would need its own parser and rewrite tests, worker contract, transport integration, and compatibility suite; this profile is not represented as that work.
