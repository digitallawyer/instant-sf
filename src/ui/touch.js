// Touch controls for phones and tablets: a thumb joystick on the left (steer + throttle) and buttons
// on the right (jump, use item, hop on a cable car).
export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function createTouch(root, input, { onAction }) {
  root.insertAdjacentHTML('beforeend', `
    <div class="touch">
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-buttons">
        <button class="t-btn t-jump" data-a="jump">Jump</button>
        <button class="t-btn t-item" data-a="item">Item</button>
        <button class="t-btn t-hop" data-a="hop">Hop on</button>
        <button class="t-btn t-map" data-a="map">Map</button>
      </div>
    </div>`);
  const el = root.querySelector('.touch');
  const stick = el.querySelector('.t-stick'), knob = el.querySelector('.t-knob');
  let id = null, cx = 0, cy = 0;
  const R = 56;
  const set = (dx, dy) => {
    const l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.steerAxis = dx / R;
    input.throttleAxis = -dy / R;
  };
  stick.addEventListener('pointerdown', e => { id = e.pointerId; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; stick.setPointerCapture(id); set(e.clientX - cx, e.clientY - cy); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
  const end = e => { if (e.pointerId !== id) return; id = null; set(0, 0); };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  el.querySelectorAll('.t-btn').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    const a = b.dataset.a;
    if (a === 'jump') input.jumpPressed = true;
    else if (a === 'item') input.itemPressed = true;
    else onAction?.(a);
  }));
  return {
    el,
    show(on) { el.classList.toggle('on', on); },
    setHop(visible) { el.querySelector('.t-hop').style.display = visible ? '' : 'none'; },
  };
}
