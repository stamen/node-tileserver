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
