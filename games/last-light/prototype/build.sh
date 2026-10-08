#!/bin/sh
# PROTOTYPE: inlines today's swarm.ts into fear.html. Run from the project root: sh games/last-light/prototype/build.sh
set -e
dir=games/last-light/prototype
node_modules/.bin/esbuild games/last-light/src/swarm.ts --bundle --format=iife --global-name=Current --target=es2020 --log-level=warning > $dir/current.tmp.js
node -e "const fs=require('fs');const d=process.argv[1];fs.writeFileSync(d+'/fear.html',fs.readFileSync(d+'/fear.src.html','utf8').replace('/*@@CURRENT@@*/',()=>fs.readFileSync(d+'/current.tmp.js','utf8')))" $dir
rm $dir/current.tmp.js
