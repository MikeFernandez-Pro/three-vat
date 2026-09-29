// Rapier collision groups, as the original has them. Rapier takes one 32-bit
// integer per collider: its memberships in the high half, the groups it
// collides with in the low half, and two colliders touch only when each is in
// the other's filter.
export const CollisionGroup = {
  ARENA: 1 << 0,
  GROUND: 1 << 1,
  ENEMY: 1 << 2,
  CHARACTER: 1 << 3,
  PROJECTILE: 1 << 4,
  GIFT: 1 << 5,
} as const

export function collisionGroups(memberships: number, filter: number): number {
  return (memberships << 16) | filter
}
