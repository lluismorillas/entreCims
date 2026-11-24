# Security

## Design

entreCims is meant to run only on your own machine. It has **no authentication and no access control**, so `compose.yaml` publishes its port on `127.0.0.1` only. Do not expose it to a network you do not control.

What it does to stay safe with the files you give it:

- GPX and TCX files are parsed with `defusedxml`, which rejects malicious XML.
- Uploads have size limits (20 MB per track), and photos are checked to be JPEG, PNG or WebP.
- File names are never used as paths on disk: the server generates its own identifiers.
- The container runs as an unprivileged user.

It contacts outside services only for map tiles, 3D terrain, OpenStreetMap peaks (Overpass) and paths in the route planner (Valhalla). [NOTICE.md](NOTICE.md) lists what each one receives.

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's [private vulnerability reporting](https://github.com/lluismorillas/entreCims/security/advisories/new) on this repository instead. You will get an answer within a week, and the fix will be published before the details are made public.
