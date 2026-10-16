// The thank-you screen's festive pixel art: slow fireworks bursts behind
// the headline.

(() => {
  const NS = "http://www.w3.org/2000/svg";
  const px = (x, y) => `M${x} ${y}h1v1h-1z`;

  function burstPath(rays, rings) {
    const c = 15, seen = new Set();
    let d = "";
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      for (const r of rings) {
        const x = Math.round(c + Math.cos(a) * r), y = Math.round(c + Math.sin(a) * r);
        if (!seen.has(`${x},${y}`)) seen.add(`${x},${y}`), (d += px(x, y));
      }
    }
    return d;
  }
  const OUT = burstPath(16, [8, 10.5, 13]);
  const IN = burstPath(10, [3.5, 5.5]);
  const SPARK = "#FFFFFF", SPARK2 = "#FF5A6E", SPARK3 = "#9AA9FF";
  // [x %, y %, size px, delay s, outer colour, inner colour] per layout
  const BURSTS = {
    landscape: [[22, 22, 240, 0, SPARK, SPARK2], [70, 14, 190, 2.4, SPARK2, SPARK], [92, 52, 150, 4.6, SPARK3, SPARK], [48, 40, 120, 6.8, SPARK, SPARK3]],
    portrait: [[20, 26, 380, 0, SPARK, SPARK2], [72, 18, 320, 2.4, SPARK2, SPARK], [88, 58, 240, 4.6, SPARK3, SPARK], [46, 50, 200, 6.8, SPARK, SPARK3]],
  };

  function svg(viewBox, paths) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("shape-rendering", "crispEdges");
    for (const [d, fill] of paths) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", fill);
      s.append(p);
    }
    return s;
  }

  function fireworks() {
    const layout = document.getElementById("door").classList.contains("portrait") ? "portrait" : "landscape";
    const box = document.getElementById("fireworks");
    if (box.dataset.layout === layout) return;
    box.dataset.layout = layout;
    box.replaceChildren(
      ...BURSTS[layout].map(([x, y, size, delay, c1, c2]) => {
        const fw = document.createElement("div");
        fw.className = "fw";
        Object.assign(fw.style, { left: `${x}%`, top: `${y}%`, width: `${size}px`, height: `${size}px`, animationDelay: `${delay}s` });
        fw.append(svg("0 0 31 31", [[OUT, c1], [IN, c2]]));
        return fw;
      }),
    );
  }

  fireworks();
  new ResizeObserver(fireworks).observe(document.documentElement);
  setTimeout(fireworks, 300); // after the screen has picked landscape / portrait
})();
