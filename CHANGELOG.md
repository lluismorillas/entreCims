# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-24

First release.

### Added

- Logbook: import GPX, FIT and TCX tracks, one by one or in bulk, with duplicate detection and safe parsing; distance, ascent, descent, total and moving time; search, date filter, editing and deletion.
- Map in 2D or 3D terrain with adjustable relief shading, and an elevation profile linked to the map.
- Photos placed on the track by their GPS position or by the time they were taken.
- Peak detection against OpenStreetMap peaks (proximity to the track's segments, altitude and local high point), with manual confirmation or rejection that survives re-analysis, the reasons for each result, and a global list of reached peaks.
- Peaks of Catalonia downloaded on the first start; downloads of other areas by map view, around a route or by area name.
- Time prediction per activity type: an own speed-by-slope model for hikes and calibrated Naismith for trail runs and runs, with a 90 % range and the total time with stops. Versions of each model are kept.
- Time model page: speed by slope, how the pace changed outing by outing, and each outing against its prediction.
- Each recorded track can be coloured by where it was faster or slower than predicted.
- Route planner following paths (Valhalla), with draggable points and line, and a warning when Valhalla or Overpass do not answer.
- Docker image and Compose file, published on `127.0.0.1` only; continuous integration with lint, tests and the Docker build.

[Unreleased]: https://github.com/lluismorillas/entreCims/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lluismorillas/entreCims/releases/tag/v0.1.0
