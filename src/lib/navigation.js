export function initialTab(viewportWidth) {
  return viewportWidth <= 600 ? 'chat' : 'home';
}
