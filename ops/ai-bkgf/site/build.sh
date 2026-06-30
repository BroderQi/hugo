#!/bin/sh
set -eu
/opt/hugo/hugo-bin --source /opt/ai-blog --destination /opt/ai-blog/public --environment production --cleanDestinationDir
