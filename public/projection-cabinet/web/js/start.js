'use strict';
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.getElementById('content')?.focus();
});
addHandlers();
render();

// Arrow keys stay inside the active film collection. Tab follows normal navigation.
app.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const key = event.key;
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(key)) return;
  const dock = event.target.closest('.dockframe');
  const cell = event.target.closest('.mcell');
  if (!dock && !cell) return;
  const elements = Array.from(app.querySelectorAll(dock ? '.dockframe' : '.mcell'));
  const rowWidth = dock ? elements.length : formats.length;
  const current = elements.indexOf(dock || cell);
  const column = current % rowWidth;
  const target = {
    ArrowLeft: current - (column > 0 ? 1 : 0),
    ArrowRight: current + (column < rowWidth-1 ? 1 : 0),
    ArrowUp: current-rowWidth,
    ArrowDown: current+rowWidth,
    Home: current-column,
    End: current-column+rowWidth-1
  }[key];
  if (!elements[target]) return;
  event.preventDefault();
  elements[target].focus({preventScroll:true});
  elements[target].click();
});
