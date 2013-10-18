# tileserver

I need a better name.

## Environment Variables

* `ENABLE_KUE_APP` - Enable [kue](https://github.com/LearnBoost/kue)'s web
  interface for viewing task status. Defaults to `false`.
* `SCALE` - Rendering scale. Defaults to `1`.
* `METATILE` - Metatile size (how many tiles on an edge to render at a time).
  Defaults to `4`.
* `BUFFER_SIZE` - Map buffer size. Defaults to `128`.  May be overridden in
  a Carto `map` element (??).
* `TILE_SIZE` - Tile height/width. Defaults to `256`.
* `ACCESS_KEY_ID` - AWS access key. Required when seeding.
* `SECRET_ACCESS_KEY` - AWS secret access key. Required when seeding.
* `S3_BUCKET` - S3 bucket name. Required when seeding.
* `PATH_PREFIX` - Optional path prefix to use when uploading seeded tiles.
  Defaults to ``.
