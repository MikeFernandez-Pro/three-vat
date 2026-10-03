// Michelle's SambaDance, danced by Soldier and by RobotExpressive: retargets
// the clip onto each and writes each out again, beside its original, with it
// appended as SambaDance. Every other byte of each source is kept.
//
//   node author-samba.mjs            (from examples/)
//
// Soldier is rigged as Michelle is, the same Mixamo skeleton, so each of his
// bones takes the turn its namesake makes away from Michelle's T-pose, from
// his own T-pose, and his hips move as hers do, scaled to his height. He faces
// the other way along z, so every turn is carried round to his facing first.
//
// The robot is fourteen rigid parts on a skeleton of its own, so it is posed
// by direction (posing.mjs): each limb aimed along the line its namesake
// limb of Michelle's makes, and the body, chest, neck and head given the turns
// hers make, from Idle's first pose. Its feet are bones of their own, hanging
// off the root rather than the legs, so each is moved to the end of its leg.
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { appendClips, loadForPosing, sampleClip } from "./append-clips.mjs";
import { aim, line, moveTo, orient } from "./posing.mjs";

const FPS = 30;
const read = (file) => readFileSync(`public/${file}`);

// ---------------------------------------------------------------- the source
const michelle = await loadForPosing(read("Michelle.glb"));
const source = michelle.scene;
const mixamo = (scene, name) => scene.getObjectByName(`mixamorig${name}`);
const worldRotation = (object) => object.getWorldQuaternion(new THREE.Quaternion());
const worldPosition = (object) => object.getWorldPosition(new THREE.Vector3());

/**
 * Pose `scene` at `time` into `clip`, by one mixer per scene and clip, never
 * stopped: a stopped mixer puts back every value it moved. Only Michelle is
 * posed more than once, and nothing else moves her, so the mixer's habit of
 * skipping a value it already wrote never hides a change.
 */
const mixers = new Map();
function posed(scene, clip, time) {
  const key = `${scene.uuid}:${clip.name}`;
  if (!mixers.has(key)) {
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(clip).play();
    mixers.set(key, mixer);
  }
  mixers.get(key).setTime(time);
  scene.updateMatrixWorld(true);
}

const samba = michelle.animations.find((clip) => clip.name === "SambaDance");
const frames = Math.round(samba.duration * FPS) + 1;
posed(source, michelle.animations.find((clip) => clip.name === "TPose"), 0);
const sourceBones = [];
source.traverse((object) => object.isBone && sourceBones.push(object));
/** Michelle in her T-pose: each bone's world rotation, and where her hips are. */
const sourceRest = new Map(sourceBones.map((bone) => [bone.name, worldRotation(bone)]));
const sourceHips = worldPosition(mixamo(source, "Hips"));

/** The world turn Michelle's `name` makes away from her T-pose now, carried round by `facing`. */
function turnOf(name, facing) {
  const bone = source.getObjectByName(name);
  const delta = worldRotation(bone).multiply(sourceRest.get(name).clone().invert());
  return facing.clone().multiply(delta).multiply(facing.clone().invert());
}

/** The turn about the vertical that carries a character whose left is `left` round to one whose left is `want`. */
function facingFrom(left, want) {
  const flat = (v) => new THREE.Vector3(v.x, 0, v.z).normalize();
  return new THREE.Quaternion().setFromUnitVectors(flat(left), flat(want));
}
const sourceLeft = line(mixamo(source, "RightArm"), mixamo(source, "LeftArm"));
/** The length of her leg, standing: hip to ankle. */
const sourceLeg = worldPosition(mixamo(source, "LeftUpLeg")).y - worldPosition(mixamo(source, "LeftFoot")).y;

/** Every bone of `scene`'s that a clip keys, by node index. */
const keyedBones = (gltf, bones) => new Map(bones.map((bone) => [gltf.parser.associations.get(bone).nodes, bone]));

// ---------------------------------------------------------------- Soldier
{
  const bytes = read("Soldier.glb");
  const soldier = await loadForPosing(bytes);
  const scene = soldier.scene;
  posed(scene, soldier.animations.find((clip) => clip.name === "TPose"), 0);
  const bones = [];
  scene.traverse((object) => object.isBone && source.getObjectByName(object.name) && bones.push(object));
  const rest = new Map(bones.map((bone) => [bone, worldRotation(bone)]));
  const hips = mixamo(scene, "Hips");
  const restHips = worldPosition(hips);
  const facing = facingFrom(sourceLeft, line(mixamo(scene, "RightArm"), mixamo(scene, "LeftArm")));
  const scale = restHips.y / sourceHips.y;

  const clip = sampleClip("SambaDance", frames, FPS, keyedBones(soldier, bones), (i) => {
    posed(source, samba, i / FPS);
    // Parents first, as traversed: each bone's world turn is set under its parent's new one.
    for (const bone of bones) orient(bone, turnOf(bone.name, facing).multiply(rest.get(bone)));
    const moved = worldPosition(mixamo(source, "Hips")).sub(sourceHips).multiplyScalar(scale).applyQuaternion(facing);
    moveTo(hips, restHips.clone().add(moved));
  });
  writeFileSync("public/Soldier.samba.glb", appendClips(bytes, [clip]));
  console.log(`public/Soldier.samba.glb: SambaDance ${frames} frames, ${bones.length} bones`);
}

