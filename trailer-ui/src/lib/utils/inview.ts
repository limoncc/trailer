/**
 * Svelte `use:inview` action — renders children only when element is visible.
 * Frees GPU memory for off-screen G2 charts.
 *
 * Usage: `<div use:inview> <Chart /> </div>`
 */
export function inview(node: HTMLElement) {
  let visible = true;

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !visible) {
        visible = true;
        node.style.visibility = 'visible';
      } else if (!entry.isIntersecting && visible) {
        visible = false;
        node.style.visibility = 'hidden';
      }
    },
    { rootMargin: '200px 0px 200px 0px' }
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
  };
}
