# tileserver

I need a better name.

## "Packaging"

```bash
git push heroku master
heroku run bash
tar zcf /tmp/tileserver-0.3.0_<sha>.tar.gz .
bin/s3-put /tmp/tileserver-0.3.0_<sha>.tar.gz
```
