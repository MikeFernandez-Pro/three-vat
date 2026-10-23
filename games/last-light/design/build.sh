#!/bin/sh
# Inlines today's swarm into light-2d.html, so the page opens on its own. Run from the project root: sh games/last-light/design/build.sh
set -e
dir=games/last-light/design
src=./games/last-light/src
printf "export * from '$src/swarm'\nexport * from '$src/gameplay'\nexport * from '$src/litareas'\nexport * from '$src/walls'\n" |
  node_modules/.bin/esbuild --bundle --format=iife --global-name=LastLight --target=es2020 --log-level=warning --sourcefile=entry.ts --loader=ts > $dir/swarm.tmp.js
node -e "const fs=require('fs');const d=process.argv[1];fs.writeFileSync(d+'/light-2d.html',fs.readFileSync(d+'/light-2d.src.html','utf8').replace('/*@@SWARM@@*/',()=>fs.readFileSync(d+'/swarm.tmp.js','utf8')))" $dir
rm $dir/swarm.tmp.js
