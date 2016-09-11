#!/bin/sh

bundleByCLI() {
  [ -e _dist/functions/$1 ] || mkdir -p _dist/functions/$1

  $(npm bin)/browserify \
    --standalone lambda \
    --node \
    --entry functions/$1/index.js \
    --outfile _dist/functions/$1/index.js
}

bundleByJS() {
  echo 'var b = new require("../../lib/utils/bundle_function");
b({
  src: "./functions",
  dst: "./dist/functions",
  functionName: "'$1'",
  browserify: {},
}, function(err) { if (err) console.log(err); })' | node
}

finalize() {
  rm -r _dist dist
}
trap finalize INT QUIT TERM EXIT

cd $(dirname $0)/testdata

# browserify and zip by deploy.js -> unzip
{
  bundleByJS foo &
  bundleByJS bar &
  wait
  # unzip bundle and remove *.zip
  {
    unzip -o -d ./dist/functions/foo ./dist/functions/foo/bundle.zip
    unzip -o -d ./dist/functions/bar ./dist/functions/bar/bundle.zip
  } 1> /dev/null
  rm dist/functions/*/*.zip
} &

# browserify by cli
bundleByCLI foo &
bundleByCLI bar &
wait

diff -x ".*" -r -u ./_dist/functions ./dist/functions || (echo "fail testBundleFunctions" && exit 1)
