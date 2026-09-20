# PROTOTYPE — three-vat sur `@three.ez/instanced-mesh`

**Throwaway.** Ne pas fusionner dans `main`. Vit sur la branche
`prototype/three-ez-interop`.

## La question

Une foule `three-vat` peut-elle être montée sur un `InstancedMesh2` de
`@three.ez/instanced-mesh`, pour hériter gratuitement du culling par instance,
du LOD et du tri — plutôt que de les réimplémenter ici ?

Sous-question redoutée : le chemin TSL ré-applique la matrice d'instance à la
main (option `instancedMesh`, `src/tsl.ts`) parce que three transforme
`positionLocal` avant `positionNode`. Or `InstancedMesh2` range ses matrices
dans une texture. Est-ce que ça tient ?

## Réponse : non, pas en l'état. Et ce n'est pas réparable côté appelant.

### Chemin TSL — la question ne se pose pas

`@three.ez/instanced-mesh@0.3.16` est **WebGL uniquement**. Il fonctionne en
écrasant des chunks GLSL de `THREE.ShaderChunk` et en détournant
`material.onBeforeCompile` — deux mécanismes que `WebGPURenderer` et les node
materials n'ont pas. Zéro occurrence de `webgpu`, `tsl` ou `NodeMaterial` dans
le paquet. Le risque « `positionLocal` déjà transformé ? » est donc sans objet :
il n'y a pas de chemin TSL à tester.

### Chemin WebGL — le décodage marche, le routage des instances casse

Ce qui **marche**, et c'est à noter :

- `patchVATMaterial` survit à l'adoption par `InstancedMesh2`. Celui-ci range le
  `onBeforeCompile` existant dans `_onBeforeCompileBase` et l'appelle **avant**
  le sien (`src/core/InstancedMesh2.js`). Il faut patcher *avant* de construire
  le mesh, ce que fait ce prototype.
- `vatSample()` indexe la texture par `gl_VertexID` — insensible à toute
  réorganisation des instances.
- Le rendu est visuellement correct en pose et en éclairage, 3 draw calls comme
  la référence.

Ce qui **casse** :

`InstancedMesh2` fait de l'instanciation **indirecte**. Il n'y a pas de matrice
par instance dans un attribut : les matrices sont dans `matricesTexture`, et un
attribut instancié `instanceIndex` (`UNSIGNED_INT`) donne, pour chaque **slot
dessiné**, l'identifiant **logique** de l'instance qui s'y trouve. Après culling
ou tri, ce tableau n'est plus l'identité.

Or le contrat de lecture de `three-vat` (`aVatClip`, `aVatPlayback`, `aVatFade`,
écrits par `addVATInstanceAttributes`) est fait d'`InstancedBufferAttribute`
ordinaires — que le GPU indexe **par slot**. Les deux ne coïncident que tant
que `instanceIndex` est l'identité.

Mesuré par `probe.mjs`, 340 robots, clip choisi par colonne :

| Mode | dessinées | `instanceIndex` identité ? | 1ère rupture |
|---|---|---|---|
| `InstancedMesh` (réf.) | 340 | — | — |
| `InstancedMesh2`, culling **actif** | 332 | **non** | slot 2 |
| `InstancedMesh2`, culling **coupé** | 340 | oui | — |

`head` du mode culled : `[0, 1, 20, 21, 40, 41, 60, 61, 2, 22, 3, 4]` — le BVH
réordonne dès qu'il cull. Le slot 2 doit jouer `Dance` (instance 20) et lit
`Wave` (donnée du slot 2). Visuellement : `shot-plain-front.png` montre des
bandes verticales nettes, `shot-ez-culled-front.png` montre une bouillie, et
`shot-ez-unculled-front.png` retrouve les bandes.

**Ce n'est pas une erreur de câblage de ce prototype.** C'est structurel : dès
qu'on active la fonctionnalité pour laquelle on voudrait `InstancedMesh2` (le
culling), on casse la lecture par instance de `three-vat`.

## Ce que ça implique

Le prix de l'interop est un changement de contrat côté `three-vat` : la lecture
par instance devrait passer par une **indirection** — lire `instanceIndex` puis
aller chercher la donnée de playback dans une texture, au lieu d'un attribut.
`@three.ez` a exactement la facilité pour ça (`uniformsTexture` /
`getUniformsGLSL(name, 'instanceIndex', 'uint')`), donc c'est faisable — mais :

- ça touche ADR-0009 (le contrat de lecture par instance, commun aux deux
  chemins de décode) ;
- ça n'aide que WebGL, alors que 0009 exige la parité des deux chemins ;
- ça introduit une dépendance de forme à une lib tierce dans le contrat cœur.

## Rejouer

```sh
pnpm exec vite --config prototype-three-ez/vite.config.ts --port 5199
node prototype-three-ez/probe.mjs        # dans un autre terminal
```

`vendor/` contient `@three.ez/instanced-mesh@0.3.16` et `bvh.js@0.0.13`
détarrés à la main : `pnpm add` refuse d'écrire dans ce `node_modules` sans le
recréer entièrement (`ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF`), et un
prototype ne doit pas exiger ça.

Le prototype vit dans son propre root vite plutôt qu'en page d'`examples/` :
tout `*.html` à côté de la démo *est* une démo (`examples/pages.mjs` globbe le
dossier) et rejoindrait le build de release — même raison que
`release/parity/index.html`.
