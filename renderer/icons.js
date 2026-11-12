(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const P = {
    check: 'M9 11l3 3L22 4|M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    sliders: 'M4 21v-7|M4 10V3|M12 21v-9|M12 8V3|M20 21v-5|M20 12V3|M1 14h6|M9 8h6|M17 16h6',
    sun: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z|M12 1v2|M12 21v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M1 12h2|M21 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z',
    collapse: 'M11 17l-5-5 5-5|M18 17l-5-5 5-5',
    refresh: 'M23 4v6h-6|M1 20v-6h6|M3.5 9a9 9 0 0 1 14.9-3.4L23 10|M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
    search: 'M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16z|M21 21l-4.3-4.3',
    plus: 'M12 5v14|M5 12h14',
    edit: 'M12 20h9|M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    trash: 'M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5|M12 3v12',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3',
    up: 'M12 19V5|M5 12l7-7 7 7',
    down: 'M12 5v14|M19 12l-7 7-7-7',
    x: 'M18 6L6 18|M6 6l12 12',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
    copy: 'M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z|M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  };
  window.icon = function (name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of (P[name] || '').split('|')) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  };
  window.hydrateIcons = function (root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => el.replaceChildren(window.icon(el.dataset.icon)));
  };
})();