// ---------------------------------------------------------------- the robot
{
  const bytes = read("RobotExpressive.glb");
  const robot = await loadForPosing(bytes);
  const scene = robot.scene;
  const part = (name) => scene.getObjectByName(name);
  posed(scene, robot.animations.find((clip) => clip.name === "Idle"), 0);
  const restPose = [];
  scene.traverse((object) => restPose.push([object, object.position.clone(), object.quaternion.clone()]));
  const facing = facingFrom(sourceLeft, line(part("UpperArmR"), part("UpperArmL")));

  // The robot's body, chest, neck, head and shoulders take the turns of
  // Michelle's that carry them, from where Idle has them.
  const turned = [
    ["Body", "Hips"],
    ["Abdomen", "Spine"],
    ["Torso_1", "Spine2"],
    ["Neck", "Neck"],
    ["Head", "Head"],
    ["ShoulderL", "LeftShoulder"],
    ["ShoulderR", "RightShoulder"],
  ].map(([robotName, name]) => [part(robotName), `mixamorig${name}`]);
  // Its limbs are aimed along hers: robot bone, the robot bone it reaches to, and her pair.
  const limbs = ["L", "R"].flatMap((side) => {
    const her = side === "L" ? "Left" : "Right";
    return [
      [`UpperArm${side}`, `LowerArm${side}`, `${her}Arm`, `${her}ForeArm`],
      [`LowerArm${side}`, `Palm2${side}`, `${her}ForeArm`, `${her}Hand`],
      [`UpperLeg${side}`, `LowerLeg${side}`, `${her}UpLeg`, `${her}Leg`],
      [`LowerLeg${side}`, `LowerLeg${side}_end`, `${her}Leg`, `${her}Foot`],
    ].map(([bone, reach, from, to]) => [part(bone), part(reach), mixamo(source, from), mixamo(source, to)]);
  });
  const feet = ["L", "R"].map((side) => [part(`Foot${side}`), part(`LowerLeg${side}_end`), `mixamorig${side === "L" ? "Left" : "Right"}Foot`]);

  const rest = new Map([...turned.map(([bone]) => bone), ...feet.map(([foot]) => foot)].map((bone) => [bone, worldRotation(bone)]));
  const restBody = worldPosition(part("Body"));
  // The robot's hips bob as hers do, scaled by how much longer its legs are.
  const scale = (worldPosition(part("UpperLegL")).y - worldPosition(part("LowerLegL_end")).y) / sourceLeg;

  const keyed = new Set([...turned.map(([bone]) => bone), ...limbs.map(([bone]) => bone), ...feet.map(([foot]) => foot)]);
  for (const track of robot.animations.find((clip) => clip.name === "Idle").tracks) {
    if (!track.name.endsWith(".morphTargetInfluences")) keyed.add(THREE.PropertyBinding.findNode(scene, THREE.PropertyBinding.parseTrackName(track.name).nodeName));
  }
  const clip = sampleClip("SambaDance", frames, FPS, keyedBones(robot, [...keyed]), (i) => {
    for (const [object, position, quaternion] of restPose) object.position.copy(position), object.quaternion.copy(quaternion);
    scene.updateMatrixWorld(true);
    posed(source, samba, i / FPS);
    const moved = worldPosition(mixamo(source, "Hips")).sub(sourceHips).multiplyScalar(scale).applyQuaternion(facing);
    moveTo(part("Body"), restBody.clone().add(moved));
    for (const [bone, name] of turned) orient(bone, turnOf(name, facing).multiply(rest.get(bone)));
    for (const [bone, reach, from, to] of limbs) aim(bone, reach, line(from, to).applyQuaternion(facing));
    for (const [foot, end, name] of feet) {
      moveTo(foot, worldPosition(end));
      orient(foot, turnOf(name, facing).multiply(rest.get(foot)));
    }
  });
  // The face Idle keeps: none of its three expressions.
  const faceNode = robot.parser.json.animations.find((a) => a.name === "Idle").channels.find((c) => c.target.path === "weights").target.node;
  clip.channels.push({ node: faceNode, path: "weights", values: new Array(frames * 3).fill(0) });
  writeFileSync("public/RobotExpressive.samba.glb", appendClips(bytes, [clip]));
  console.log(`public/RobotExpressive.samba.glb: SambaDance ${frames} frames, ${keyed.size} parts`);
}
