// A Goose Tale's door: the game itself (main.ts) on a computer; on a phone or a
// tablet, while the phone version is not ready (#198, `?touch` turning it on),
// the loading screen's title with a word under it to come back on a computer,
// and the game never loaded behind it.

const phone = matchMedia('(pointer: coarse)').matches
if (phone && !new URLSearchParams(location.search).has('touch')) {
  const slot = document.querySelector('#loading .slot')
  if (slot) slot.innerHTML = '<div class="soon">Under construction on phones.<br>Please open it on a computer.</div>'
} else void import('./main')
