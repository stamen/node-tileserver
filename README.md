# tileserver

I need a better name.

## Upgrading

If underlying binary dependencies (i.e. Mapnik) have changed, set
`NPM_REBUILD=1` to trigger an `npm rebuild`.

## Seeding

Uses [Redis Cloud](https://addons.heroku.com/rediscloud)'s free plan to
facilitate queueing.

```bash
heroku addons:add rediscloud:20
heroku config:set AWS_ACCESS_KEY_ID=<redacted> \
                  AWS_SECRET_ACCESS_KEY=<redacted> \
                  S3_BUCKET=<redacted> \
                  PATH_PREFIX=prefix \
                  REDIS_URL=$(heroku config:get REDISCLOUD_URL)
```

```bash
heroku run 'seed -b="-123.640 36.791 -121.025 38.719" -z 10 -Z 14'

heroku ps:scale worker=1
```

## Environment Variables

* `SCALE` - Rendering scale. Defaults to `1`.
* `METATILE` - Metatile size (how many tiles on an edge to render at a time).
  Defaults to `4`.
* `BUFFER_SIZE` - Map buffer size. Defaults to `128`.  May be overridden in
  a Carto `map` element (??).
* `TILE_SIZE` - Tile height/width. Defaults to `256`.
* `AWS_DEFAULT_REGION` - Default AWS region to use when making calls that
  require one.  Defaults to `us-east-1`.
* `ACCESS_KEY_ID` - AWS access key. Required when seeding.
* `SECRET_ACCESS_KEY` - AWS secret access key. Required when seeding.
* `S3_BUCKET` - S3 bucket name. Required when seeding.
* `PATH_PREFIX` - Optional path prefix to use when uploading seeded tiles.
  Defaults to ``.
